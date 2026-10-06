import { describe, expect, it } from 'vitest';
import { hasAncestor, isSessionId, summarizeTranscript } from '../claude-sessions.js';

const line = (record: Record<string, unknown>): string => JSON.stringify(record);

describe('summarizeTranscript', () => {
  const base = [
    line({
      type: 'attachment',
      cwd: '/repo',
      entrypoint: 'cli',
      timestamp: '2026-10-01T10:00:00Z',
    }),
    line({
      type: 'user',
      message: { content: '<command-name>/clear</command-name>' },
      timestamp: '2026-10-01T10:00:01Z',
    }),
    line({
      type: 'user',
      message: { content: [{ type: 'text', text: 'fix the  flaky\ntest' }] },
      timestamp: '2026-10-01T10:00:02Z',
    }),
    line({ type: 'assistant', timestamp: '2026-10-01T10:05:00Z' }),
  ];

  it('falls back to the first real prompt, skipping tagged command blocks', () => {
    expect(summarizeTranscript(base)).toEqual({
      title: 'fix the flaky test',
      cwd: '/repo',
      entrypoint: 'cli',
      lastActivity: '2026-10-01T10:05:00Z',
    });
  });

  it('prefers the custom title over the AI title, using the latest of each', () => {
    const lines = [
      line({ type: 'ai-title', aiTitle: 'ai one' }),
      line({ type: 'custom-title', customTitle: 'old name' }),
      ...base,
      line({ type: 'custom-title', customTitle: 'renamed' }),
    ];
    expect(summarizeTranscript(lines).title).toBe('renamed');
  });

  it('ignores lines cut in half at read boundaries', () => {
    expect(summarizeTranscript(['{"type":"ai-ti', ...base]).cwd).toBe('/repo');
  });

  it('reports the entrypoint of headless runs', () => {
    expect(
      summarizeTranscript([
        line({ type: 'user', entrypoint: 'sdk-cli', message: { content: 'x' } }),
      ]).entrypoint
    ).toBe('sdk-cli');
  });
});

describe('hasAncestor', () => {
  // 500 (claude) -> 400 (subshell) -> 300 (pane shell) -> 1
  const parents = new Map([
    [500, 400],
    [400, 300],
    [300, 1],
    [900, 1],
  ]);

  it('finds a tmux pane shell up the process tree', () => {
    expect(hasAncestor(500, new Set([300]), parents)).toBe(true);
  });

  it('is false for processes outside tmux', () => {
    expect(hasAncestor(900, new Set([300]), parents)).toBe(false);
  });
});

describe('isSessionId', () => {
  it('accepts UUIDs only, so ids are safe to interpolate into a shell command', () => {
    expect(isSessionId('278953c4-06e3-40dc-9ed7-9dfaed9b7111')).toBe(true);
    expect(isSessionId('278953c4-06e3-40dc-9ed7-9dfaed9b7111; rm -rf ~')).toBe(false);
  });
});
