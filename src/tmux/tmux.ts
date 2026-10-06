import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { appConfig, OMNI_BOT_ENV_KEYS } from '../config.js';

const execFileAsync = promisify(execFile);

/**
 * A terminal is a tmux pane, identified by its server-wide pane id (`%12`). Sessions are
 * an implementation detail: the desktop typically runs one session (`main`) with a window
 * per tab, and each phone connection gets its own grouped `omni-*` view session.
 */
export interface TmuxPane {
  paneId: string;
  session: string;
  windowIndex: number;
  windowName: string;
  cwd: string;
  command: string;
  panePid: number;
  lastActivity: string;
}

export interface CreateTerminalOptions {
  cwd: string;
  name?: string;
  command?: string;
}

export class LastPaneError extends Error {
  constructor(session: string) {
    super(`Refusing to kill the last terminal of session "${session}"`);
  }
}

/** Per-connection grouped sessions created by omni-bot; never listed as terminals. */
export const VIEW_SESSION_PREFIX = 'omni-';

const FIELD_SEPARATOR = '\t';
const PANE_FORMAT = [
  '#{pane_id}',
  '#{session_name}',
  '#{window_index}',
  '#{window_name}',
  '#{pane_current_path}',
  '#{pane_current_command}',
  '#{pane_pid}',
  '#{window_activity}',
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
  // launchd sets no locale. Without UTF-8, tmux rewrites tabs in -F output to "_" (breaking
  // parsing) and treats attached clients as non-UTF-8 (mangling Claude Code's TUI)
  if (!env.LC_ALL && !env.LC_CTYPE && !env.LANG) env.LANG = 'en_US.UTF-8';
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

/**
 * Exact-match session target; a bare name would let tmux prefix-match another session.
 * Commands taking a pane target (set-option, display, send-keys) need `=name:` instead.
 */
export function sessionTarget(name: string): string {
  return `=${name}`;
}

export function isPaneId(value: string): boolean {
  return /^%\d+$/.test(value);
}

/** Hidden sessions (`_terminals`-style helpers) and omni-bot's own view sessions. */
export function isHiddenSession(name: string): boolean {
  return name.startsWith('_') || name.startsWith(VIEW_SESSION_PREFIX);
}

export function sanitizeWindowName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_ .-]+/g, '-')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 64);
}

export function isPathAllowed(target: string, allowedDirectories: string[]): boolean {
  const resolved = path.resolve(target);
  return allowedDirectories.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
}

export function parsePaneLine(line: string): TmuxPane | null {
  const parts = line.split(FIELD_SEPARATOR);
  if (parts.length < 8) return null;
  const [paneId, session, windowIndex, windowName, cwd, command, panePid, activity] = parts;
  return {
    paneId,
    session,
    windowIndex: Number(windowIndex),
    windowName,
    cwd,
    // Claude Code's native binary reports itself as claude.exe
    command: command.replace(/\.exe$/, ''),
    panePid: Number(panePid),
    lastActivity: new Date(Number(activity) * 1000).toISOString(),
  };
}

/** Every visible pane once: grouped sessions (ours or the user's) repeat the same panes. */
export async function listPanes(): Promise<TmuxPane[]> {
  let out: string;
  try {
    out = await tmux(['list-panes', '-a', '-F', PANE_FORMAT]);
  } catch (err) {
    if (isNoServerError(err)) return [];
    throw err;
  }

  const panes = new Map<string, TmuxPane>();
  for (const line of out.split('\n')) {
    const pane = parsePaneLine(line);
    if (pane && !isHiddenSession(pane.session) && !panes.has(pane.paneId)) {
      panes.set(pane.paneId, pane);
    }
  }
  return [...panes.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

/** PIDs of the shells running in every tmux pane (empty when no server is running). */
export async function listPanePids(): Promise<number[]> {
  try {
    const out = await tmux(['list-panes', '-a', '-F', '#{pane_pid}']);
    return out.split('\n').filter(Boolean).map(Number);
  } catch (err) {
    if (isNoServerError(err)) return [];
    throw err;
  }
}

async function sessionExists(name: string): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', sessionTarget(name)]);
    return true;
  } catch {
    return false;
  }
}

