import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';

export interface Session {
  id: string;
  name: string;
  workingDirectory: string;
  status: 'active' | 'paused' | 'terminated';
  claudeSessionId: string | null;
  createdAt: string;
  lastMessageAt: string | null;
}

interface SessionRow {
  id: string;
  name: string;
  working_directory: string;
  status: 'active' | 'paused' | 'terminated';
  claude_session_id: string | null;
  created_at: string;
  last_message_at: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    workingDirectory: row.working_directory,
    status: row.status,
    claudeSessionId: row.claude_session_id,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
  };
}

export function createSession(name: string, workingDirectory: string): Session {
  const db = getDatabase();
  const id = uuidv4();

  db.prepare(
    `INSERT INTO sessions (id, name, working_directory, status)
     VALUES (?, ?, ?, 'active')`
  ).run(id, name, workingDirectory);

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
  return rowToSession(row);
}

export function getSession(id: string): Session | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function getAllSessions(): Session[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM sessions ORDER BY last_message_at DESC NULLS LAST, created_at DESC').all() as SessionRow[];
  return rows.map(rowToSession);
}

export function getActiveSessions(): Session[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY last_message_at DESC NULLS LAST")
    .all() as SessionRow[];
  return rows.map(rowToSession);
}

export function updateSession(
  id: string,
  updates: Partial<Pick<Session, 'name' | 'status' | 'claudeSessionId' | 'lastMessageAt'>>
): Session | null {
  const db = getDatabase();
  const setClauses: string[] = [];
  const values: (string | null)[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    values.push(updates.status);
  }
  if (updates.claudeSessionId !== undefined) {
    setClauses.push('claude_session_id = ?');
    values.push(updates.claudeSessionId);
  }
  if (updates.lastMessageAt !== undefined) {
    setClauses.push('last_message_at = ?');
    values.push(updates.lastMessageAt);
  }

  if (setClauses.length === 0) {
    return getSession(id);
  }

  values.push(id);
  db.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  return getSession(id);
}

export function deleteSession(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function touchSession(id: string): void {
  const db = getDatabase();
  db.prepare("UPDATE sessions SET last_message_at = datetime('now') WHERE id = ?").run(id);
}
