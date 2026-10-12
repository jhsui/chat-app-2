import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { openDb, type Db } from "./db.js";
import { createPresence } from "./presence.js";
import { attachSocket, type ChatServer } from "./socket.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";

export interface ServerOptions {
  dbFile: string;
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
 * Builds the whole server without listening, so tests can start it on a
 * random port with an in-memory database.
 */
export function createServer({
  dbFile,
  clientDist,
  corsOrigin,
}: ServerOptions): ChatApp {
  const db = openDb(dbFile);
  const presence = createPresence();
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes(db));
  app.use("/api", chatRoutes(db, presence));
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
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  };
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  const io = attachSocket(httpServer, db, presence, { corsOrigin });

  return {
    app,
    httpServer,
    io,
    db,
    close: () =>
      new Promise<void>((resolve) => {
        io.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
