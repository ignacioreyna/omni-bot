import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { appConfig } from '../../config.js';

const router = Router();

// Short-lived WebSocket tokens (5 minutes)
const WS_TOKEN_TTL = 5 * 60 * 1000;

interface WsTokenData {
  email: string;
  sub: string;
  expiresAt: number;
}

// In-memory store for WS tokens (could use Redis for multi-instance)
const wsTokens: Map<string, WsTokenData> = new Map();

// Cleanup expired tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of wsTokens) {
    if (data.expiresAt < now) {
      wsTokens.delete(token);
    }
  }
}, 60 * 1000);

/**
 * GET /api/auth/me
 * Returns the current authenticated user info
 */
router.get('/me', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.json({
    email: req.user.email,
    sub: req.user.sub,
    authMode: appConfig.authMode,
  });
});

/**
 * POST /api/auth/ws-token
 * Exchanges CF Access JWT for a short-lived WebSocket token
 */
router.post('/ws-token', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  // Generate a random token
  const token = randomBytes(32).toString('hex');

  // Store with user info and expiry
  wsTokens.set(token, {
    email: req.user.email,
    sub: req.user.sub,
    expiresAt: Date.now() + WS_TOKEN_TTL,
  });

  res.json({
    token,
    expiresIn: WS_TOKEN_TTL / 1000, // seconds
  });
});

/**
 * Validates a WebSocket token and returns user info
 * Called by websocket.ts on connection
 */
export function validateWsToken(token: string): WsTokenData | null {
  // In tailscale mode, any token works (or no token needed)
  if (appConfig.authMode === 'tailscale') {
    return {
      email: 'local@tailscale',
      sub: 'local',
      expiresAt: Date.now() + WS_TOKEN_TTL,
    };
  }

  const data = wsTokens.get(token);
  if (!data) {
    return null;
  }

  if (data.expiresAt < Date.now()) {
    wsTokens.delete(token);
    return null;
  }

  // Token is single-use
  wsTokens.delete(token);
  return data;
}

export default router;
