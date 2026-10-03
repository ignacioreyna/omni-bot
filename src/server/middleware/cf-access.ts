import type { IncomingMessage } from 'http';
import { Request, Response, NextFunction } from 'express';
import { appConfig } from '../../config.js';
import { validateCfAccessJwt, type CfAccessUser } from '../../shared/cf-jwt.js';

export type { CfAccessUser };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augmentation requires a namespace
  namespace Express {
    interface Request {
      user?: CfAccessUser;
    }
  }
}

const LOCAL_USER: CfAccessUser = { email: 'local@tailscale', sub: 'local' };

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Cloudflare injects the JWT as a header on every proxied request, including
 * WebSocket upgrades; the CF_Authorization cookie is the fallback.
 */
export async function authenticate(req: IncomingMessage): Promise<CfAccessUser | null> {
  if (appConfig.authMode === 'tailscale') return LOCAL_USER;

  const header = req.headers['cf-access-jwt-assertion'];
  const token =
    (Array.isArray(header) ? header[0] : header) ??
    readCookie(req.headers.cookie, 'CF_Authorization');
  if (!token) return null;

  try {
    return await validateCfAccessJwt(token, {
      teamDomain: appConfig.cfAccessTeamDomain!,
      aud: appConfig.cfAccessAud!,
    });
  } catch (err) {
    console.error('[CF Access] JWT validation failed:', (err as Error).message);
    return null;
  }
}

export function cfAccessMiddleware(req: Request, res: Response, next: NextFunction): void {
  authenticate(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.user = user;
      next();
    })
    .catch(next);
}
