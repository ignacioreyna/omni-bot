import { execFileSync } from 'child_process';
import { mkdtempSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import * as pty from 'node-pty';
import { afterAll, describe, expect, it } from 'vitest';

// Integration tests run on their own tmux server, never the user's
const SOCKET = `omni-bot-test-${process.pid}`;
process.env.TMUX_SOCKET_NAME = SOCKET;
process.env.TMUX_MAIN_SESSION = 'main';
// Would leak into every shell if the tmux server inherited omni-bot's environment
process.env.PORT = '3001';
process.env.CLAUDECODE = '1';
// Like launchd: no locale, which makes tmux mangle the tab-separated list-panes output
delete process.env.LANG;
delete process.env.LC_ALL;
delete process.env.LC_CTYPE;

const {
  createTerminal,
  isHiddenSession,
  isPathAllowed,
  killTerminal,
  LastPaneError,
  listPanes,
  paneLocation,
  parsePaneLine,
  sanitizeWindowName,
  tmuxEnv,
  viewSessionArgs,
} = await import('../tmux.js');

function hasTmux(): boolean {
  try {
    execFileSync('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

// Same filtered env as omni-bot, since this helper is what boots the test server
function tmux(...args: string[]): string {
  return execFileSync('tmux', ['-L', SOCKET, ...args], { env: tmuxEnv() })
    .toString()
    .trim();
}

describe('sanitizeWindowName', () => {
  it('replaces characters that would break tmux targets', () => {
    expect(sanitizeWindowName('feat: repo/x')).toBe('feat- repo-x');
  });

  it('trims leading and trailing separators', () => {
    expect(sanitizeWindowName('  .hidden. ')).toBe('hidden');
  });
});

describe('isHiddenSession', () => {
  it('hides helper sessions and omni-bot view sessions', () => {
    expect(isHiddenSession('_terminals')).toBe(true);
    expect(isHiddenSession('omni-1a2b3c4d')).toBe(true);
    expect(isHiddenSession('main')).toBe(false);
  });
});

describe('isPathAllowed', () => {
  const roots = ['/Users/me/GIT'];

  it('accepts the root and its descendants', () => {
    expect(isPathAllowed('/Users/me/GIT', roots)).toBe(true);
    expect(isPathAllowed('/Users/me/GIT/repo/src', roots)).toBe(true);
  });

  it('rejects siblings sharing a prefix and traversal outside the root', () => {
    expect(isPathAllowed('/Users/me/GIT-other', roots)).toBe(false);
    expect(isPathAllowed('/Users/me/GIT/../.ssh', roots)).toBe(false);
  });
});

describe('tmuxEnv', () => {
  it('drops omni-bot config, Claude Code session vars and TMUX', () => {
    const env = tmuxEnv({
      HOME: '/h',
      PORT: '3001',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'x',
      TMUX: 's',
      PATH: '/bin',
    });
    expect(env).toEqual({ HOME: '/h', PATH: '/bin', LANG: 'en_US.UTF-8' });
  });

  it('keeps an existing locale', () => {
    expect(tmuxEnv({ LC_ALL: 'es_AR.UTF-8' })).toEqual({ LC_ALL: 'es_AR.UTF-8' });
  });
});

describe('parsePaneLine', () => {
  it('parses tmux list-panes output', () => {
    expect(parsePaneLine('%12\tmain\t3\tapi\t/tmp/api\tclaude.exe\t4242\t1700000060')).toEqual({
      paneId: '%12',
      session: 'main',
      windowIndex: 3,
      windowName: 'api',
      cwd: '/tmp/api',
      command: 'claude',
      panePid: 4242,
      lastActivity: new Date(1700000060 * 1000).toISOString(),
    });
  });

  it('ignores malformed lines', () => {
    expect(parsePaneLine('garbage')).toBeNull();
  });
});

describe.runIf(hasTmux())('tmux integration', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'omni-bot-')));

  afterAll(() => {
    try {
      tmux('kill-server');
    } catch {
      // server already gone
    }
  });

  it('returns an empty list when no server is running', async () => {
    expect(await listPanes()).toEqual([]);
  });

  it('creates the main session first, then opens terminals as windows in it', async () => {
    // Boot the server without the user's ~/.tmux.conf (it spawns helper sessions); the
    // hidden session keeps it alive
    tmux('-f', '/dev/null', 'new-session', '-d', '-s', '_keepalive', '-c', dir);

    const first = await createTerminal({ cwd: dir });
    const second = await createTerminal({ cwd: dir, name: 'resumed: chat' });

    expect(first).toMatch(/^%\d+$/);
    expect(tmux('list-windows', '-t', '=main', '-F', '#{window_name}').split('\n')).toHaveLength(2);
    expect(tmux('display', '-p', '-t', second, '#{session_name} #{window_name}')).toBe(
      'main resumed- chat'
    );
    // The desktop's session keeps its status bar: view-only options never touch it
    expect(tmux('show-options', '-t', '=main:', 'status')).toBe('');
  });

  it('starts the tmux server without omni-bot or Claude Code variables', () => {
    const globalEnv = tmux('show-environment', '-g');
    expect(globalEnv).not.toMatch(/^PORT=/m);
    expect(globalEnv).not.toMatch(/^CLAUDECODE=/m);
    expect(globalEnv).not.toMatch(/^TMUX_SOCKET_NAME=/m);
  });

  it('lists each pane once, hiding helper and grouped view sessions', async () => {
    tmux('new-session', '-d', '-s', '_terminals', '-c', dir);
    tmux('new-session', '-d', '-t', '=main', '-s', 'grouped-by-user');

    const panes = await listPanes();
    const ids = panes.map((p) => p.paneId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(panes).toHaveLength(2);
    expect(panes.every((p) => !p.session.startsWith('_'))).toBe(true);
    expect(panes[0].cwd).toBe(dir);

    tmux('kill-session', '-t', '=_terminals');
    tmux('kill-session', '-t', '=grouped-by-user');
  });

  it('locates live panes and rejects missing or malformed ids', async () => {
    const [pane] = await listPanes();
    expect(await paneLocation(pane.paneId)).toMatchObject({ session: 'main' });
    expect(await paneLocation('%99999')).toBeNull();
    expect(await paneLocation('main')).toBeNull();
  });

  it('attaches through a grouped view session without moving the main session', async () => {
    const panes = await listPanes();
    const target = panes.find((p) => p.windowIndex === 0)!;
    const other = panes.find((p) => p.windowIndex !== 0)!;
    tmux('select-window', '-t', `=main:${other.windowIndex}`);

    const location = (await paneLocation(target.paneId))!;
    const [command, ...args] = ['tmux', ...viewSessionArgs('omni-test', location, target.paneId)];
    const client = pty.spawn(command, args, { cols: 80, rows: 24, env: tmuxEnv() });
    await new Promise((r) => setTimeout(r, 800));

    expect(tmux('display', '-p', '-t', '=omni-test:', '#{pane_id} #{status}')).toBe(
      `${target.paneId} off`
    );
    expect(tmux('display', '-p', '-t', '=main:', '#{window_index}')).toBe(
      String(other.windowIndex)
    );
    expect((await listPanes()).map((p) => p.session)).not.toContain('omni-test');
    // A bare %pane resolves to the most recently used session of its group (the view session
    // here); the location must still name the user's session
    expect((await paneLocation(target.paneId))!.session).toBe('main');

    client.kill();
    await new Promise((r) => setTimeout(r, 800));
    expect(tmux('list-sessions', '-F', '#{session_name}').split('\n')).not.toContain('omni-test');
  });

  it('kills a terminal but never the last one of a session', async () => {
    const [first, second] = await listPanes();
    await killTerminal(first.paneId);
    expect((await listPanes()).map((p) => p.paneId)).toEqual([second.paneId]);
    await expect(killTerminal(second.paneId)).rejects.toBeInstanceOf(LastPaneError);
  });
});
