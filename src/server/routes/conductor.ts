import { Router, Request, Response } from 'express';
import { appConfig } from '../../config.js';
import { scanConductorWorkspaces } from '../../conductor/workspace-scanner.js';

const router = Router();

router.get('/available', (_req: Request, res: Response) => {
  res.json({
    available: appConfig.conductorWorkspacesPath !== null,
    path: appConfig.conductorWorkspacesPath,
  });
});

router.get('/workspaces', async (_req: Request, res: Response) => {
  try {
    const repos = await scanConductorWorkspaces();
    res.json(repos);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan Conductor workspaces';
    res.status(500).json({ error: message });
  }
});

export default router;
