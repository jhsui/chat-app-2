import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { openDb } from './db.js';
import { createPresence } from './presence.js';
import { attachSocket } from './socket.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';

/**
 * Builds the whole server without listening, so tests can start it on a
 * random port with an in-memory database.
 */
export function createServer({ dbFile, clientDist, corsOrigin } = {}) {
  const db = openDb(dbFile);
  const presence = createPresence();
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes(db));
  app.use('/api', chatRoutes(db, presence));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // In production, serve the built React app from the same origin.
  if (clientDist && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  const httpServer = http.createServer(app);
  const io = attachSocket(httpServer, db, presence, { corsOrigin });

  return {
    app,
    httpServer,
    io,
    db,
    close: () =>
      new Promise((resolve) => {
        io.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
