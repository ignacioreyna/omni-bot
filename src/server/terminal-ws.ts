import type { Server, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { authenticate } from './middleware/cf-access.js';
import {
  exitScrollMode,
  scrollSession,
  sessionExists,
  sessionTarget,
  tmuxArgs,
  tmuxEnv,
} from '../tmux/tmux.js';

const TERMINAL_PATH = '/ws/terminal';
// Cloudflare drops idle WebSockets after ~100s
const HEARTBEAT_MS = 30_000;

type ClientMessage =
  | { t: 'input'; d: string }
  | { t: 'resize'; cols: number; rows: number }
  | { t: 'scroll'; dir: 'up' | 'down' }
  | { t: 'scroll-exit' };

function clampDimension(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : fallback;
}

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function attachTerminal(ws: WebSocket, session: string, cols: number, rows: number): void {
  // tmuxEnv also drops TMUX, without which attach refuses to nest inside an existing client
  const env = { ...tmuxEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor' };

  const term = pty.spawn('tmux', tmuxArgs(['attach-session', '-t', sessionTarget(session)]), {
    name: 'xterm-256color',
    cols,
    rows,
    env,
  });

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  term.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'detached');
  });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : '') as ClientMessage;
    } catch {
      return;
    }

    switch (msg.t) {
      case 'input':
        term.write(msg.d);
        break;
      case 'resize':
        term.resize(clampDimension(msg.cols, cols), clampDimension(msg.rows, rows));
        break;
      case 'scroll':
        void scrollSession(session, msg.dir);
        break;
      case 'scroll-exit':
        void exitScrollMode(session);
        break;
    }
  });

  // Closing the socket only detaches the tmux client; the session keeps running
  ws.on('close', () => term.kill());
}

export function setupTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== TERMINAL_PATH) {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }

    void (async () => {
      const user = await authenticate(req);
      if (!user) {
        rejectUpgrade(socket, '401 Unauthorized');
        return;
      }

      const session = url.searchParams.get('session') ?? '';
      if (!session || !(await sessionExists(session))) {
        rejectUpgrade(socket, '404 Not Found');
        return;
      }

      const cols = clampDimension(url.searchParams.get('cols'), 80);
      const rows = clampDimension(url.searchParams.get('rows'), 24);

      wss.handleUpgrade(req, socket, head, (ws) => {
        console.log(`[Terminal] ${user.email} attached to ${session}`);
        attachTerminal(ws, session, cols, rows);
      });
    })();
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));
}
