import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import type { ClientToServerEvents, PublicUser, ServerToClientEvents } from '../../shared/types.js';
import { COOKIE_NAME, verifyToken } from './auth.js';
import type { Db } from './db.js';
import type { Presence } from './presence.js';

const MAX_MESSAGE_LENGTH = 2000;
const room = (userId: number) => `user:${userId}`;

/** Data attached to each socket after the handshake is authenticated. */
interface SocketData {
  user: PublicUser;
}

export type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/**
 * Real-time layer. Every connected socket joins a private room named after
 * its user, so sending to `user:42` reaches all of user 42's open tabs.
 */
export function attachSocket(
  httpServer: HttpServer,
  db: Db,
  presence: Presence,
  { corsOrigin }: { corsOrigin?: string } = {},
): ChatServer {
  const io: ChatServer = new Server(httpServer, {
    cors: corsOrigin ? { origin: corsOrigin, credentials: true } : undefined,
  });

  // Authenticate the handshake with the same httpOnly cookie the REST API uses.
  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const userId = verifyToken(cookies[COOKIE_NAME]);
    const user = userId === null ? undefined : db.findUserById(userId);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = { id: user.id, username: user.username };
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(room(me.id));
    if (presence.connect(me.id)) {
      socket.broadcast.emit('presence', { userId: me.id, online: true });
    }

    // Payloads come from the network, so validate them even though they're typed.
    socket.on('message:send', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const to = Number(payload?.to);
      const body = typeof payload?.body === 'string' ? payload.body.trim() : '';

      if (!body) return reply({ error: 'Message is empty' });
      if (body.length > MAX_MESSAGE_LENGTH) return reply({ error: 'Message is too long' });
      if (to === me.id) return reply({ error: "You can't message yourself" });
      if (!Number.isInteger(to) || !db.findUserById(to)) return reply({ error: 'User not found' });

      const message = db.createMessage(me.id, to, body);
      io.to(room(to)).to(room(me.id)).emit('message:new', message);
      reply({ ok: true, message });
    });

    socket.on('typing', (payload) => {
      const to = Number(payload?.to);
      if (!Number.isInteger(to) || to === me.id) return;
      socket.to(room(to)).emit('typing', { from: me.id, typing: Boolean(payload?.typing) });
    });

    socket.on('messages:read', (payload) => {
      const from = Number(payload?.from);
      if (!Number.isInteger(from)) return;
      const { changes, upToId } = db.markRead(me.id, from);
      if (changes > 0 && upToId !== null) {
        io.to(room(from)).to(room(me.id)).emit('messages:read', { readerId: me.id, senderId: from, upToId });
      }
    });

    socket.on('disconnect', () => {
      if (presence.disconnect(me.id)) {
        socket.broadcast.emit('presence', { userId: me.id, online: false });
      }
    });
  });

  return io;
}
