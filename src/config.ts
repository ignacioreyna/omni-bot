import { config } from 'dotenv';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import path from 'path';
import os from 'os';

config();

// Expand ~ and $HOME in paths
function expandPath(p: string): string {
  let expanded = p;

  // Expand ~ at start of path
  if (expanded.startsWith('~/')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  } else if (expanded === '~') {
    expanded = os.homedir();
  }

  // Expand $HOME
  expanded = expanded.replace(/\$HOME/g, os.homedir());

  // Expand other env vars like $VAR or ${VAR}
  expanded = expanded.replace(/\$\{?(\w+)\}?/g, (_, name) => process.env[name] || '');

  return expanded;
}

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  sessionSecret: z.string().min(16).default(() => randomBytes(32).toString('hex')),
  allowedDirectories: z
    .string()
    .default('/tmp')
    .transform((val) => val.split(',').map((d) => d.trim()).filter((d) => d.length > 0)),
  databasePath: z.string().default('./data/omni-bot.db'),
  maxConcurrentSessions: z.coerce.number().int().positive().default(5),

  // Auth mode: "tailscale" (no auth) or "cloudflare" (CF Access JWT)
  authMode: z.enum(['tailscale', 'cloudflare']).default('tailscale'),

  // Cloudflare Access settings (required if authMode=cloudflare)
  cfAccessTeamDomain: z.string().optional(), // e.g., "myteam.cloudflareaccess.com"
  cfAccessAud: z.string().optional(), // Application Audience tag from CF dashboard

  // Interactive permissions: relay tool approvals to web UI instead of auto-approving
  interactivePermissions: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

function loadConfig() {
  const result = configSchema.safeParse({
    port: process.env.PORT,
    sessionSecret: process.env.SESSION_SECRET,
    allowedDirectories: process.env.ALLOWED_DIRECTORIES,
    databasePath: process.env.DATABASE_PATH,
    maxConcurrentSessions: process.env.MAX_CONCURRENT_SESSIONS,
    authMode: process.env.AUTH_MODE,
    cfAccessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
    cfAccessAud: process.env.CF_ACCESS_AUD,
    interactivePermissions: process.env.INTERACTIVE_PERMISSIONS,
  });

  if (!result.success) {
    console.error('Configuration validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Validate CF Access config when in cloudflare mode
  if (result.data.authMode === 'cloudflare') {
    if (!result.data.cfAccessTeamDomain || !result.data.cfAccessAud) {
      console.error('Configuration error: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD required when AUTH_MODE=cloudflare');
      process.exit(1);
    }
  }

  return {
    ...result.data,
    databasePath: path.resolve(expandPath(result.data.databasePath)),
    allowedDirectories: result.data.allowedDirectories.map((d) => {
      const expanded = expandPath(d);
      // Only resolve if not already absolute
      return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
    }),
  };
}

export type Config = ReturnType<typeof loadConfig>;
export const appConfig = loadConfig();
