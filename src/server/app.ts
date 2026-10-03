import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { readFile, realpath } from 'fs/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { appConfig } from '../config.js';
import { cfAccessMiddleware } from './middleware/cf-access.js';
import { listCandidateDirectories } from './directories.js';
import {
  findLocalSession,
  isSessionId,
  listLocalSessions,
  stopLocalSession,
} from '../claude-sessions/claude-sessions.js';
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

const VERSIONED_ASSETS = ['/app.js', '/style.css'];

/**
 * index.html with content-hashed asset URLs. Browsers and the Cloudflare edge otherwise
 * keep serving a stale app.js/style.css next to a fresh index.html after a deploy.
 */
async function renderIndex(): Promise<string> {
  let html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
  for (const asset of VERSIONED_ASSETS) {
    const content = await readFile(path.join(publicDir, asset));
    const version = createHash('sha1').update(content).digest('hex').slice(0, 10);
    html = html.replace(`"${asset}"`, `"${asset}?v=${version}"`);
  }
  return html;
}

function packageDir(name: string): string {
  return path.dirname(require.resolve(`${name}/package.json`));
}

const createSessionSchema = z.object({
  cwd: z.string().min(1),
  name: z.string().max(64).optional(),
  command: z.string().max(500).optional(),
});

const resumeSchema = z.object({
  // Required for a session still running elsewhere: two processes must not share one transcript
  mode: z.enum(['fork', 'takeover']).optional(),
});

const RESUMED_NAME_MAX = 40;

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
  app.use(express.static(publicDir, { index: false }));

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

  app.get(
    '/api/local-sessions',
    asyncHandler(async (_req, res) => {
      res.json(await listLocalSessions());
    })
  );

  app.post(
    '/api/local-sessions/:id/resume',
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const parsed = resumeSchema.safeParse(req.body ?? {});
      if (!isSessionId(id) || !parsed.success) {
        res.status(400).json({ error: 'Invalid request' });
        return;
      }

      // cwd comes from Claude's own records, never from the client, so no directory guard here
      const session = await findLocalSession(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const { mode } = parsed.data;
      if (session.pid && !mode) {
        res.status(409).json({ error: 'Session is still running; fork it or take it over' });
        return;
      }
      if (session.pid && mode === 'takeover') {
        try {
          await stopLocalSession(session.pid);
        } catch (err) {
          res.status(409).json({ error: (err as Error).message });
          return;
        }
      }

      // `command` skips the user's `claude` shell function (worktree wrapper): resume in place
      const flags = session.pid && mode === 'fork' ? ' --fork-session' : '';
      const name = await createSession({
        cwd: session.cwd,
        name: session.title.slice(0, RESUMED_NAME_MAX),
        command: `command claude --resume ${id}${flags}`,
      });
      res.status(201).json({ name });
    })
  );

  app.get(
    '*',
    asyncHandler(async (_req, res) => {
      res
        .set('Cache-Control', 'no-cache')
        .type('html')
        .send(await renderIndex());
    })
  );

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
