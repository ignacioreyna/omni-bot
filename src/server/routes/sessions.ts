import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { coordinator } from '../../coordinator/coordinator.js';
import { appConfig } from '../../config.js';

const router = Router();

const createSessionSchema = z.object({
  name: z.string().min(1).max(100),
  workingDirectory: z.string().min(1),
});

interface SessionParams {
  id: string;
}

router.get('/', (req: Request, res: Response) => {
  const ownerEmail = req.user?.email;
  const sessions = coordinator.getAllSessions(ownerEmail);
  res.json(sessions);
});

router.get('/allowed-directories', (_req: Request, res: Response) => {
  res.json(appConfig.allowedDirectories);
});

router.post('/', (req: Request, res: Response) => {
  const result = createSessionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    return;
  }

  const ownerEmail = req.user?.email ?? 'local@tailscale';

  try {
    const session = coordinator.createSession(result.data.name, result.data.workingDirectory, ownerEmail);
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
  res.json(session);
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

export default router;
