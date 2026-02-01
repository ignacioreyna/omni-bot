import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { coordinator } from '../../coordinator/coordinator.js';
import { appConfig } from '../../config.js';
import { transcribeAudio } from '../../whisper/transcriber.js';

const router = Router();

const upload = multer({ dest: '/tmp/omni-bot-audio/' });

const createSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  workingDirectory: z.string().min(1),
});

const forkSessionSchema = z.object({
  name: z.string().min(1).max(100),
  workingDirectory: z.string().min(1),
  localSessionId: z.string().min(1),
});

interface SessionParams {
  id: string;
}

router.get('/', (req: Request, res: Response) => {
  const ownerEmail = req.user?.email;
  const sessions = coordinator.getAllSessions(ownerEmail);
  // Add isDraft flag to each session
  const sessionsWithDraftFlag = sessions.map((session) => ({
    ...session,
    isDraft: coordinator.isDraftSession(session.id),
  }));
  res.json(sessionsWithDraftFlag);
});

router.get('/allowed-directories', (_req: Request, res: Response) => {
  res.json(appConfig.allowedDirectories);
});

interface BrowseQuery {
  base?: string;
  path?: string;
}

router.get('/browse', (req: Request<unknown, unknown, unknown, BrowseQuery>, res: Response) => {
  const base = req.query.base;
  const subpath = req.query.path || '';

  if (!base) {
    res.status(400).json({ error: 'Base directory required' });
    return;
  }

  // Validate base is in allowed directories
  if (!appConfig.allowedDirectories.includes(base)) {
    res.status(403).json({ error: 'Directory not allowed' });
    return;
  }

  const fullPath = path.join(base, subpath);

  // Prevent path traversal (ensure still under base)
  const normalizedFull = path.normalize(fullPath);
  const normalizedBase = path.normalize(base);
  if (!normalizedFull.startsWith(normalizedBase)) {
    res.status(403).json({ error: 'Invalid path' });
    return;
  }

  try {
    // Check if directory exists
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    // List directories only (not files), exclude hidden
    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();

    res.json({
      currentPath: subpath,
      directories: entries
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.post('/', (req: Request, res: Response) => {
  const result = createSessionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    return;
  }

  const ownerEmail = req.user?.email ?? 'local@tailscale';

  try {
    const session = coordinator.createSession(
      result.data.name, // undefined if not provided
      result.data.workingDirectory,
      ownerEmail
    );

    // For draft sessions, include isDraft flag for frontend awareness
    const isDraft = coordinator.isDraftSession(session.id);
    res.status(201).json({ ...session, isDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/sessions/fork
 * Fork a local Claude Code session into an omni-bot session.
 */
router.post('/fork', (req: Request, res: Response) => {
  const result = forkSessionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    return;
  }

  const ownerEmail = req.user?.email ?? 'local@tailscale';

  try {
    const session = coordinator.forkSession(
      result.data.name,
      result.data.workingDirectory,
      ownerEmail,
      result.data.localSessionId
    );
    res.status(201).json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

router.get('/:id', (req: Request<SessionParams>, res: Response) => {
  const session = coordinator.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  // Check ownership
  if (req.user && session.ownerEmail !== req.user.email) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const isDraft = coordinator.isDraftSession(session.id);
  res.json({ ...session, isDraft });
});

router.post('/:id/pause', (req: Request<SessionParams>, res: Response) => {
  const session = coordinator.pauseSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

router.post('/:id/resume', (req: Request<SessionParams>, res: Response) => {
  try {
    const session = coordinator.resumeSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

router.post('/:id/terminate', (req: Request<SessionParams>, res: Response) => {
  const success = coordinator.terminateSession(req.params.id);
  if (!success) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ success: true });
});

router.post('/:id/abort', (req: Request<SessionParams>, res: Response) => {
  coordinator.abortSession(req.params.id);
  res.json({ success: true });
});

router.get('/:id/status', (req: Request<SessionParams>, res: Response) => {
  const session = coordinator.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    ...session,
    isBusy: coordinator.isSessionBusy(req.params.id),
  });
});

router.post('/:id/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  const session = coordinator.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (req.user && session.ownerEmail !== req.user.email) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No audio file provided' });
    return;
  }

  try {
    const transcript = await transcribeAudio(req.file.path);
    fs.unlinkSync(req.file.path);
    res.json({ transcript });
  } catch (err) {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore cleanup error
      }
    }
    const message = err instanceof Error ? err.message : 'Transcription failed';
    res.status(500).json({ error: message });
  }
});

export default router;
