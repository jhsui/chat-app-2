import { Router } from 'express';
import { requireAuth } from '../auth.js';

export function chatRoutes(db, presence) {
  const router = Router();
  router.use(requireAuth(db));

  // Find people to message: GET /api/users?q=ali
  router.get('/users', (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 20);
    if (!q) return res.json({ users: [] });
    const users = db.searchUsers(req.user.id, q).map((u) => ({ ...u, online: presence.isOnline(u.id) }));
    res.json({ users });
  });

  // Everyone the current user has exchanged messages with, newest first.
  router.get('/conversations', (req, res) => {
    const conversations = db
      .getConversations(req.user.id)
      .map((c) => ({ ...c, online: presence.isOnline(c.id) }));
    res.json({ conversations });
  });

  // Message history with one user: GET /api/messages/42?before=123&limit=50
  router.get('/messages/:userId', (req, res) => {
    const otherId = Number(req.params.userId);
    const other = Number.isInteger(otherId) && db.findUserById(otherId);
    if (!other) return res.status(404).json({ error: 'User not found' });

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = Number(req.query.before) || undefined;
    const messages = db.getMessages(req.user.id, otherId, { before, limit });

    res.json({
      user: { id: other.id, username: other.username, online: presence.isOnline(other.id) },
      messages,
      hasMore: messages.length === limit,
    });
  });

  return router;
}
