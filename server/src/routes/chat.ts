import { Router, type Response } from 'express';
import type {
  ConversationsResponse,
  ErrorResponse,
  MessagesResponse,
  PeopleResponse,
  UsersResponse,
} from '../../../shared/types.js';
import { currentUser, requireAuth } from '../auth.js';
import type { Db } from '../db.js';
import type { Presence } from '../presence.js';

export function chatRoutes(db: Db, presence: Presence): Router {
  const router = Router();
  router.use(requireAuth(db));

  // Find people to message: GET /api/users?q=ali
  router.get('/users', (req, res: Response<UsersResponse>) => {
    const q = String(req.query.q ?? '').trim().slice(0, 20);
    if (!q) {
      res.json({ users: [] });
      return;
    }
    const users = db
      .searchUsers(currentUser(req).id, q)
      .map((u) => ({ ...u, online: presence.isOnline(u.id) }));
    res.json({ users });
  });

  // Every other user, for the "People" tab. The client sorts (online first),
  // since online status changes live.
  router.get('/people', (req, res: Response<PeopleResponse>) => {
    const people = db
      .listPeople(currentUser(req).id)
      .map((p) => ({ ...p, online: presence.isOnline(p.id) }));
    res.json({ people });
  });

  // Everyone the current user has exchanged messages with, newest first.
  router.get('/conversations', (req, res: Response<ConversationsResponse>) => {
    const conversations = db
      .getConversations(currentUser(req).id)
      .map((c) => ({ ...c, online: presence.isOnline(c.id) }));
    res.json({ conversations });
  });

  // Message history with one user: GET /api/messages/42?before=123&limit=50
  router.get('/messages/:userId', (req, res: Response<MessagesResponse | ErrorResponse>) => {
    const otherId = Number(req.params.userId);
    const other = Number.isInteger(otherId) ? db.findUserById(otherId) : undefined;
    if (!other) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = Number(req.query.before) || undefined;
    const messages = db.getMessages(currentUser(req).id, otherId, { before, limit });

    res.json({
      user: { id: other.id, username: other.username, online: presence.isOnline(other.id) },
      messages,
      hasMore: messages.length === limit,
    });
  });

  return router;
}
