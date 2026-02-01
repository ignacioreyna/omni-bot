import { Router, Request, Response } from 'express';
import { scanLocalSessions } from '../../local-sessions/scanner.js';

const router = Router();

/**
 * GET /api/local-sessions
 * List all local Claude Code sessions from ~/.claude/projects
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const sessions = scanLocalSessions();
    res.json(sessions);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan local sessions';
    res.status(500).json({ error: message });
  }
});

export default router;
