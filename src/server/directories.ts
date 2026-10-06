import { readdir, stat } from 'fs/promises';
import path from 'path';

export interface DirectoryEntry {
  path: string;
  root: string;
  modifiedAt: string;
}

async function childDirectories(root: string): Promise<DirectoryEntry[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    return await Promise.all(
      dirs.map(async (d) => {
        const full = path.join(root, d.name);
        const { mtime } = await stat(full);
        return { path: full, root, modifiedAt: mtime.toISOString() };
      })
    );
  } catch {
    return [];
  }
}

/** Each allowed root plus its immediate subdirectories, most recently modified first. */
export async function listCandidateDirectories(roots: string[]): Promise<DirectoryEntry[]> {
  const children = (await Promise.all(roots.map(childDirectories))).flat();
  children.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const rootEntries = roots.map((root) => ({ path: root, root, modifiedAt: '' }));
  return [...children, ...rootEntries];
}
