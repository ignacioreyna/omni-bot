import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import os from 'os';
import { realpath } from 'fs/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { appConfig } from '../config.js';
import { cfAccessMiddleware } from './middleware/cf-access.js';
import { listCandidateDirectories } from './directories.js';
import {
  createSession,
  isPathAllowed,
  killSession,
  listSessions,
  sessionExists,
} from '../tmux/tmux.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const publicDir = path.join(__dirname, '../../public');

function packageDir(name: string): string {
  return path.dirname(require.resolve(`${name}/package.json`));
}

const createSessionSchema = z.object({
  cwd: z.string().min(1),
  name: z.string().max(64).optional(),
  command: z.string().max(500).optional(),
});

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export function createApp(): express.Application {
  const app = express();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(cfAccessMiddleware);
  app.use(express.json());

  app.use('/vendor/xterm', express.static(packageDir('@xterm/xterm')));
  app.use('/vendor/addon-fit', express.static(packageDir('@xterm/addon-fit')));
  app.use('/vendor/addon-web-links', express.static(packageDir('@xterm/addon-web-links')));
  app.use(express.static(publicDir));

  app.get('/api/config', (req: Request, res: Response) => {
    res.json({
      user: req.user?.email,
      home: os.homedir(),
      defaultCommand: appConfig.defaultCommand,
    });
  });

  app.get(
    '/api/sessions',
    asyncHandler(async (_req, res) => {
      res.json(await listSessions());
    })
  );

  app.post(
    '/api/sessions',
    asyncHandler(async (req, res) => {
      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
        return;
      }

      let cwd: string;
      try {
        cwd = await realpath(parsed.data.cwd);
      } catch {
        res.status(400).json({ error: 'Directory does not exist' });
        return;
      }
      if (!isPathAllowed(cwd, appConfig.allowedDirectories)) {
        res.status(403).json({ error: 'Directory not allowed' });
        return;
      }

      const name = await createSession({ ...parsed.data, cwd });
      res.status(201).json({ name });
    })
  );

  app.delete(
    '/api/sessions/:name',
    asyncHandler(async (req, res) => {
      const name = String(req.params.name);
      if (!(await sessionExists(name))) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      await killSession(name);
      res.status(204).end();
    })
  );

  app.get(
    '/api/directories',
    asyncHandler(async (_req, res) => {
      res.json(await listCandidateDirectories(appConfig.allowedDirectories));
    })
  );

  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
