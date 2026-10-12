import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../../shared/types.js";
import pg from "pg";
import { createServer, type ChatApp } from "../src/app.js";
import type { DbConfig } from "../src/db.js";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ChatApp;
let baseUrl: string;

/**
 * By default the tests use a throwaway in-memory PGlite database. To run them
 * against a real Postgres server instead, set TEST_DATABASE_URL — note that
 * the users and messages tables in that database are wiped first.
 */
async function testDbConfig(): Promise<DbConfig> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return { pgliteDir: "memory://" };
  const pool = new pg.Pool({ connectionString: url });
  await pool.query("DROP TABLE IF EXISTS messages, users");
  await pool.end();
  return { databaseUrl: url };
}

/** In-memory stand-in for Supabase Storage, so tests need no account or network. */
const fakeStorage = {
  files: new Map<string, { data: Buffer; contentType: string }>(),
  async save(key: string, data: Buffer, contentType: string) {
    this.files.set(key, { data, contentType });
    return { url: `https://storage.test/avatars/${key}` };
  },
  async remove(key: string) {
    this.files.delete(key);
  },
};

before(async () => {
  server = await createServer({
    db: await testDbConfig(),
    avatarStorage: fakeStorage,
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

after(() => server.close());

/** Tiny HTTP client that remembers the auth cookie, like a browser would. */
function client() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    // Responses are loosely typed here on purpose: the tests check the shapes.
    async request(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; body: any }> {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { "Content-Type": "application/json", cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0] ?? "";
      return { status: res.status, body: await res.json() };
    },
    /** Sends raw bytes, like the browser does for avatar uploads. */
    async upload(
      path: string,
      data: Buffer,
      contentType: string,
    ): Promise<{ status: number; body: any }> {
      const res = await fetch(baseUrl + path, {
        method: "PUT",
        headers: { "Content-Type": contentType, cookie },
        body: new Uint8Array(data),
      });
      return { status: res.status, body: await res.json() };
    },
  };
}
type Client = ReturnType<typeof client>;

function socketFor(c: Client): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s: ClientSocket = connect(baseUrl, {
      extraHeaders: { cookie: c.cookie },
      transports: ["websocket"],
    });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

function once<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    // socket.io-client's typed `once` overloads are awkward with generic event names.
    (socket.once as (e: string, cb: (arg: unknown) => void) => void)(
      event,
      (arg) => resolve(arg as Parameters<ServerToClientEvents[E]>[0]),
    );
  });
}

const alice = client();
const bob = client();

