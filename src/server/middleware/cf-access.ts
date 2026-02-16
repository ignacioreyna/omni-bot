import { Request, Response, NextFunction } from 'express';
import { appConfig } from '../../config.js';
import { validateCfAccessJwt, type CfAccessUser } from '../../shared/cf-jwt.js';

export type { CfAccessUser };

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: CfAccessUser;
    }
  }
}

/**
 * Express middleware that validates Cloudflare Access JWT.
 * In tailscale mode, this is a no-op.
 */
export function cfAccessMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (appConfig.authMode === 'tailscale') {
    req.user = { email: 'local@tailscale', sub: 'local' };
    next();
    return;
  }

  const token = req.headers['cf-access-jwt-assertion'] as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'Missing CF Access JWT' });
    return;
  }

  validateCfAccessJwt(token, {
    teamDomain: appConfig.cfAccessTeamDomain!,
    aud: appConfig.cfAccessAud!,
  })
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      console.error('[CF Access] JWT validation failed:', err.message);
      res.status(401).json({ error: 'Invalid CF Access JWT' });
    });
}

/**
 * Validates a CF Access JWT and returns user info (for use outside middleware)
 */
export async function validateToken(token: string): Promise<CfAccessUser | null> {
  if (appConfig.authMode === 'tailscale') {
    return { email: 'local@tailscale', sub: 'local' };
  }

  try {
    return await validateCfAccessJwt(token, {
      teamDomain: appConfig.cfAccessTeamDomain!,
      aud: appConfig.cfAccessAud!,
    });
  } catch {
    return null;
  }
}
