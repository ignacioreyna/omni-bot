import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { appConfig } from '../config.js';

export interface ConductorWorkspace {
  repoName: string;
  worktreeName: string;
  path: string;
  branch: string;
  status: 'clean' | 'dirty';
  lastCommit: { hash: string; message: string; date: string } | null;
  contextFiles: { hasNotes: boolean; hasTodos: boolean; hasPlans: boolean };
}

export interface ConductorRepo {
  repoName: string;
  worktrees: ConductorWorkspace[];
}

const GIT_TIMEOUT_MS = 3000;

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function listDirs(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function isGitWorktree(dirPath: string): boolean {
  const gitPath = path.join(dirPath, '.git');
  try {
    const stat = fs.statSync(gitPath);
    // Worktrees have a .git *file* (not directory) pointing to the main repo
    return stat.isFile();
  } catch {
    return false;
  }
}

function checkContextFiles(dirPath: string): ConductorWorkspace['contextFiles'] {
  const contextDir = path.join(dirPath, '.context');
  return {
    hasNotes: fs.existsSync(path.join(contextDir, 'notes.md')),
    hasTodos: fs.existsSync(path.join(contextDir, 'todos.md')),
    hasPlans: (() => {
      try {
        const plansDir = path.join(contextDir, 'plans');
        return fs.existsSync(plansDir) && fs.readdirSync(plansDir).length > 0;
      } catch {
        return false;
      }
    })(),
  };
}

async function scanWorktree(
  repoName: string,
  worktreeName: string,
  worktreePath: string
): Promise<ConductorWorkspace> {
  const workspace: ConductorWorkspace = {
    repoName,
    worktreeName,
    path: worktreePath,
    branch: 'unknown',
    status: 'clean',
    lastCommit: null,
    contextFiles: checkContextFiles(worktreePath),
  };

  const [branchResult, statusResult, logResult] = await Promise.allSettled([
    execGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath),
    execGit(['status', '--porcelain'], worktreePath),
    execGit(['log', '-1', '--format=%h%n%s%n%aI'], worktreePath),
  ]);

  if (branchResult.status === 'fulfilled') {
    workspace.branch = branchResult.value;
  }

  if (statusResult.status === 'fulfilled') {
    workspace.status = statusResult.value.length === 0 ? 'clean' : 'dirty';
  }

  if (logResult.status === 'fulfilled' && logResult.value) {
    const lines = logResult.value.split('\n');
    if (lines.length >= 3) {
      workspace.lastCommit = {
        hash: lines[0],
        message: lines.slice(1, -1).join(' '), // subject may wrap, date is always last
        date: lines[lines.length - 1],
      };
    }
  }

  return workspace;
}

export async function scanConductorWorkspaces(): Promise<ConductorRepo[]> {
  const workspacesRoot = appConfig.conductorWorkspacesPath;
  if (!workspacesRoot) return [];

  const repoNames = listDirs(workspacesRoot);
  const repos: ConductorRepo[] = [];

  const repoPromises = repoNames.map(async (repoName) => {
    const repoPath = path.join(workspacesRoot, repoName);
    const worktreeNames = listDirs(repoPath);

    const validWorktrees = worktreeNames.filter((wt) =>
      isGitWorktree(path.join(repoPath, wt))
    );

    if (validWorktrees.length === 0) return null;

    const worktrees = await Promise.all(
      validWorktrees.map((wt) => scanWorktree(repoName, wt, path.join(repoPath, wt)))
    );

    return { repoName, worktrees };
  });

  const results = await Promise.all(repoPromises);
  for (const repo of results) {
    if (repo) repos.push(repo);
  }

  return repos.sort((a, b) => a.repoName.localeCompare(b.repoName));
}
