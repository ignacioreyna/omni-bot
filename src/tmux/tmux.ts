import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { appConfig, OMNI_BOT_ENV_KEYS } from '../config.js';

const execFileAsync = promisify(execFile);

export interface TmuxSession {
  name: string;
  windows: number;
  attachedClients: number;
  createdAt: string;
  lastActivity: string;
  cwd: string;
  command: string;
}

export interface CreateSessionOptions {
  cwd: string;
  name?: string;
  command?: string;
}

const FIELD_SEPARATOR = '\t';
const SESSION_FORMAT = [
  '#{session_name}',
  '#{session_windows}',
  '#{session_attached}',
  '#{session_created}',
  '#{session_activity}',
  '#{pane_current_path}',
  '#{pane_current_command}',
].join(FIELD_SEPARATOR);

export function tmuxArgs(args: string[]): string[] {
  return appConfig.tmuxSocketName ? ['-L', appConfig.tmuxSocketName, ...args] : args;
}

/**
 * Environment for tmux invocations. Whichever call starts the tmux server fixes the
 * global environment of every future shell, so drop omni-bot's own config and any
 * Claude Code session variables (omni-bot may itself be launched from Claude Code);
 * the login shell re-exports whatever the user actually wants.
 */
export function tmuxEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const isClaudeCodeVar = key.startsWith('CLAUDE') || key === 'AI_AGENT';
    if (value === undefined || OMNI_BOT_ENV_KEYS.has(key) || isClaudeCodeVar || key === 'TMUX')
      continue;
    env[key] = value;
  }
  return env;
}

async function tmux(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', tmuxArgs(args), { env: tmuxEnv() });
  return stdout;
}

function isNoServerError(err: unknown): boolean {
  const stderr = (err as { stderr?: string }).stderr ?? '';
  return /no server running|error connecting to|No such file or directory/.test(stderr);
}

/** Exact-match target; a bare name would let tmux prefix-match another session. */
export function sessionTarget(name: string): string {
  return `=${name}`;
}

export function sanitizeSessionName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isPathAllowed(target: string, allowedDirectories: string[]): boolean {
  const resolved = path.resolve(target);
  return allowedDirectories.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
}

export function parseSessionLine(line: string): TmuxSession | null {
  const parts = line.split(FIELD_SEPARATOR);
  if (parts.length < 7) return null;
  const [name, windows, attached, created, activity, cwd, command] = parts;
  return {
    name,
    windows: Number(windows),
    attachedClients: Number(attached),
    createdAt: new Date(Number(created) * 1000).toISOString(),
    lastActivity: new Date(Number(activity) * 1000).toISOString(),
    cwd,
    // Claude Code's native binary reports itself as claude.exe
    command: command.replace(/\.exe$/, ''),
  };
}

export async function listSessions(): Promise<TmuxSession[]> {
  try {
    const out = await tmux(['list-sessions', '-F', SESSION_FORMAT]);
    return out
      .split('\n')
      .filter(Boolean)
      .map(parseSessionLine)
      .filter((s): s is TmuxSession => s !== null)
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  } catch (err) {
    if (isNoServerError(err)) return [];
    throw err;
  }
}

export async function sessionExists(name: string): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', sessionTarget(name)]);
    return true;
  } catch {
    return false;
  }
}

async function uniqueName(base: string): Promise<string> {
  const existing = new Set((await listSessions()).map((s) => s.name));
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export async function createSession(opts: CreateSessionOptions): Promise<string> {
  const base = sanitizeSessionName(opts.name || path.basename(opts.cwd)) || 'session';
  const name = await uniqueName(base);

  const pane = `${sessionTarget(name)}:`;
  await tmux(['new-session', '-d', '-s', name, '-c', opts.cwd, '-x', '200', '-y', '50']);
  // mouse: touch scrolling arrives as wheel events; status: a wasted row on a phone screen
  await tmux([
    'set-option',
    '-t',
    pane,
    'mouse',
    'on',
    ';',
    'set-option',
    '-t',
    pane,
    'status',
    'off',
  ]);

  if (opts.command) {
    await tmux(['send-keys', '-t', pane, opts.command, 'Enter']);
  }

  return name;
}

export async function killSession(name: string): Promise<void> {
  await tmux(['kill-session', '-t', sessionTarget(name)]);
}

export async function scrollSession(name: string, direction: 'up' | 'down'): Promise<void> {
  const target = `${sessionTarget(name)}:`;
  if (direction === 'up') {
    await tmux(['copy-mode', '-u', '-t', target]);
    return;
  }
  // page-down only exists inside copy-mode; outside it there is nothing to scroll
  await tmux(['send-keys', '-X', '-t', target, 'page-down']).catch(() => undefined);
}

export async function exitScrollMode(name: string): Promise<void> {
  await tmux(['send-keys', '-X', '-t', `${sessionTarget(name)}:`, 'cancel']).catch(() => undefined);
}
