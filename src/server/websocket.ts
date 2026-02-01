import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { coordinator } from '../coordinator/coordinator.js';
import { ClaudeEvent, ResultEvent } from '../claude/output-parser.js';

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'message' | 'abort';
  sessionId?: string;
  content?: string;
}

interface ServerMessage {
  type: 'subscribed' | 'unsubscribed' | 'text' | 'tool' | 'result' | 'error' | 'event';
  sessionId?: string;
  data?: unknown;
}

interface ExtendedWebSocket extends WebSocket {
  subscribedSessions: Set<string>;
  isAlive: boolean;
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  coordinator.on('text', (sessionId: string, text: string) => {
    broadcast(wss, sessionId, { type: 'text', sessionId, data: text });
  });

  coordinator.on('toolUse', (sessionId: string, tool: { id: string; name: string; input: Record<string, unknown> }) => {
    broadcast(wss, sessionId, { type: 'tool', sessionId, data: tool });
  });

  coordinator.on('result', (sessionId: string, result: ResultEvent) => {
    broadcast(wss, sessionId, { type: 'result', sessionId, data: result });
  });

  coordinator.on('error', (sessionId: string, error: Error) => {
    broadcast(wss, sessionId, { type: 'error', sessionId, data: error.message });
  });

  coordinator.on('event', (sessionId: string, event: ClaudeEvent) => {
    broadcast(wss, sessionId, { type: 'event', sessionId, data: event });
  });

  wss.on('connection', (ws: WebSocket) => {
    const client = ws as ExtendedWebSocket;
    client.subscribedSessions = new Set();
    client.isAlive = true;

    client.on('pong', () => {
      client.isAlive = true;
    });

    client.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        handleClientMessage(client, message);
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

function handleClientMessage(client: ExtendedWebSocket, message: ClientMessage): void {
  switch (message.type) {
    case 'subscribe':
      if (message.sessionId) {
        client.subscribedSessions.add(message.sessionId);
        sendToClient(client, { type: 'subscribed', sessionId: message.sessionId });
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
        coordinator.sendMessage(message.sessionId, message.content).catch((err: Error) => {
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
