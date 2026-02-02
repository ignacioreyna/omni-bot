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

const updateSessionSchema = z.object({
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
  name: z.string().min(1).max(100).optional(),
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

interface SearchQuery {
  q?: string;
}

router.get('/search', (req: Request<unknown, unknown, unknown, SearchQuery>, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    res.status(400).json({ error: 'Query parameter q is required' });
    return;
  }

  const ownerEmail = req.user?.email;
  const query = q.trim().toLowerCase();

  // Get all sessions for this user
  const allSessions = coordinator.getAllSessions(ownerEmail);

  // Search session names
  const sessionNameMatches = new Set(
    allSessions
      .filter(s => !coordinator.isDraftSession(s.id) && 'name' in s && s.name.toLowerCase().includes(query))
      .map(s => s.id)
  );

  // Search message content using FTS
  const messageMatches = coordinator.searchMessages(query);
  const sessionIdsFromMessages = new Set(messageMatches.map(m => m.sessionId));

  // Combine results
  const matchingSessionIds = new Set([...sessionNameMatches, ...sessionIdsFromMessages]);

  // Filter sessions to only matching ones
  const matchingSessions = allSessions
    .filter(s => matchingSessionIds.has(s.id))
    .map((session) => ({
      ...session,
      isDraft: coordinator.isDraftSession(session.id),
    }));

  res.json(matchingSessions);
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

router.patch('/:id', (req: Request<SessionParams>, res: Response) => {
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

  const result = updateSessionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    return;
  }

  const updates: { model?: 'sonnet' | 'opus' | 'haiku'; name?: string } = {};
  if (result.data.model) {
    updates.model = result.data.model;
  }
  if (result.data.name) {
    updates.name = result.data.name;
  }

  const updatedSession = coordinator.updateSession(req.params.id, updates);
  if (!updatedSession) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const isDraft = coordinator.isDraftSession(updatedSession.id);
  res.json({ ...updatedSession, isDraft });
});

router.get('/:id/teleport', (req: Request<SessionParams>, res: Response) => {
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

  // Don't allow teleporting draft sessions
  if (coordinator.isDraftSession(req.params.id)) {
    res.status(400).json({ error: 'Cannot teleport draft session - send a message first' });
    return;
  }

  // Check if session has a claudeSessionId
  if (!('claudeSessionId' in session) || !session.claudeSessionId) {
    res.status(400).json({ error: 'Session has no Claude session ID - send a message first' });
    return;
  }

  // Generate the command to run in terminal
  const command = `cd ${session.workingDirectory} && claude --resume ${session.claudeSessionId}`;

  res.json({
    command,
    sessionId: session.claudeSessionId,
    workingDirectory: session.workingDirectory,
    name: 'name' in session ? session.name : 'Untitled',
  });
});

interface ExportQuery {
  format?: 'json' | 'markdown';
}

router.get('/:id/export', (req: Request<SessionParams, unknown, unknown, ExportQuery>, res: Response) => {
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

  // Don't export draft sessions
  if (coordinator.isDraftSession(req.params.id)) {
    res.status(400).json({ error: 'Cannot export draft session' });
    return;
  }

  const messages = coordinator.getMessages(req.params.id, 10000); // Get all messages
  const format = req.query.format || 'json';
  const sessionName = 'name' in session ? session.name : 'session';
  const safeName = sessionName.replace(/[^a-zA-Z0-9-_]/g, '_');

  if (format === 'markdown') {
    const md = formatAsMarkdown(session, messages);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
    res.send(md);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
    res.json({ session, messages });
  }
});

interface SessionLike {
  name?: string;
  workingDirectory: string;
  createdAt: string;
}

interface MessageLike {
  role: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

function formatAsMarkdown(session: SessionLike, messages: MessageLike[]): string {
  let md = `# ${session.name || 'Untitled Session'}\n\n`;
  md += `**Directory:** ${session.workingDirectory}\n`;
  md += `**Created:** ${session.createdAt}\n\n---\n\n`;

  for (const msg of messages) {
    const role = msg.role === 'user' ? '**User**' : '**Assistant**';
    const timestamp = new Date(msg.createdAt).toLocaleString();
    md += `${role} _(${timestamp})_:\n\n${msg.content}\n\n---\n\n`;
  }

  return md;
}

router.delete('/:id', (req: Request<SessionParams>, res: Response) => {
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

  // Don't allow deleting draft sessions via API
  if (coordinator.isDraftSession(req.params.id)) {
    res.status(400).json({ error: 'Cannot delete draft session' });
    return;
  }

  const success = coordinator.deleteSession(req.params.id);
  if (!success) {
    res.status(500).json({ error: 'Failed to delete session' });
    return;
  }

  res.json({ success: true });
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
