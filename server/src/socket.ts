import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { parse as parseCookie } from "cookie";
import type {
  ClientToServerEvents,
  PublicUser,
  ServerToClientEvents,
} from "../../shared/types.js";
import { COOKIE_NAME, verifyToken } from "./auth.js";
import { isValidId, toPublicUser, type Db } from "./db.js";
import type { Presence } from "./presence.js";

const MAX_MESSAGE_LENGTH = 2000;
const room = (userId: number) => `user:${userId}`;

/** Data attached to each socket after the handshake is authenticated. */
interface SocketData {
  user: PublicUser;
}

export type ChatServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

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
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? "");
      const userId = verifyToken(cookies[COOKIE_NAME]);
      const user = userId === null ? undefined : await db.findUserById(userId);
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = toPublicUser(user);
      next();
    } catch (err) {
      console.error(err);
      next(new Error("server error"));
    }
  });

  io.on("connection", (socket) => {
    const me = socket.data.user;
    socket.join(room(me.id));
    if (presence.connect(me.id)) {
      socket.broadcast.emit("presence", { userId: me.id, online: true });
    }

    // Database calls are async, so a fast typer's messages could finish out of
    // order. Chaining them per socket keeps each sender's messages in order.
    let sendQueue = Promise.resolve();

    // Payloads come from the network, so validate them even though they're typed.
    socket.on("message:send", (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      sendQueue = sendQueue.then(async () => {
        const to = Number(payload?.to);
        const body =
          typeof payload?.body === "string" ? payload.body.trim() : "";

        if (!body) return reply({ error: "Message is empty" });
        if (body.length > MAX_MESSAGE_LENGTH)
          return reply({ error: "Message is too long" });
        if (to === me.id) return reply({ error: "You can't message yourself" });
        if (!isValidId(to) || !(await db.findUserById(to)))
          return reply({ error: "User not found" });

        try {
          const message = await db.createMessage(me.id, to, body);
          io.to(room(to)).to(room(me.id)).emit("message:new", message);
          reply({ ok: true, message });
        } catch (err) {
          console.error(err);
          reply({ error: "Couldn't send the message. Try again." });
        }
      });
    });

    socket.on("typing", (payload) => {
      const to = Number(payload?.to);
      if (!isValidId(to) || to === me.id) return;
      socket
        .to(room(to))
        .emit("typing", { from: me.id, typing: Boolean(payload?.typing) });
    });

    socket.on("messages:read", async (payload) => {
      const from = Number(payload?.from);
      if (!isValidId(from)) return;
      try {
        const { changes, upToId } = await db.markRead(me.id, from);
        if (changes > 0 && upToId !== null) {
          io.to(room(from))
            .to(room(me.id))
            .emit("messages:read", { readerId: me.id, senderId: from, upToId });
        }
      } catch (err) {
        console.error(err);
      }
    });

    socket.on("disconnect", () => {
      if (presence.disconnect(me.id)) {
        socket.broadcast.emit("presence", { userId: me.id, online: false });
      }
    });
  });

  return io;
}
