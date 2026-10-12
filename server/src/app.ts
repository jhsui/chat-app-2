import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { requireAuth } from "./auth.js";
import { openDb, type Db, type DbConfig } from "./db.js";
import { createPresence } from "./presence.js";
import { attachSocket, emitNewMessage, type ChatServer } from "./socket.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { MAX_AVATAR_BYTES, profileRoutes } from "./routes/profile.js";
import {
  chatImageStorageFromEnv,
  storageFromEnv,
  type AvatarStorage,
  type ChatImageStorage,
} from "./storage.js";

export interface ServerOptions {
  db: DbConfig;
  /** Where avatars go. Defaults to Supabase from env vars (null if not configured). */
  avatarStorage?: AvatarStorage | null;
  /** Where pictures sent in chats go (a private bucket). Same default. */
  chatImageStorage?: ChatImageStorage | null;
  clientDist?: string;
  corsOrigin?: string;
}

export interface ChatApp {
  app: express.Express;
  httpServer: http.Server;
  io: ChatServer;
  db: Db;
  close(): Promise<void>;
}

/**
 * Connects to the database and builds the whole server without listening, so
 * tests can start it on a random port with a throwaway database.
 */
export async function createServer({
  db: dbConfig,
  avatarStorage = storageFromEnv(),
  chatImageStorage = chatImageStorageFromEnv(),
  clientDist,
  corsOrigin,
}: ServerOptions): Promise<ChatApp> {
  const db = await openDb(dbConfig);
  const presence = createPresence();
  const app = express();
  const httpServer = http.createServer(app);
  const io = attachSocket(httpServer, db, presence, { corsOrigin });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes(db));
  // Everything else under /api needs a signed-in user.
  app.use(
    "/api",
    requireAuth(db),
    chatRoutes(db, presence, chatImageStorage, (message) =>
      emitNewMessage(io, message),
    ),
    profileRoutes(db, presence, avatarStorage, (user) =>
      io.emit("profile:updated", user),
    ),
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // In production, serve the built React app from the same origin.
  if (clientDist && fs.existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    if (err?.type === "entity.too.large") {
      res.status(413).json({
        error: `That's too large (max ${Math.round((err.limit ?? MAX_AVATAR_BYTES) / 1024)} KB)`,
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  };
  app.use(errorHandler);

  return {
    app,
    httpServer,
    io,
    db,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Stops Socket.IO and the HTTP server, then closes the database connection.
        io.close(() => {
          db.close().then(resolve, reject);
        });
      }),
  };
}