/** Session and window of a pane, or null if it is gone. */
export async function paneLocation(
  paneId: string
): Promise<{ session: string; windowId: string } | null> {
  if (!isPaneId(paneId)) return null;
  try {
    // display -t on a missing pane exits 0 with empty output, so compare the echoed id
    const out = await tmux([
      'display-message',
      '-p',
      '-t',
      paneId,
      '#{pane_id}\t#{session_name}\t#{window_id}',
    ]);
    const [id, session, windowId] = out.trim().split(FIELD_SEPARATOR);
    return id === paneId ? { session, windowId } : null;
  } catch {
    return null;
  }
}

/** Opens a new window (a tab on the desktop) in the main session and returns its pane id. */
export async function createTerminal(opts: CreateTerminalOptions): Promise<string> {
  const main = appConfig.tmuxMainSession;
  const nameArgs = opts.name ? ['-n', sanitizeWindowName(opts.name) || 'terminal'] : [];
  const printPane = ['-P', '-F', '#{pane_id}'];

  const out = (await sessionExists(main))
    ? await tmux([
        'new-window',
        '-t',
        `${sessionTarget(main)}:`,
        '-c',
        opts.cwd,
        ...nameArgs,
        ...printPane,
      ])
    : await tmux(['new-session', '-d', '-s', main, '-c', opts.cwd, ...nameArgs, ...printPane]);
  const paneId = out.trim();

  // Server-wide: Claude Code asks for it to track terminal focus
  await tmux(['set-option', '-g', 'focus-events', 'on']);
  if (opts.command) {
    await tmux(['send-keys', '-t', paneId, opts.command, 'Enter']);
  }
  return paneId;
}

/** Kills a pane (its window goes with it if it was the only pane), never a whole session. */
export async function killTerminal(paneId: string): Promise<void> {
  const location = await paneLocation(paneId);
  if (!location) return;
  const panesInSession = (await tmux(['list-panes', '-s', '-t', paneId, '-F', '#{pane_id}']))
    .split('\n')
    .filter(Boolean);
  if (panesInSession.length <= 1) throw new LastPaneError(location.session);
  await tmux(['kill-pane', '-t', paneId]);
}

/**
 * tmux argv that creates and attaches a view session grouped with the pane's session,
 * focused on the pane. The phone gets its own current window, so switching tabs there
 * never moves the desktop. destroy-unattached must be set while a client is attached
 * (tmux destroys an unattached session the moment it is set), hence one command line.
 */
export function viewSessionArgs(
  viewSession: string,
  location: { session: string; windowId: string },
  paneId: string
): string[] {
  const view = `${sessionTarget(viewSession)}:`;
  // prettier-ignore
  return tmuxArgs([
    '-u', 'new-session', '-t', sessionTarget(location.session), '-s', viewSession, ';',
    'set-option', '-t', view, 'destroy-unattached', 'on', ';',
    // Only on the view session: the desktop's session keeps its own status bar and mouse
    'set-option', '-t', view, 'status', 'off', ';',
    'set-option', '-t', view, 'mouse', 'on', ';',
    'select-window', '-t', `${view}${location.windowId}`, ';',
    'select-pane', '-t', paneId,
  ]);
}

export async function killViewSession(viewSession: string): Promise<void> {
  await tmux(['kill-session', '-t', sessionTarget(viewSession)]).catch(() => undefined);
}

export async function scrollPane(paneId: string, direction: 'up' | 'down'): Promise<void> {
  if (direction === 'up') {
    await tmux(['copy-mode', '-u', '-t', paneId]);
    return;
  }
  // page-down only exists inside copy-mode; outside it there is nothing to scroll
  await tmux(['send-keys', '-X', '-t', paneId, 'page-down']).catch(() => undefined);
}

export async function exitScrollMode(paneId: string): Promise<void> {
  await tmux(['send-keys', '-X', '-t', paneId, 'cancel']).catch(() => undefined);
}
