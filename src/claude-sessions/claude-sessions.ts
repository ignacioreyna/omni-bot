import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { open, readdir, readFile, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { listPanePids } from '../tmux/tmux.js';

const execFileAsync = promisify(execFile);

// Claude Code internals (undocumented, may change between versions):
//   ~/.claude/sessions/<pid>.json         registry of running sessions
//   ~/.claude/projects/<dir>/<id>.jsonl   transcripts, title records mixed in
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const REGISTRY_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

const RECENT_LIMIT = 20;
// Transcripts reach tens of MB; titles and the first prompt live near the edges
const EDGE_BYTES = 64 * 1024;
const TITLE_MAX = 80;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LocalClaudeSession {
  sessionId: string;
  title: string;
  cwd: string;
  lastActivity: string;
  pid?: number;
}

interface RegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  kind?: string;
}

interface TranscriptFile {
  sessionId: string;
  file: string;
  modifiedAt: Date;
}

export interface TranscriptSummary {
  title: string | null;
  cwd: string | null;
  // "cli" for interactive sessions; "sdk-cli" for `claude -p` / SDK runs (hooks, title generators)
  entrypoint: string | null;
  // Latest record timestamp: file mtime is useless, Claude Code rewrites open transcripts while idle
  lastActivity: string | null;
}

export function isSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but owned by someone else
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function promptText(content: unknown): string | null {
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter(
              (c): c is { type: 'text'; text: string } => (c as { type?: string })?.type === 'text'
            )
            .map((c) => c.text)
            .join(' ')
        : '';
  // Slash commands, hook output and system reminders arrive as tagged blocks
  const text = raw
    .replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** Title (custom > AI-generated > first prompt) and cwd from transcript lines. */
export function summarizeTranscript(lines: string[]): TranscriptSummary {
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let firstPrompt: string | null = null;
  let cwd: string | null = null;
  let entrypoint: string | null = null;
  let lastActivity: string | null = null;

  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
    if (!entrypoint && typeof record.entrypoint === 'string') entrypoint = record.entrypoint;
    if (
      typeof record.timestamp === 'string' &&
      (!lastActivity || record.timestamp > lastActivity)
    ) {
      lastActivity = record.timestamp;
    }
    if (record.type === 'custom-title' && typeof record.customTitle === 'string')
      customTitle = record.customTitle;
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') aiTitle = record.aiTitle;
    if (!firstPrompt && record.type === 'user' && !record.isMeta) {
      firstPrompt = promptText((record.message as { content?: unknown } | undefined)?.content);
    }
  }

  const title = customTitle || aiTitle || firstPrompt;
  return { title: title ? title.slice(0, TITLE_MAX) : null, cwd, entrypoint, lastActivity };
}

async function readTranscriptEdges(file: string): Promise<string[]> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const headLength = Math.min(size, EDGE_BYTES);
    const head = Buffer.alloc(headLength);
    await handle.read(head, 0, headLength, 0);
    const headLines = head.toString('utf8').split('\n');
    if (size <= EDGE_BYTES) return headLines;

    const tailStart = Math.max(headLength, size - EDGE_BYTES);
    const tail = Buffer.alloc(size - tailStart);
    await handle.read(tail, 0, tail.length, tailStart);
    // Chunk boundaries cut lines in half; JSON.parse drops those fragments
    return [...headLines, ...tail.toString('utf8').split('\n')];
  } finally {
    await handle.close();
  }
}

async function listTranscripts(): Promise<Map<string, TranscriptFile>> {
  const transcripts = new Map<string, TranscriptFile>();
  let projects: string[];
  try {
    projects = await readdir(PROJECTS_DIR);
  } catch {
    return transcripts;
  }

  await Promise.all(
    projects.map(async (project) => {
      const dir = path.join(PROJECTS_DIR, project);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return;
      }
      for (const name of files) {
        const sessionId = name.replace(/\.jsonl$/, '');
        if (name === sessionId || !isSessionId(sessionId)) continue;
        const file = path.join(dir, name);
        try {
          const { mtime } = await stat(file);
          transcripts.set(sessionId, { sessionId, file, modifiedAt: mtime });
        } catch {
          // deleted while scanning
        }
      }
    })
  );
  return transcripts;
}

