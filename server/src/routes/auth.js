import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { clearAuthCookie, requireAuth, setAuthCookie } from '../auth.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validate({ username, password } = {}) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3–20 characters: letters, numbers or underscores';
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    return 'Password must be 6–72 characters';
  }
  return null;
}

export function authRoutes(db) {
  const router = Router();

  router.post('/register', async (req, res) => {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });

    const { username, password } = req.body;
    if (db.findUserByUsername(username)) {
      return res.status(409).json({ error: 'That username is taken' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = db.createUser(username, hash);
    setAuthCookie(res, user);
    res.status(201).json({ user: { id: user.id, username: user.username } });
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    const record = typeof username === 'string' ? db.findUserByUsername(username) : null;
    const ok = record && typeof password === 'string' && (await bcrypt.compare(password, record.passwordHash));
    if (!ok) return res.status(401).json({ error: 'Wrong username or password' });

    setAuthCookie(res, record);
    res.json({ user: { id: record.id, username: record.username } });
  });

  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth(db), (req, res) => {
    res.json({ user: { id: req.user.id, username: req.user.username } });
  });

  return router;
}
