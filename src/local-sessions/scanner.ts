import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LocalSession {
  sessionId: string;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  projectName?: string;
}

export interface ProjectSessions {
  projectPath: string;
  projectName: string;
  sessions: LocalSession[];
}

interface SessionIndexEntry {
  sessionId: string;
  firstPrompt?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
}

interface SessionIndex {
  originalPath?: string;
  entries?: SessionIndexEntry[];
}

interface ProjectData {
  projectPath: string;
  projectName: string;
  sessions: LocalSession[];
}

/**
 * Iterate over all project directories in ~/.claude/projects,
 * parsing session index files and calling the callback for each valid project.
 */
function forEachProject(callback: (data: ProjectData) => void): void {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(claudeDir)) {
    return;
  }

  let dirs: string[];
  try {
    dirs = fs.readdirSync(claudeDir);
  } catch {
    return;
  }

  for (const dir of dirs) {
    const projectDir = path.join(claudeDir, dir);

    try {
      if (!fs.statSync(projectDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const indexPath = path.join(projectDir, 'sessions-index.json');

    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, 'utf-8');
        const data = JSON.parse(content) as SessionIndex;

        if (!data.entries?.length) continue;

        const projectPath = data.originalPath || decodeProjectDir(dir);
        const projectName = path.basename(projectPath);

        const sessions: LocalSession[] = data.entries.map((entry) => ({
          sessionId: entry.sessionId,
          firstPrompt: entry.firstPrompt?.slice(0, 200) || '',
          messageCount: entry.messageCount || 0,
          created: entry.created || '',
          modified: entry.modified || '',
          gitBranch: entry.gitBranch || '',
          projectPath: entry.projectPath || projectPath,
          projectName,
        }));

        callback({ projectPath, projectName, sessions });
      } catch {
        continue;
      }
    } else {
      // Fallback: scan .jsonl files directly (e.g. Conductor sessions)
      const sessions = scanJsonlFallback(projectDir, dir);
      if (sessions.length === 0) continue;

      const projectPath = decodeProjectDir(dir);
      const projectName = path.basename(projectPath);
      callback({ projectPath, projectName, sessions });
    }
  }
}

function sortByModifiedDesc(sessions: LocalSession[]): void {
  sessions.sort((a, b) => {
    if (!a.modified) return 1;
    if (!b.modified) return -1;
    return new Date(b.modified).getTime() - new Date(a.modified).getTime();
  });
}

/**
 * Scan ~/.claude/projects for local Claude Code sessions.
 * Each project directory contains a sessions-index.json with session metadata.
 */
export function scanLocalSessions(): ProjectSessions[] {
  const results: ProjectSessions[] = [];

  forEachProject(({ projectPath, projectName, sessions }) => {
    sortByModifiedDesc(sessions);
    results.push({ projectPath, projectName, sessions });
  });

  // Sort projects by most recent session modified date
  results.sort((a, b) => {
    const aRecent = a.sessions[0]?.modified || '';
    const bRecent = b.sessions[0]?.modified || '';
    if (!aRecent) return 1;
    if (!bRecent) return -1;
    return new Date(bRecent).getTime() - new Date(aRecent).getTime();
  });

  return results;
}

/**
 * Get the N most recent sessions across all projects, flat (no grouping).
 */
export function scanRecentSessions(limit = 5): LocalSession[] {
  const all: LocalSession[] = [];

  forEachProject(({ sessions }) => {
    all.push(...sessions);
  });

  sortByModifiedDesc(all);
  return all.slice(0, limit);
}

/**
 * Get sessions for a specific directory (or any project under it).
 */
export function scanSessionsByDirectory(dirPath: string): LocalSession[] {
  const normalizedTarget = path.resolve(dirPath);
  const results: LocalSession[] = [];

  forEachProject(({ projectPath, sessions }) => {
    const normalizedProject = path.resolve(projectPath);
    if (
      normalizedProject === normalizedTarget ||
      normalizedProject.startsWith(normalizedTarget + path.sep)
    ) {
      results.push(...sessions);
    }
  });

  sortByModifiedDesc(results);
  return results;
}

export interface LocalMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Read messages from a local Claude Code session's .jsonl transcript file.
 * Extracts user and assistant text messages, skipping tool use/result blocks.
 */
