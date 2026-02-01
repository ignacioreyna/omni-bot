import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { appConfig } from '../../config.js';

// User info extracted from CF Access JWT
export interface CfAccessUser {
  email: string;
  sub: string; // User ID
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: CfAccessUser;
    }
  }
}

// Cache for CF public keys (keyed by kid)
const publicKeyCache: Map<string, { key: string; expiresAt: number }> = new Map();
const KEY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetches Cloudflare Access public keys for JWT verification
 */
async function getCfPublicKeys(): Promise<Record<string, string>> {
  const teamDomain = appConfig.cfAccessTeamDomain;
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;

  console.log('[CF Access] Fetching certs from:', certsUrl);

  const response = await fetch(certsUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch CF Access certs: ${response.status}`);
  }

  const data = (await response.json()) as { keys?: Array<{ kid: string; cert: string }>; public_certs?: Array<{ kid: string; cert: string }> };

  console.log('[CF Access] Certs response keys:', Object.keys(data));

  // CF Access returns "public_certs" not "keys"
  const certArray = data.public_certs || data.keys || [];

  const keys: Record<string, string> = {};
  for (const key of certArray) {
    keys[key.kid] = key.cert;
    publicKeyCache.set(key.kid, {
      key: key.cert,
      expiresAt: Date.now() + KEY_CACHE_TTL,
    });
  }

  console.log('[CF Access] Loaded key IDs:', Object.keys(keys));

  return keys;
}

/**
 * Gets a public key by kid, using cache if available
 */
async function getPublicKey(kid: string): Promise<string> {
  const cached = publicKeyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  const keys = await getCfPublicKeys();
  const key = keys[kid];
  if (!key) {
    throw new Error(`Unknown key ID: ${kid}`);
  }
  return key;
}

/**
 * Validates a Cloudflare Access JWT and returns the user info
 */
async function validateCfAccessJwt(token: string): Promise<CfAccessUser> {
  // Decode header to get kid
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid JWT format');
  }

  const kid = decoded.header.kid;
  if (!kid) {
    throw new Error('JWT missing key ID');
  }

  // Get public key
  const publicKey = await getPublicKey(kid);

  // Verify JWT
  const payload = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    audience: appConfig.cfAccessAud,
    issuer: `https://${appConfig.cfAccessTeamDomain}`,
  }) as jwt.JwtPayload;

  if (!payload.email || !payload.sub) {
    throw new Error('JWT missing required claims');
  }

  return {
    email: payload.email as string,
    sub: payload.sub,
  };
}

/**
 * Express middleware that validates Cloudflare Access JWT
 * In tailscale mode, this is a no-op
 */
export function cfAccessMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in tailscale mode
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

  validateCfAccessJwt(token)
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
    return await validateCfAccessJwt(token);
  } catch {
    return null;
  }
}
