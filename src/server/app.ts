import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sessionsRouter from './routes/sessions.js';
import messagesRouter from './routes/messages.js';
import authRouter from './routes/auth.js';
import localSessionsRouter from './routes/local-sessions.js';
import { cfAccessMiddleware } from './middleware/cf-access.js';
import { appConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  // Health check (no auth required)
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      authMode: appConfig.authMode,
    });
  });

  // Apply CF Access middleware to protected routes
  app.use('/api/auth', cfAccessMiddleware, authRouter);
  app.use('/api/sessions', cfAccessMiddleware, sessionsRouter);
  app.use('/api/messages', cfAccessMiddleware, messagesRouter);
  app.use('/api/local-sessions', cfAccessMiddleware, localSessionsRouter);

  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
