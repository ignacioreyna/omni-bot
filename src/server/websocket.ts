import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { coordinator, PermissionRequestData, ClaudeQuestionData } from '../coordinator/coordinator.js';
import { ClaudeEvent } from '../claude/output-parser.js';
import { ResultData } from '../claude/cli-wrapper.js';
import { validateWsToken } from './routes/auth.js';
import { appConfig } from '../config.js';

interface MessageOptions {
  model?: 'sonnet' | 'opus' | 'haiku';
  planMode?: boolean;
}

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'message' | 'abort' | 'permission_response' | 'question_response';
  sessionId?: string;
  content?: string;
  options?: MessageOptions;
  data?: {
    id?: string;
    allowed?: boolean;
    allowSimilar?: boolean;
    message?: string;
    answers?: Record<string, string>;
    cancelled?: boolean;
  };
}

interface ServerMessage {
  type: 'subscribed' | 'unsubscribed' | 'text' | 'tool' | 'result' | 'error' | 'event' | 'auth_error' | 'user_message' | 'permission_request' | 'session_updated' | 'claude_question';
  sessionId?: string;
  data?: unknown;
  // Used in 'subscribed' message for catch-up
  isProcessing?: boolean;
  streamingText?: string;
}

interface ExtendedWebSocket extends WebSocket {
  subscribedSessions: Set<string>;
  isAlive: boolean;
  userEmail?: string;
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  coordinator.on('text', (sessionId: string, text: string) => {
    broadcast(wss, sessionId, { type: 'text', sessionId, data: text });
  });

  coordinator.on('toolUse', (sessionId: string, tool: { id: string; name: string; input: Record<string, unknown> }) => {
    broadcast(wss, sessionId, { type: 'tool', sessionId, data: tool });
  });

  coordinator.on('result', (sessionId: string, result: ResultData) => {
    broadcast(wss, sessionId, { type: 'result', sessionId, data: result });
  });

  coordinator.on('error', (sessionId: string, error: Error) => {
    broadcast(wss, sessionId, { type: 'error', sessionId, data: error.message });
  });

  coordinator.on('event', (sessionId: string, event: ClaudeEvent) => {
    broadcast(wss, sessionId, { type: 'event', sessionId, data: event });
  });

  coordinator.on('permissionRequest', (sessionId: string, request: PermissionRequestData) => {
    // Add pattern preview to the request data
    const pattern = coordinator.getPermissionPattern(request.id);
    broadcast(wss, sessionId, {
      type: 'permission_request',
      sessionId,
      data: { ...request, pattern }
    });
  });

  coordinator.on('claudeQuestion', (sessionId: string, question: ClaudeQuestionData) => {
    broadcast(wss, sessionId, { type: 'claude_question', sessionId, data: question });
  });

  coordinator.on('sessionUpdated', (session) => {
    // Broadcast session update to all subscribed clients
    broadcast(wss, session.id, { type: 'session_updated', sessionId: session.id, data: session });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const client = ws as ExtendedWebSocket;
    client.subscribedSessions = new Set();
    client.isAlive = true;

    // Validate WS token from query params
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (appConfig.authMode === 'cloudflare') {
      if (!token) {
        sendToClient(client, { type: 'auth_error', data: 'Missing authentication token' });
        client.close(1008, 'Unauthorized');
        return;
      }

      const userData = validateWsToken(token);
      if (!userData) {
        sendToClient(client, { type: 'auth_error', data: 'Invalid or expired token' });
        client.close(1008, 'Unauthorized');
        return;
      }

      client.userEmail = userData.email;
    } else {
      // Tailscale mode - no auth needed
      client.userEmail = 'local@tailscale';
    }

    client.on('pong', () => {
      client.isAlive = true;
    });

    client.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        handleClientMessage(wss, client, message);
      } catch (err) {
        sendToClient(client, { type: 'error', data: 'Invalid message format' });
      }
    });

    client.on('close', () => {
      client.subscribedSessions.clear();
    });
  });

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as ExtendedWebSocket;
      if (!client.isAlive) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}