test("register validates input and rejects duplicates", async () => {
  let r = await alice.request("POST", "/api/auth/register", {
    username: "a",
    password: "secret1",
  });
  assert.equal(r.status, 400);

  r = await alice.request("POST", "/api/auth/register", {
    username: "alice",
    password: "secret1",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.username, "alice");

  r = await client().request("POST", "/api/auth/register", {
    username: "ALICE",
    password: "secret1",
  });
  assert.equal(r.status, 409, "usernames are case-insensitive");

  r = await bob.request("POST", "/api/auth/register", {
    username: "bob",
    password: "hunter22",
  });
  assert.equal(r.status, 201);
});

test("login, me and logout", async () => {
  const c = client();
  assert.equal((await c.request("GET", "/api/auth/me")).status, 401);
  assert.equal(
    (
      await c.request("POST", "/api/auth/login", {
        username: "bob",
        password: "wrong!!",
      })
    ).status,
    401,
  );

  const r = await c.request("POST", "/api/auth/login", {
    username: "Bob",
    password: "hunter22",
  });
  assert.equal(r.status, 200);
  assert.equal(
    (await c.request("GET", "/api/auth/me")).body.user.username,
    "bob",
  );

  await c.request("POST", "/api/auth/logout");
  assert.equal((await c.request("GET", "/api/auth/me")).status, 401);
});

test("user search excludes yourself", async () => {
  const r = await alice.request("GET", "/api/users?q=b");
  assert.deepEqual(
    r.body.users.map((u: { username: string }) => u.username),
    ["bob"],
  );
  const self = await alice.request("GET", "/api/users?q=alice");
  assert.equal(self.body.users.length, 0);
});

test("sockets reject unauthenticated connections", async () => {
  await assert.rejects(socketFor(client()), /unauthorized/);
});

test("direct messages are delivered live, stored, and marked read", async () => {
  const bobId: number = (await bob.request("GET", "/api/auth/me")).body.user.id;
  const aliceId: number = (await alice.request("GET", "/api/auth/me")).body.user
    .id;

  const aSock = await socketFor(alice);
  const bSock = await socketFor(bob);

  // Typing indicator reaches the recipient.
  const typing = once(bSock, "typing");
  aSock.emit("typing", { to: bobId, typing: true });
  assert.deepEqual(await typing, { from: aliceId, typing: true });

  // Sending a message reaches both sides.
  const bobGets = once(bSock, "message:new");
  const ack = await aSock.emitWithAck("message:send", {
    to: bobId,
    body: "  hi bob  ",
  });
  assert.ok(ack.ok);
  const received = await bobGets;
  assert.equal(received.body, "hi bob");
  assert.equal(received.senderId, aliceId);

  // Bad messages are rejected.
  const errorOf = async (payload: { to: number; body: string }) => {
    const res = await aSock.emitWithAck("message:send", payload);
    return "error" in res ? res.error : "";
  };
  assert.match(await errorOf({ to: bobId, body: "   " }), /empty/);
  assert.match(await errorOf({ to: aliceId, body: "me" }), /yourself/);
  assert.match(await errorOf({ to: 9999, body: "x" }), /not found/);

  // Bob sees an unread conversation with Alice.
  let convos = (await bob.request("GET", "/api/conversations")).body
    .conversations;
  assert.equal(convos[0].username, "alice");
  assert.equal(convos[0].unread, 1);
  assert.equal(convos[0].online, true);

  // Bob reads it; Alice is told.
  const aliceTold = once(aSock, "messages:read");
  bSock.emit("messages:read", { from: aliceId });
  assert.deepEqual(await aliceTold, {
    readerId: bobId,
    senderId: aliceId,
    upToId: received.id,
  });

  convos = (await bob.request("GET", "/api/conversations")).body.conversations;
  assert.equal(convos[0].unread, 0);

  // History is returned oldest-first.
  await bSock.emitWithAck("message:send", { to: aliceId, body: "hey alice" });
  const history = (await alice.request("GET", `/api/messages/${bobId}`)).body;
  assert.deepEqual(
    history.messages.map((m: { body: string }) => m.body),
    ["hi bob", "hey alice"],
  );
  assert.ok(history.messages[0].readAt);

  // Presence: Alice sees Bob go offline.
  const offline = once(aSock, "presence");
  bSock.disconnect();
  assert.deepEqual(await offline, { userId: bobId, online: false });

  aSock.disconnect();
});

test("message history paginates", async () => {
  const carol = client();
  await carol.request("POST", "/api/auth/register", {
    username: "carol",
    password: "secret1",
  });
  const bobId: number = (await bob.request("GET", "/api/auth/me")).body.user.id;
  const sock = await socketFor(carol);
  for (let i = 1; i <= 5; i++)
    await sock.emitWithAck("message:send", { to: bobId, body: `m${i}` });
  sock.disconnect();

  const bodies = (msgs: { body: string }[]) => msgs.map((m) => m.body);

  const page1 = (await carol.request("GET", `/api/messages/${bobId}?limit=3`))
    .body;
  assert.deepEqual(bodies(page1.messages), ["m3", "m4", "m5"]);
  assert.equal(page1.hasMore, true);

  const page2 = (
    await carol.request(
      "GET",
      `/api/messages/${bobId}?limit=3&before=${page1.messages[0].id}`,
    )
  ).body;
  assert.deepEqual(bodies(page2.messages), ["m1", "m2"]);
  assert.equal(page2.hasMore, false);
});

test("people lists every other user with online status and last chat time", async () => {
  const bSock = await socketFor(bob); // bring Bob online

  const { people } = (await alice.request("GET", "/api/people")).body as {
    people: { username: string; online: boolean; lastAt: string | null }[];
  };
  assert.deepEqual(
    people.map((p) => p.username),
    ["bob", "carol"],
    "everyone except me, A–Z",
  );

  const [bobEntry, carolEntry] = people;
  assert.equal(bobEntry?.online, true);
  assert.ok(bobEntry?.lastAt, "alice and bob have chatted");
  assert.equal(carolEntry?.online, false);
  assert.equal(carolEntry?.lastAt, null, "alice and carol never chatted");

  bSock.disconnect();
});

test("database edge cases: duplicate names and out-of-range ids", async () => {
  // The unique index is case-insensitive, even when the route's pre-check is skipped.
  const dana = await server.db.createUser("Dana", "hash");
  assert.equal(dana?.username, "Dana");
  assert.equal(await server.db.createUser("dana", "hash"), null);

  // Ids bigger than a Postgres INTEGER are treated as "not found", not a crash.
  const huge = 99_999_999_999;
  const r = await alice.request("GET", `/api/messages/${huge}`);
  assert.equal(r.status, 404);
  const bobId: number = (await bob.request("GET", "/api/auth/me")).body.user.id;
  const page = await alice.request(
    "GET",
    `/api/messages/${bobId}?before=${huge}`,
  );
  assert.equal(page.status, 200);

  const sock = await socketFor(alice);
  const ack = await sock.emitWithAck("message:send", { to: huge, body: "hi" });
  assert.ok("error" in ack && /not found/.test(ack.error));
  sock.disconnect();
});

test("a burst of messages arrives in the order it was sent", async () => {
  const bobId: number = (await bob.request("GET", "/api/auth/me")).body.user.id;
  const aliceId: number = (await alice.request("GET", "/api/auth/me")).body.user
    .id;
  const aSock = await socketFor(alice);
  const bSock = await socketFor(bob);

  const received: string[] = [];
  const allIn = new Promise<void>((resolve) => {
    bSock.on("message:new", (m) => {
      if (m.senderId === aliceId) received.push(m.body);
      if (received.length === 10) resolve();
    });
  });
  const sent = Array.from({ length: 10 }, (_, i) => `burst ${i}`);
  // Fire all ten without waiting for each acknowledgement.
  await Promise.all(
    sent.map((body) => aSock.emitWithAck("message:send", { to: bobId, body })),
  );
  await allIn;
  assert.deepEqual(received, sent);

  const history = (await alice.request("GET", `/api/messages/${bobId}`)).body;
  assert.deepEqual(
    history.messages.slice(-10).map((m: { body: string }) => m.body),
    sent,
  );
  aSock.disconnect();
  bSock.disconnect();
});

// Smallest valid-looking images: the server only checks the file signature.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBP"),
  Buffer.alloc(64),
]);

