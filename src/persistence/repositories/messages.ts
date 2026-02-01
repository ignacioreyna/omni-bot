import { getDatabase } from '../database.js';

export interface Message {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface MessageRow {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  metadata: string | null;
  created_at: string;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

export function createMessage(
  sessionId: string,
  role: Message['role'],
  content: string,
  metadata?: Record<string, unknown>
): Message {
  const db = getDatabase();

  const result = db
    .prepare(
      `INSERT INTO messages (session_id, role, content, metadata)
       VALUES (?, ?, ?, ?)`
    )
    .run(sessionId, role, content, metadata ? JSON.stringify(metadata) : null);

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as MessageRow;
  return rowToMessage(row);
}

export function getMessages(sessionId: string, limit = 100, offset = 0): Message[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE session_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(sessionId, limit, offset) as MessageRow[];
  return rows.map(rowToMessage);
}

export function getMessageCount(sessionId: string): number {
  const db = getDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number };
  return result.count;
}

export function searchMessages(query: string, sessionId?: string): Message[] {
  const db = getDatabase();

  let sql = `
    SELECT m.* FROM messages m
    INNER JOIN messages_fts fts ON m.id = fts.rowid
    WHERE messages_fts MATCH ?
  `;

  const params: (string | number)[] = [query];

  if (sessionId) {
    sql += ' AND m.session_id = ?';
    params.push(sessionId);
  }

  sql += ' ORDER BY m.created_at DESC LIMIT 100';

  const rows = db.prepare(sql).all(...params) as MessageRow[];
  return rows.map(rowToMessage);
}

export function deleteMessagesForSession(sessionId: string): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  return result.changes;
}
