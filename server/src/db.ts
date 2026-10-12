import fs from "node:fs";
import pg from "pg";
import type { Message, PublicUser } from "../../shared/types.js";

/**
 * Where the data lives:
 * - `databaseUrl`: a real PostgreSQL server (Railway, Docker, Postgres.app, …)
 * - `pgliteDir`: PGlite, real Postgres compiled to WebAssembly and running inside
 *   this Node process, stored in a folder. Pass "memory://" for a throwaway
 *   database (used by the tests). No install needed.
 * Both run the exact same SQL below.
 */
export type DbConfig = { databaseUrl: string } | { pgliteDir: string };

// IDs are INTEGER rather than BIGINT on purpose: node-postgres returns BIGINT
// (and COUNT(*)) as strings to avoid precision loss, INTEGER comes back as a number.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Usernames are unique regardless of case: "Bob" and "bob" are the same person.
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at      TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (sender_id, recipient_id, id);
  CREATE INDEX IF NOT EXISTS messages_unread_idx ON messages (recipient_id, sender_id) WHERE read_at IS NULL;
`;

const MESSAGE_COLUMNS = `
  id, sender_id AS "senderId", recipient_id AS "recipientId", body,
  created_at AS "createdAt", read_at AS "readAt"
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
  close(): Promise<void>;
  /** Returns null if the username is already taken. */
  createUser(username: string, passwordHash: string): Promise<UserRow | null>;
  findUserById(id: number): Promise<UserRow | undefined>;
  findUserByUsername(username: string): Promise<UserWithPassword | undefined>;
  searchUsers(me: number, query: string): Promise<PublicUser[]>;
  /** Every user except `me`, with the time of your latest message together (or null). */
  listPeople(me: number): Promise<(PublicUser & { lastAt: string | null })[]>;
  createMessage(
    senderId: number,
    recipientId: number,
    body: string,
  ): Promise<Message>;
  /** Returns up to `limit` messages older than `before`, oldest first. */
  getMessages(
    a: number,
    b: number,
    options?: { before?: number; limit?: number },
  ): Promise<Message[]>;
  getConversations(me: number): Promise<ConversationRow[]>;
  /** Marks everything `other` sent to `me` as read. */
  markRead(
    me: number,
    other: number,
  ): Promise<{ changes: number; upToId: number | null }>;
}

/** True if `n` can be a row id (a positive Postgres INTEGER). Use it on ids that come from the network. */
export function isValidId(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647;
}

// ---- Connecting -------------------------------------------------------------

/** The small slice of a Postgres client this file needs, so pg and PGlite are interchangeable. */
interface Sql {
  query<T>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  /** Runs one or more statements without parameters (used for the schema). */
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

async function connectPostgres(databaseUrl: string): Promise<Sql> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  await pool.query("SELECT 1"); // fail fast with a clear error if the server is unreachable
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await pool.query(text, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
    async exec(text) {
      await pool.query(text);
    },
    close: () => pool.end(),
  };
}

async function connectPglite(dir: string): Promise<Sql> {
  // Loaded only when needed, so production (DATABASE_URL set) never loads the WebAssembly build.
  const { PGlite } = await import("@electric-sql/pglite");
  if (!dir.startsWith("memory://")) fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await db.query<T>(text, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
    async exec(text) {
      await db.exec(text);
    },
    close: () => db.close(),
  };
}

// ---- Row mapping ------------------------------------------------------------

// Postgres returns TIMESTAMPTZ columns as JS Dates; the API sends ISO strings.
const iso = (value: Date | string) => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null) =>
  value === null ? null : iso(value);

type MessageRow = Omit<Message, "createdAt" | "readAt"> & {
  createdAt: Date;
  readAt: Date | null;
};
const toMessage = (row: MessageRow): Message => ({
  ...row,
  createdAt: iso(row.createdAt),
  readAt: isoOrNull(row.readAt),
});

type UserRowRaw = PublicUser & { createdAt: Date };
const toUser = (row: UserRowRaw): UserRow => ({
  ...row,
  createdAt: iso(row.createdAt),
});

// ---- Queries ----------------------------------------------------------------

/**
 * Connects to the database, creates the tables if they don't exist yet, and
 * returns a small data-access layer.
 */
