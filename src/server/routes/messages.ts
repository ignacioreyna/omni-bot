import { Router, Request, Response } from 'express';
import { coordinator } from '../../coordinator/coordinator.js';

const router = Router();

interface MessageParams {
  sessionId: string;
}

router.get('/search', (req: Request, res: Response) => {
  const query = req.query.q as string | undefined;
  const sessionId = req.query.sessionId as string | undefined;

  if (!query) {
    res.status(400).json({ error: 'Query parameter "q" is required' });
    return;
  }

  const messages = coordinator.searchMessages(query, sessionId);
  res.json(messages);
});

router.get('/:sessionId', (req: Request<MessageParams>, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;

  const session = coordinator.getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const messages = coordinator.getMessages(req.params.sessionId, limit, offset);
  res.json(messages);
});

export default router;
