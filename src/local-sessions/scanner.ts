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

/**
 * Scan ~/.claude/projects for local Claude Code sessions.
 * Each project directory contains a sessions-index.json with session metadata.
 */
export function scanLocalSessions(): ProjectSessions[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(claudeDir)) {
    return [];
  }

  const results: ProjectSessions[] = [];

  let dirs: string[];
  try {
    dirs = fs.readdirSync(claudeDir);
  } catch {
    return [];
  }

  for (const dir of dirs) {
    const projectDir = path.join(claudeDir, dir);

    // Skip if not a directory
    try {
      if (!fs.statSync(projectDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const indexPath = path.join(projectDir, 'sessions-index.json');
    if (!fs.existsSync(indexPath)) continue;

    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const data = JSON.parse(content) as SessionIndex;

      if (!data.entries?.length) continue;

      // Derive project name from directory (encoded path) or original path
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
      }));

      // Sort by modified date, most recent first
      sessions.sort((a, b) => {
        if (!a.modified) return 1;
        if (!b.modified) return -1;
        return new Date(b.modified).getTime() - new Date(a.modified).getTime();
      });

      results.push({
        projectPath,
        projectName,
        sessions,
      });
    } catch {
      // Skip malformed index files
      continue;
    }
  }

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
 * Decode project directory name back to path.
 * Claude Code encodes paths by replacing / with - and other transformations.
 */
function decodeProjectDir(dirName: string): string {
  // The directory name is typically the path with leading/trailing slashes replaced with dashes
  // e.g., "-Users-name-project" -> "/Users/name/project"
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}
