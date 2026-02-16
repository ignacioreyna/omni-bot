import { Router, Request, Response } from 'express';
import path from 'path';
import {
  scanLocalSessions,
  scanRecentSessions,
  scanSessionsByDirectory,
} from '../../local-sessions/scanner.js';
import { appConfig } from '../../config.js';

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

/**
 * GET /api/local-sessions/recent?limit=5
 * Get the N most recent sessions across all projects (flat list).
 */
router.get('/recent', (req: Request, res: Response) => {
  try {
    const raw = parseInt(req.query.limit as string, 10);
    const limit = Number.isNaN(raw) ? 5 : Math.max(1, Math.min(20, raw));
    const sessions = scanRecentSessions(limit);
    res.json(sessions);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan recent sessions';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/local-sessions/by-directory?path=/full/path
 * Get sessions for a specific directory (or any project under it).
 */
router.get('/by-directory', (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const resolved = path.resolve(dirPath);

    // Security: ensure path is under an allowed directory
    const isAllowed = appConfig.allowedDirectories.some(
      (allowed) => resolved === allowed || resolved.startsWith(allowed + path.sep)
    );
    if (!isAllowed) {
      res.status(403).json({ error: 'Directory not in allowed directories' });
      return;
    }

    const sessions = scanSessionsByDirectory(resolved);
    res.json(sessions);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan sessions by directory';
    res.status(500).json({ error: message });
  }
});

export default router;