test("profiles: display name, bio and validation", async () => {
  const bobId: number = (await bob.request("GET", "/api/auth/me")).body.user.id;

  let r = await bob.request("PATCH", "/api/me", {
    displayName: "  Bob   the  Builder ",
    bio: "  Can we fix it?\nYes we can!  ",
  });
  assert.equal(r.status, 200);
  assert.equal(
    r.body.profile.displayName,
    "Bob the Builder",
    "trimmed, single spaces",
  );
  assert.equal(
    r.body.profile.bio,
    "Can we fix it?\nYes we can!",
    "trimmed, keeps line breaks",
  );

  r = await bob.request("PATCH", "/api/me", {
    displayName: "x".repeat(41),
    bio: "",
  });
  assert.equal(r.status, 400);
  r = await bob.request("PATCH", "/api/me", {
    displayName: "Bob",
    bio: "x".repeat(161),
  });
  assert.equal(r.status, 400);

  // Other people can view it, and it shows up in lists and search.
  r = await alice.request("GET", `/api/users/${bobId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.username, "bob");
  assert.equal(r.body.profile.displayName, "Bob the Builder");
  assert.ok(r.body.profile.createdAt);
  const people = (await alice.request("GET", "/api/people")).body.people;
  assert.equal(
    people.find((p: { id: number }) => p.id === bobId).displayName,
    "Bob the Builder",
  );
  const found = (await alice.request("GET", "/api/users?q=builder")).body.users;
  assert.deepEqual(
    found.map((u: { username: string }) => u.username),
    ["bob"],
    "search matches display names",
  );

  // Clearing the name falls back to null (the app then shows the username).
  r = await bob.request("PATCH", "/api/me", { displayName: "   ", bio: null });
  assert.equal(r.body.profile.displayName, null);
  assert.equal(r.body.profile.bio, null);

  assert.equal(
    (await alice.request("GET", "/api/users/99999999999")).status,
    404,
  );
  assert.equal(
    (await client().request("GET", `/api/users/${bobId}`)).status,
    401,
  );
});

test("avatars: upload, replace, remove, and live updates", async () => {
  const watcher = await socketFor(bob); // someone watching for profile changes
  const aliceId: number = (await alice.request("GET", "/api/auth/me")).body.user
    .id;

  const announced = once(watcher, "profile:updated");
  let r = await alice.upload("/api/me/avatar", PNG, "image/png");
  assert.equal(r.status, 200);
  const firstUrl: string = r.body.profile.avatarUrl;
  assert.match(
    firstUrl,
    new RegExp(`^https://storage.test/avatars/${aliceId}/.+\\.png$`),
  );
  assert.equal(fakeStorage.files.size, 1);
  const update = await announced;
  assert.equal(update.id, aliceId);
  assert.equal(update.avatarUrl, firstUrl);

  // The avatar comes back from /me and in other people's lists.
  assert.equal(
    (await alice.request("GET", "/api/auth/me")).body.user.avatarUrl,
    firstUrl,
  );

  // Replacing it deletes the old file and uses a new URL.
  r = await alice.upload("/api/me/avatar", WEBP, "image/webp");
  assert.equal(r.status, 200);
  assert.notEqual(r.body.profile.avatarUrl, firstUrl);
  assert.match(r.body.profile.avatarUrl, /\.webp$/);
  assert.equal(fakeStorage.files.size, 1, "old file removed");

  // The file signature decides, not the Content-Type the client claims.
  r = await alice.upload(
    "/api/me/avatar",
    Buffer.from("<svg onload=alert(1)>"),
    "image/png",
  );
  assert.equal(r.status, 400);
  r = await alice.upload(
    "/api/me/avatar",
    Buffer.concat([PNG, Buffer.alloc(600 * 1024)]),
    "image/png",
  );
  assert.equal(r.status, 413);

  r = await alice.request("DELETE", "/api/me/avatar");
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.avatarUrl, null);
  assert.equal(fakeStorage.files.size, 0);

  watcher.disconnect();
});

test("avatar uploads explain when storage isn't configured", async () => {
  const bare = await createServer({
    db: { pgliteDir: "memory://" },
    avatarStorage: null,
  });
  await new Promise<void>((resolve) => bare.httpServer.listen(0, resolve));
  const url = `http://localhost:${(bare.httpServer.address() as AddressInfo).port}`;
  try {
    const reg = await fetch(`${url}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "solo", password: "secret1" }),
    });
    const cookie = reg.headers.get("set-cookie")?.split(";")[0] ?? "";
    const res = await fetch(`${url}/api/me/avatar`, {
      method: "PUT",
      headers: { "Content-Type": "image/png", cookie },
      body: new Uint8Array(PNG),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /Supabase/);
  } finally {
    await bare.close();
  }
});