export function readLocalSessionMessages(sessionId: string): LocalMessage[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  let dirs: string[];
  try {
    dirs = fs.readdirSync(claudeDir);
  } catch {
    return [];
  }

  // Find the .jsonl file across all project directories
  for (const dir of dirs) {
    const jsonlPath = path.join(claudeDir, dir, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath)) continue;

    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      return parseJsonlMessages(content);
    } catch {
      return [];
    }
  }

  return [];
}

interface JsonlEntry {
  type?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
}

function parseJsonlMessages(content: string): LocalMessage[] {
  const messages: LocalMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;

    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      continue;
    }

    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    if (!entry.message?.content) continue;

    let text: string;

    if (typeof entry.message.content === 'string') {
      // Conductor sessions store content as a string with system tags
      text = entry.type === 'user'
        ? cleanSystemTags(entry.message.content)
        : entry.message.content;
    } else if (Array.isArray(entry.message.content)) {
      // Regular CLI sessions store content as array of blocks
      const textParts = entry.message.content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text as string);
      text = textParts.join('\n');
    } else {
      continue;
    }

    if (!text) continue;

    const role = entry.message.role === 'assistant' ? 'assistant' : 'user';
    messages.push({
      role,
      content: text,
      timestamp: entry.timestamp || '',
    });
  }

  return messages;
}

/**
 * Fallback scanner for project directories without sessions-index.json.
 * Reads .jsonl transcript files directly to extract session metadata.
 */
function scanJsonlFallback(projectDir: string, dirName: string): LocalSession[] {
  let files: string[];
  try {
    files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const projectPath = decodeProjectDir(dirName);
  const projectName = path.basename(projectPath);
  const sessions: LocalSession[] = [];

  for (const file of files) {
    const jsonlPath = path.join(projectDir, file);
    const session = parseSessionFromJsonl(jsonlPath, projectPath, projectName);
    if (session) sessions.push(session);
  }

  return sessions;
}

/**
 * Extract session metadata from the first few lines of a .jsonl transcript.
 * Reads only the first 32KB to stay fast on large files.
 */
function parseSessionFromJsonl(
  jsonlPath: string,
  projectPath: string,
  projectName: string
): LocalSession | null {
  let fd: number;
  try {
    fd = fs.openSync(jsonlPath, 'r');
  } catch {
    return null;
  }

  try {
    const buf = Buffer.alloc(32 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    const chunk = buf.toString('utf-8', 0, bytesRead);
    const lines = chunk.split('\n');

    let stat: fs.Stats;
    try {
      stat = fs.statSync(jsonlPath);
    } catch {
      return null;
    }

    for (const line of lines) {
      if (!line.trim()) continue;

      let entry: JsonlFallbackEntry;
      try {
        entry = JSON.parse(line) as JsonlFallbackEntry;
      } catch {
        continue;
      }

      if (entry.type !== 'user' || !entry.message) continue;

      const content = entry.message.content;
      let firstPrompt = '';

      if (typeof content === 'string') {
        firstPrompt = cleanSystemTags(content).slice(0, 200);
      } else if (Array.isArray(content)) {
        firstPrompt = content
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text as string)
          .join('\n')
          .slice(0, 200);
      }

      return {
        sessionId: entry.sessionId || path.basename(jsonlPath, '.jsonl'),
        firstPrompt,
        messageCount: 0,
        created: entry.timestamp || stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        gitBranch: entry.gitBranch || '',
        projectPath,
        projectName,
      };
    }

    return null;
  } finally {
    fs.closeSync(fd);
  }
}

interface JsonlFallbackEntry {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

function cleanSystemTags(content: string): string {
  return content
    .replace(/<system_instruction>[\s\S]*?<\/system_instruction>/g, '')
    .replace(/<system-instruction>[\s\S]*?<\/system-instruction>/g, '')
    .trim();
}

/**
 * Decode project directory name back to path.
 * Claude Code encodes paths by replacing / with - and other transformations.
 */
function decodeProjectDir(dirName: string): string {
  // The directory name is typically the path with leading/trailing slashes replaced with dashes
  // e.g., "-Users-name-project" -> "/Users/name/project"
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}
