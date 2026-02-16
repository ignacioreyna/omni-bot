import jwt from 'jsonwebtoken';

export interface CfJwtConfig {
  teamDomain: string;
  aud: string;
}

export interface CfAccessUser {
  email: string;
  sub: string;
}

// Cache for CF public keys (keyed by kid)
const publicKeyCache: Map<string, { key: string; expiresAt: number }> = new Map();
const KEY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCfPublicKeys(teamDomain: string): Promise<Record<string, string>> {
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;

  const response = await fetch(certsUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch CF Access certs: ${response.status}`);
  }

  const data = (await response.json()) as {
    keys?: Array<{ kid: string; cert: string }>;
    public_certs?: Array<{ kid: string; cert: string }>;
  };

  const certArray = data.public_certs || data.keys || [];

  const keys: Record<string, string> = {};
  for (const key of certArray) {
    keys[key.kid] = key.cert;
    publicKeyCache.set(key.kid, {
      key: key.cert,
      expiresAt: Date.now() + KEY_CACHE_TTL,
    });
  }

  return keys;
}

async function getPublicKey(kid: string, teamDomain: string): Promise<string> {
  const cached = publicKeyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  const keys = await getCfPublicKeys(teamDomain);
  const key = keys[kid];
  if (!key) {
    throw new Error(`Unknown key ID: ${kid}`);
  }
  return key;
}

export async function validateCfAccessJwt(token: string, config: CfJwtConfig): Promise<CfAccessUser> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid JWT format');
  }

  const kid = decoded.header.kid;
  if (!kid) {
    throw new Error('JWT missing key ID');
  }

  const publicKey = await getPublicKey(kid, config.teamDomain);

  const payload = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    audience: config.aud,
    issuer: `https://${config.teamDomain}`,
  }) as jwt.JwtPayload;

  if (!payload.email || !payload.sub) {
    throw new Error('JWT missing required claims');
  }

  return {
    email: payload.email as string,
    sub: payload.sub,
  };
}