function handleClientMessage(wss: WebSocketServer, client: ExtendedWebSocket, message: ClientMessage): void {
  switch (message.type) {
    case 'subscribe':
      if (message.sessionId) {
        client.subscribedSessions.add(message.sessionId);

        // Send subscription confirmation with catch-up data for late-joining clients
        const isProcessing = coordinator.isSessionBusy(message.sessionId);
        const streamingText = coordinator.getCurrentStreamingText(message.sessionId);

        sendToClient(client, {
          type: 'subscribed',
          sessionId: message.sessionId,
          isProcessing,
          streamingText: streamingText || undefined,
        });
      }
      break;

    case 'unsubscribe':
      if (message.sessionId) {
        client.subscribedSessions.delete(message.sessionId);
        sendToClient(client, { type: 'unsubscribed', sessionId: message.sessionId });
      }
      break;

    case 'message':
      console.log('[WebSocket] Received message:', message);
      if (message.sessionId && message.content) {
        // Broadcast user message to all OTHER clients (not the sender)
        broadcastToOthers(wss, client, message.sessionId, {
          type: 'user_message',
          sessionId: message.sessionId,
          data: message.content
        });

        coordinator.sendMessage(message.sessionId, message.content, message.options).catch((err: Error) => {
          console.error('[WebSocket] Error sending message:', err);
          sendToClient(client, { type: 'error', sessionId: message.sessionId, data: err.message });
        });
      }
      break;

    case 'abort':
      if (message.sessionId) {
        coordinator.abortSession(message.sessionId);
      }
      break;

    case 'permission_response':
      console.log('[WebSocket] Received permission_response:', message.data);
      if (message.data?.id) {
        if (message.data.allowed) {
          if (message.data.allowSimilar) {
            // Allow and add pattern for future similar requests
            const result = coordinator.allowSimilarPermission(message.data.id);
            console.log('[WebSocket] allowSimilarPermission result:', result);
          } else {
            // Just allow this one request
            const result = coordinator.allowPermission(message.data.id);
            console.log('[WebSocket] allowPermission result:', result);
          }
        } else {
          const result = coordinator.denyPermission(message.data.id, message.data.message || 'User denied');
          console.log('[WebSocket] denyPermission result:', result);
        }
      } else {
        console.log('[WebSocket] permission_response missing id');
      }
      break;

    case 'question_response':
      console.log('[WebSocket] Received question_response:', message.data);
      if (message.data?.id) {
        if (message.data.cancelled) {
          const result = coordinator.cancelQuestion(message.data.id);
          console.log('[WebSocket] cancelQuestion result:', result);
        } else if (message.data.answers) {
          const result = coordinator.answerQuestion(message.data.id, message.data.answers);
          console.log('[WebSocket] answerQuestion result:', result);
        }
      } else {
        console.log('[WebSocket] question_response missing id');
      }
      break;
  }
}

function sendToClient(client: ExtendedWebSocket, message: ServerMessage): void {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function broadcast(wss: WebSocketServer, sessionId: string, message: ServerMessage): void {
  wss.clients.forEach((ws) => {
    const client = ws as ExtendedWebSocket;
    if (client.readyState === WebSocket.OPEN && client.subscribedSessions.has(sessionId)) {
      client.send(JSON.stringify(message));
    }
  });
}

function broadcastToOthers(wss: WebSocketServer, sender: ExtendedWebSocket, sessionId: string, message: ServerMessage): void {
  wss.clients.forEach((ws) => {
    const client = ws as ExtendedWebSocket;
    if (client !== sender && client.readyState === WebSocket.OPEN && client.subscribedSessions.has(sessionId)) {
      client.send(JSON.stringify(message));
    }
  });
}
