import express, { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createServer, Server } from 'http';
import type { Socket } from 'net';
import { readFileSync } from 'fs';
import { wakeConfig } from './wake-config.js';
import { ProcessManager } from './process-manager.js';
import { renderStatusPage } from './status-page.js';
import { validateCfAccessJwt, type CfAccessUser } from '../shared/cf-jwt.js';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: CfAccessUser;
    }
  }
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (wakeConfig.authMode === 'tailscale') {
    req.user = { email: 'local@tailscale', sub: 'local' };
    next();
    return;
  }

  const token = req.headers['cf-access-jwt-assertion'] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Missing CF Access JWT' });
    return;
  }

  validateCfAccessJwt(token, {
    teamDomain: wakeConfig.cfAccessTeamDomain!,
    aud: wakeConfig.cfAccessAud!,
  })
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Invalid CF Access JWT' });
    });
}

export function createWakeServer(processManager: ProcessManager): Server {
  const app = express();
  app.use(express.json());

  const target = `http://localhost:${wakeConfig.omniBotPort}`;

  // Health check — no auth (for tunnel/monitoring)
  app.get('/wake/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'wake-server' });
  });

  // All other /wake routes require auth
  app.use('/wake', authMiddleware);

  app.get('/wake/status', (_req: Request, res: Response) => {
    res.json(processManager.getStatus());
  });

  app.post('/wake/start', async (_req: Request, res: Response) => {
    try {
      await processManager.start();
      res.json({ success: true, ...processManager.getStatus() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.post('/wake/stop', async (_req: Request, res: Response) => {
    try {
      await processManager.stop();
      res.json({ success: true, ...processManager.getStatus() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.post('/wake/restart', async (_req: Request, res: Response) => {
    try {
      await processManager.restart();
      res.json({ success: true, ...processManager.getStatus() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.post('/wake/rebuild', async (_req: Request, res: Response) => {
    try {
      await processManager.rebuild();
      res.json({ success: true, ...processManager.getStatus() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.get('/wake/logs', (req: Request, res: Response) => {
    const lines = parseInt((req.query.lines as string) || '100', 10);
    try {
      const content = readFileSync(wakeConfig.omniBotLogPath, 'utf8');
      const allLines = content.split('\n');
      const tail = allLines.slice(-lines).join('\n');
      res.type('text/plain').send(tail);
    } catch {
      res.type('text/plain').send('No logs available');
    }
  });

  app.get('/wake', (_req: Request, res: Response) => {
    const status = processManager.getStatus();
    res.type('html').send(renderStatusPage(status));
  });

  // Reverse proxy to Omni-Bot
  const proxy = createProxyMiddleware({
    target,
    changeOrigin: false,
    ws: true,
    on: {
      error: (_err, _req, res) => {
        if (res && 'writeHead' in res) {
          const httpRes = res as import('http').ServerResponse;
          const status = processManager.getStatus();
          httpRes.writeHead(503, { 'Content-Type': 'text/html' });
          httpRes.end(renderStatusPage(status));
        }
      },
    },
  });

  // Catch-all: proxy or show status
  app.use('/', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/wake')) {
      next();
      return;
    }

    if (!processManager.getStatus().running) {
      if (req.path.startsWith('/api/')) {
        res.status(503).json({ error: 'Omni-Bot is not running', wake: '/wake' });
        return;
      }
      const status = processManager.getStatus();
      res.status(503).type('html').send(renderStatusPage(status));
      return;
    }

    proxy(req, res, next);
  });

  const server = createServer(app);

  // Proxy WebSocket upgrades
  server.on('upgrade', (req, socket: Socket, head) => {
    if (processManager.getStatus().running) {
      proxy.upgrade?.(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  return server;
}