export async function openDb(config: DbConfig): Promise<Db> {
  const sql =
    "databaseUrl" in config
      ? await connectPostgres(config.databaseUrl)
      : await connectPglite(config.pgliteDir);
  await sql.exec(SCHEMA);

  return {
    close: () => sql.close(),

    async createUser(username, passwordHash) {
      // ON CONFLICT covers the race where two people grab the same name at once.
      const { rows } = await sql.query<UserRowRaw>(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)
         ON CONFLICT ((lower(username))) DO NOTHING
         RETURNING id, username, created_at AS "createdAt"`,
        [username, passwordHash],
      );
      return rows[0] ? toUser(rows[0]) : null;
    },

    async findUserById(id) {
      const { rows } = await sql.query<UserRowRaw>(
        `SELECT id, username, created_at AS "createdAt" FROM users WHERE id = $1`,
        [id],
      );
      return rows[0] && toUser(rows[0]);
    },

    async findUserByUsername(username) {
      const { rows } = await sql.query<UserWithPassword>(
        `SELECT id, username, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower($1)`,
        [username],
      );
      return rows[0];
    },

    async searchUsers(me, query) {
      // Escape LIKE wildcards so searching for "_" or "%" matches them literally.
      const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
      const { rows } = await sql.query<PublicUser>(
        `SELECT id, username FROM users
         WHERE id <> $1 AND username ILIKE $2
         ORDER BY lower(username) LIMIT 20`,
        [me, `%${escaped}%`],
      );
      return rows;
    },

    async listPeople(me) {
      // Capped so a big user base can't produce a huge response; fine for a small app.
      const { rows } = await sql.query<PublicUser & { lastAt: Date | null }>(
        `SELECT u.id, u.username,
                (SELECT MAX(m.created_at) FROM messages m
                  WHERE (m.sender_id = u.id AND m.recipient_id = $1)
                     OR (m.sender_id = $1 AND m.recipient_id = u.id)) AS "lastAt"
         FROM users u
         WHERE u.id <> $1
         ORDER BY lower(u.username)
         LIMIT 500`,
        [me],
      );
      return rows.map((r) => ({ ...r, lastAt: isoOrNull(r.lastAt) }));
    },

    async createMessage(senderId, recipientId, body) {
      const { rows } = await sql.query<MessageRow>(
        `INSERT INTO messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)
         RETURNING ${MESSAGE_COLUMNS}`,
        [senderId, recipientId, body],
      );
      return toMessage(rows[0]!);
    },

    async getMessages(a, b, { before, limit = 50 } = {}) {
      const { rows } = await sql.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages
         WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
           AND ($3::int IS NULL OR id < $3)
         ORDER BY id DESC LIMIT $4`,
        [a, b, before ?? null, limit],
      );
      return rows.map(toMessage).reverse();
    },

    async getConversations(me) {
      const { rows } = await sql.query<
        Omit<ConversationRow, "lastAt"> & { lastAt: Date }
      >(
        `WITH convo AS (
           SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_id,
                  MAX(id) AS last_id
           FROM messages
           WHERE sender_id = $1 OR recipient_id = $1
           GROUP BY 1
         )
         SELECT u.id, u.username,
                m.body AS "lastBody", m.sender_id AS "lastSenderId", m.created_at AS "lastAt",
                (SELECT COUNT(*)::int FROM messages
                  WHERE sender_id = u.id AND recipient_id = $1 AND read_at IS NULL) AS unread
         FROM convo c
         JOIN users u ON u.id = c.other_id
         JOIN messages m ON m.id = c.last_id
         ORDER BY m.id DESC`,
        [me],
      );
      return rows.map((r) => ({ ...r, lastAt: iso(r.lastAt) }));
    },

    async markRead(me, other) {
      const { rowCount } = await sql.query(
        `UPDATE messages SET read_at = now()
         WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
        [other, me],
      );
      const { rows } = await sql.query<{ id: number | null }>(
        `SELECT MAX(id) AS id FROM messages WHERE sender_id = $1 AND recipient_id = $2`,
        [other, me],
      );
      return { changes: rowCount, upToId: rows[0]?.id ?? null };
    },
  };
}
