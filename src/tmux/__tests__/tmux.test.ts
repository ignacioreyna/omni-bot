import { execFileSync } from 'child_process';
import { mkdtempSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

const SOCKET = `omni-bot-test-${process.pid}`;
process.env.TMUX_SOCKET_NAME = SOCKET;
// Would leak into every shell if the tmux server inherited omni-bot's environment
process.env.PORT = '3001';
process.env.CLAUDECODE = '1';
// Like launchd: no locale, which makes tmux mangle the tab-separated list-sessions output
delete process.env.LANG;
delete process.env.LC_ALL;
delete process.env.LC_CTYPE;

const {
  createSession,
  isPathAllowed,
  killSession,
  listSessions,
  parseSessionLine,
  sanitizeSessionName,
  sessionExists,
  tmuxEnv,
} = await import('../tmux.js');

function hasTmux(): boolean {
  try {
    execFileSync('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

describe('sanitizeSessionName', () => {
  it('replaces characters tmux rejects in target names', () => {
    expect(sanitizeSessionName('my.repo:feat/x')).toBe('my-repo-feat-x');
  });

  it('trims leading and trailing separators', () => {
    expect(sanitizeSessionName('  .hidden. ')).toBe('hidden');
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

describe('parseSessionLine', () => {
  it('parses tmux list-sessions output', () => {
    const session = parseSessionLine('api\t2\t1\t1700000000\t1700000060\t/tmp/api\tclaude');
    expect(session).toEqual({
      name: 'api',
      windows: 2,
      attachedClients: 1,
      createdAt: new Date(1700000000 * 1000).toISOString(),
      lastActivity: new Date(1700000060 * 1000).toISOString(),
      cwd: '/tmp/api',
      command: 'claude',
    });
  });

  it('normalizes the native claude binary name', () => {
    expect(parseSessionLine('a\t1\t0\t0\t0\t/tmp\tclaude.exe')?.command).toBe('claude');
  });

  it('ignores malformed lines', () => {
    expect(parseSessionLine('garbage')).toBeNull();
  });
});

describe.runIf(hasTmux())('tmux integration', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'omni-bot-')));

  afterAll(() => {
    try {
      execFileSync('tmux', ['-L', SOCKET, 'kill-server']);
    } catch {
      // server already gone
    }
  });

  it('returns an empty list when no server is running', async () => {
    expect(await listSessions()).toEqual([]);
  });

  it('creates, lists, de-duplicates and kills sessions', async () => {
    const first = await createSession({ cwd: dir, name: 'proj' });
    const second = await createSession({ cwd: dir, name: 'proj' });
    expect([first, second]).toEqual(['proj', 'proj-2']);

    const sessions = await listSessions();
    expect(sessions.map((s) => s.name).sort()).toEqual(['proj', 'proj-2']);
    expect(sessions[0].cwd).toBe(dir);

    await killSession('proj');
    expect(await sessionExists('proj')).toBe(false);
    expect(await sessionExists('proj-2')).toBe(true);
  });

  it('starts the tmux server without omni-bot or Claude Code variables', () => {
    const globalEnv = execFileSync('tmux', ['-L', SOCKET, 'show-environment', '-g']).toString();
    expect(globalEnv).not.toMatch(/^PORT=/m);
    expect(globalEnv).not.toMatch(/^CLAUDECODE=/m);
    expect(globalEnv).not.toMatch(/^TMUX_SOCKET_NAME=/m);
    expect(globalEnv).not.toMatch(/^AI_AGENT=/m);
  });

  it('does not prefix-match session names', async () => {
    await createSession({ cwd: dir, name: 'alpha-long' });
    expect(await sessionExists('alpha')).toBe(false);
  });
});
