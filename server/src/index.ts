import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './app.js';

// Works from both src/ (tsx in dev) and dist/ (compiled), since both sit one level below server/.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, '..');

// Load server/.env if it exists (see .env.example).
const envFile = path.join(serverRoot, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT) || 3001;

const { httpServer } = createServer({
  dbFile: process.env.DB_FILE || path.join(serverRoot, 'data', 'chat.db'),
  clientDist: path.join(serverRoot, '..', 'client', 'dist'),
  corsOrigin: process.env.CLIENT_ORIGIN, // only needed if the client is hosted on another domain
});

httpServer.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
