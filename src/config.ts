import { config } from 'dotenv';
import { z } from 'zod';
import path from 'path';
import os from 'os';
import fs from 'fs';

const { parsed: envFileVars } = config();

/** omni-bot's own configuration (plus anything else in .env), which must not leak into tmux shells. */
export const OMNI_BOT_ENV_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(envFileVars ?? {}),
  'PORT',
  'ALLOWED_DIRECTORIES',
  'AUTH_MODE',
  'CF_ACCESS_TEAM_DOMAIN',
  'CF_ACCESS_AUD',
  'DEFAULT_COMMAND',
  'TMUX_SOCKET_NAME',
  'TMUX_MAIN_SESSION',
  'CLAUDE_ATTENTION_DIR',
  'OMNI_BOT_PORT',
  'OMNI_BOT_LOG_PATH',
]);

export function expandPath(p: string): string {
  let expanded = p;

  if (expanded.startsWith('~/')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  } else if (expanded === '~') {
    expanded = os.homedir();
  }

  expanded = expanded.replace(/\$HOME/g, os.homedir());
  expanded = expanded.replace(/\$\{?(\w+)\}?/g, (_, name: string) => process.env[name] || '');

  return expanded;
}

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  allowedDirectories: z
    .string()
    .default('/tmp')
    .transform((val) =>
      val
        .split(',')
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
    ),

  // "tailscale" = no app-level auth (network is trusted), "cloudflare" = CF Access JWT
  authMode: z.enum(['tailscale', 'cloudflare']).default('tailscale'),
  cfAccessTeamDomain: z.string().optional(),
  cfAccessAud: z.string().optional(),

  // Command typed into new sessions; the shell stays alive after it exits
  defaultCommand: z.string().default('claude'),
  // Optional dedicated tmux socket (tmux -L); default shares the user's tmux server
  tmuxSocketName: z.string().optional(),
  // Session where new terminals open as windows (the desktop's tabs)
  tmuxMainSession: z.string().min(1).default('main'),
  // Marker files (one per Claude session id) written by hooks while a session waits for input
  attentionDir: z.string().default('~/.cache/tmux-terminals/attention'),
});

function loadConfig() {
  const result = configSchema.safeParse({
    port: process.env.PORT,
    allowedDirectories: process.env.ALLOWED_DIRECTORIES,
    authMode: process.env.AUTH_MODE,
    cfAccessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
    cfAccessAud: process.env.CF_ACCESS_AUD,
    defaultCommand: process.env.DEFAULT_COMMAND,
    tmuxSocketName: process.env.TMUX_SOCKET_NAME || undefined,
    tmuxMainSession: process.env.TMUX_MAIN_SESSION || undefined,
    attentionDir: process.env.CLAUDE_ATTENTION_DIR || undefined,
  });

  if (!result.success) {
    console.error('Configuration validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  if (result.data.authMode === 'cloudflare') {
    if (!result.data.cfAccessTeamDomain || !result.data.cfAccessAud) {
      console.error(
        'Configuration error: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD required when AUTH_MODE=cloudflare'
      );
      process.exit(1);
    }
  }

  // Canonicalize so symlinked roots (e.g. macOS /tmp -> /private/tmp) match realpath'd session dirs
  const allowedDirectories = result.data.allowedDirectories
    .map((d) => path.resolve(expandPath(d)))
    .filter((d) => fs.existsSync(d))
    .map((d) => fs.realpathSync(d));

  return {
    ...result.data,
    allowedDirectories,
    attentionDir: path.resolve(expandPath(result.data.attentionDir)),
  };
}

export type Config = ReturnType<typeof loadConfig>;
export const appConfig = loadConfig();
