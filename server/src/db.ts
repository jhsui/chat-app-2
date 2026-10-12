import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Message, PublicUser } from "../../shared/types.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    read_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (sender_id, recipient_id, id);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id, read_at);
`;

const MESSAGE_COLUMNS = `
  id, sender_id AS senderId, recipient_id AS recipientId, body,
  created_at AS createdAt, read_at AS readAt
`;

export interface UserRow extends PublicUser {
  createdAt: string;
}

export interface UserWithPassword extends PublicUser {
  passwordHash: string;
}

/** A conversation as stored, before presence info is added. */
export interface ConversationRow extends PublicUser {
  lastBody: string;
  lastSenderId: number;
  lastAt: string;
  unread: number;
}

export interface Db {
  close(): void;
  createUser(username: string, passwordHash: string): UserRow;
  findUserById(id: number): UserRow | undefined;
  findUserByUsername(username: string): UserWithPassword | undefined;
  searchUsers(me: number, query: string): PublicUser[];
  /** Every user except `me`, with the time of your latest message together (or null). */
  listPeople(me: number): (PublicUser & { lastAt: string | null })[];
  createMessage(senderId: number, recipientId: number, body: string): Message;
  /** Returns up to `limit` messages older than `before`, oldest first. */
  getMessages(
    a: number,
    b: number,
    options?: { before?: number; limit?: number },
  ): Message[];
  getConversations(me: number): ConversationRow[];
  /** Marks everything `other` sent to `me` as read. */
  markRead(
    me: number,
    other: number,
  ): { changes: number; upToId: number | null };
}

/**
 * Opens (and if needed creates) the SQLite database and returns a small
 * data-access layer. Pass ':memory:' for a throwaway database in tests.
 */
export function openDb(file: string): Db {
  if (file !== ":memory:")
    fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // The generics are <BindParameters, Row>: they type what goes in and what comes out.
  const stmts = {
    createUser: db.prepare<[string, string]>(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
    ),
    userById: db.prepare<[number | bigint], UserRow>(
      "SELECT id, username, created_at AS createdAt FROM users WHERE id = ?",
    ),
    userByName: db.prepare<[string], UserWithPassword>(
      "SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?",
    ),
    searchUsers: db.prepare<{ me: number; pattern: string }, PublicUser>(`
      SELECT id, username FROM users
      WHERE id != @me AND username LIKE @pattern ESCAPE '\\'
      ORDER BY username COLLATE NOCASE LIMIT 20
    `),
    listPeople: db.prepare<
      { me: number; limit: number },
      PublicUser & { lastAt: string | null }
    >(`
      SELECT u.id, u.username,
             (SELECT MAX(m.created_at) FROM messages m
               WHERE (m.sender_id = u.id AND m.recipient_id = @me)
                  OR (m.sender_id = @me AND m.recipient_id = u.id)) AS lastAt
      FROM users u
      WHERE u.id != @me
      ORDER BY u.username COLLATE NOCASE
      LIMIT @limit
    `),
    insertMessage: db.prepare<[number, number, string]>(
      "INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)",
    ),
    messageById: db.prepare<[number | bigint], Message>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`,
    ),
    messagesBetween: db.prepare<
      { a: number; b: number; before: number; limit: number },
      Message
    >(`
      SELECT ${MESSAGE_COLUMNS} FROM messages
      WHERE ((sender_id = @a AND recipient_id = @b) OR (sender_id = @b AND recipient_id = @a))
        AND id < @before
      ORDER BY id DESC LIMIT @limit
    `),
    conversations: db.prepare<{ me: number }, ConversationRow>(`
      WITH convo AS (
        SELECT CASE WHEN sender_id = @me THEN recipient_id ELSE sender_id END AS other_id,
               MAX(id) AS last_id
        FROM messages
        WHERE sender_id = @me OR recipient_id = @me
        GROUP BY other_id
      )
      SELECT u.id, u.username,
             m.body AS lastBody, m.sender_id AS lastSenderId, m.created_at AS lastAt,
             (SELECT COUNT(*) FROM messages
               WHERE sender_id = u.id AND recipient_id = @me AND read_at IS NULL) AS unread
      FROM convo c
      JOIN users u ON u.id = c.other_id
      JOIN messages m ON m.id = c.last_id
      ORDER BY m.id DESC
    `),
    markRead: db.prepare<{ me: number; other: number }>(`
      UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE sender_id = @other AND recipient_id = @me AND read_at IS NULL
    `),
    lastIdFrom: db.prepare<
      { me: number; other: number },
      { id: number | null }
    >(`
      SELECT MAX(id) AS id FROM messages WHERE sender_id = @other AND recipient_id = @me
    `),
  };

  return {
    close: () => db.close(),

    createUser(username, passwordHash) {
      const { lastInsertRowid } = stmts.createUser.run(username, passwordHash);
      return stmts.userById.get(lastInsertRowid)!;
    },
    findUserById: (id) => stmts.userById.get(id),
    findUserByUsername: (username) => stmts.userByName.get(username),

    searchUsers(me, query) {
      const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
      return stmts.searchUsers.all({ me, pattern: `%${escaped}%` });
    },

    // Capped so a big user base can't produce a huge response; fine for a small app.
    listPeople: (me) => stmts.listPeople.all({ me, limit: 500 }),

    createMessage(senderId, recipientId, body) {
      const { lastInsertRowid } = stmts.insertMessage.run(
        senderId,
        recipientId,
        body,
      );
      return stmts.messageById.get(lastInsertRowid)!;
    },

    getMessages(a, b, { before = Number.MAX_SAFE_INTEGER, limit = 50 } = {}) {
      return stmts.messagesBetween.all({ a, b, before, limit }).reverse();
    },

    getConversations: (me) => stmts.conversations.all({ me }),

    markRead(me, other) {
      const { changes } = stmts.markRead.run({ me, other });
      const row = stmts.lastIdFrom.get({ me, other });
      return { changes, upToId: row?.id ?? null };
    },
  };
}