async function readRegistry(): Promise<RegistryEntry[]> {
  let files: string[];
  try {
    files = (await readdir(REGISTRY_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const entries = await Promise.all(
    files.map(async (f) => {
      try {
        const entry = JSON.parse(
          await readFile(path.join(REGISTRY_DIR, f), 'utf8')
        ) as RegistryEntry;
        return typeof entry.pid === 'number' && isSessionId(entry.sessionId ?? '') ? entry : null;
      } catch {
        return null;
      }
    })
  );
  return entries.filter((e): e is RegistryEntry => e !== null && isAlive(e.pid));
}

async function parentPids(): Promise<Map<number, number>> {
  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=']);
  const parents = new Map<number, number>();
  for (const line of stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid) parents.set(pid, ppid);
  }
  return parents;
}

export function hasAncestor(
  pid: number,
  ancestors: Set<number>,
  parents: Map<number, number>
): boolean {
  let current: number | undefined = pid;
  for (let depth = 0; current && current > 1 && depth < 64; depth++) {
    if (ancestors.has(current)) return true;
    current = parents.get(current);
  }
  return false;
}

async function describe(
  transcript: TranscriptFile | undefined,
  fallbackCwd: string,
  sessionId: string
) {
  const summary = transcript
    ? summarizeTranscript(await readTranscriptEdges(transcript.file))
    : null;
  return {
    title: summary?.title || sessionId.slice(0, 8),
    cwd: fallbackCwd || summary?.cwd || '',
    interactive: (summary?.entrypoint ?? 'cli') === 'cli',
    lastActivity: summary?.lastActivity ?? (transcript?.modifiedAt ?? new Date()).toISOString(),
  };
}

/**
 * Claude Code sessions started outside tmux: still running ones (resumable only by
 * forking or taking over) and recently closed ones.
 */
export async function listLocalSessions(): Promise<{
  running: LocalClaudeSession[];
  recent: LocalClaudeSession[];
}> {
  const [registry, transcripts, panePids, parents] = await Promise.all([
    readRegistry(),
    listTranscripts(),
    listPanePids(),
    parentPids(),
  ]);

  const liveIds = new Set(registry.map((e) => e.sessionId));
  const paneSet = new Set(panePids);
  const outsideTmux = registry.filter(
    (e) =>
      (e.kind ?? 'interactive') === 'interactive' &&
      !hasAncestor(e.pid, paneSet, parents) &&
      // No transcript until the first message: nothing to resume, and taking it over would
      // kill the original for nothing
      transcripts.has(e.sessionId)
  );

  const running = await Promise.all(
    outsideTmux.map(async (e) => {
      const transcript = transcripts.get(e.sessionId);
      const { title, cwd, lastActivity } = await describe(transcript, e.cwd, e.sessionId);
      return { sessionId: e.sessionId, pid: e.pid, lastActivity, title, cwd };
    })
  );

  const candidates = [...transcripts.values()]
    .filter((t) => !liveIds.has(t.sessionId))
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  const recent: LocalClaudeSession[] = [];
  for (const t of candidates) {
    if (recent.length >= RECENT_LIMIT) break;
    const { title, cwd, interactive, lastActivity } = await describe(t, '', t.sessionId);
    // Skip headless runs, and sessions whose worktree was cleaned up (cannot be resumed)
    if (!interactive || !cwd || !existsSync(cwd)) continue;
    recent.push({ sessionId: t.sessionId, lastActivity, title, cwd });
  }

  const byActivity = (a: LocalClaudeSession, b: LocalClaudeSession): number =>
    b.lastActivity.localeCompare(a.lastActivity);
  running.sort(byActivity);
  recent.sort(byActivity);
  return { running, recent };
}

export async function findLocalSession(sessionId: string): Promise<LocalClaudeSession | null> {
  const { running, recent } = await listLocalSessions();
  return [...running, ...recent].find((s) => s.sessionId === sessionId) ?? null;
}

async function isClaudeProcess(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)]);
    return /claude/i.test(stdout);
  } catch {
    return false;
  }
}

/** SIGTERM a local Claude process and wait for it to exit so its session can be resumed. */
export async function stopLocalSession(pid: number, timeoutMs = 10_000): Promise<void> {
  // Registry files can outlive their process; guard against a recycled pid
  if (!(await isClaudeProcess(pid))) throw new Error(`Process ${pid} is not a Claude session`);
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) throw new Error(`Claude (pid ${pid}) did not exit`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
