import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/types.js';
import { createServer, type ChatApp } from '../src/app.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ChatApp;
let baseUrl: string;

before(async () => {
  server = createServer({ dbFile: ':memory:' });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

after(() => server.close());

/** Tiny HTTP client that remembers the auth cookie, like a browser would. */
function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    // Responses are loosely typed here on purpose: the tests check the shapes.
    async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { 'Content-Type': 'application/json', cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0] ?? '';
      return { status: res.status, body: await res.json() };
    },
  };
}
type Client = ReturnType<typeof client>;

function socketFor(c: Client): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s: ClientSocket = connect(baseUrl, { extraHeaders: { cookie: c.cookie }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function once<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    // socket.io-client's typed `once` overloads are awkward with generic event names.
    (socket.once as (e: string, cb: (arg: unknown) => void) => void)(event, (arg) =>
      resolve(arg as Parameters<ServerToClientEvents[E]>[0]),
    );
  });
}

const alice = client();
const bob = client();

test('register validates input and rejects duplicates', async () => {
  let r = await alice.request('POST', '/api/auth/register', { username: 'a', password: 'secret1' });
  assert.equal(r.status, 400);

  r = await alice.request('POST', '/api/auth/register', { username: 'alice', password: 'secret1' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.username, 'alice');

  r = await client().request('POST', '/api/auth/register', { username: 'ALICE', password: 'secret1' });
  assert.equal(r.status, 409, 'usernames are case-insensitive');

  r = await bob.request('POST', '/api/auth/register', { username: 'bob', password: 'hunter22' });
  assert.equal(r.status, 201);
});

test('login, me and logout', async () => {
  const c = client();
  assert.equal((await c.request('GET', '/api/auth/me')).status, 401);
  assert.equal((await c.request('POST', '/api/auth/login', { username: 'bob', password: 'wrong!!' })).status, 401);

  const r = await c.request('POST', '/api/auth/login', { username: 'Bob', password: 'hunter22' });
  assert.equal(r.status, 200);
  assert.equal((await c.request('GET', '/api/auth/me')).body.user.username, 'bob');

  await c.request('POST', '/api/auth/logout');
  assert.equal((await c.request('GET', '/api/auth/me')).status, 401);
});

test('user search excludes yourself', async () => {
  const r = await alice.request('GET', '/api/users?q=b');
  assert.deepEqual(
    r.body.users.map((u: { username: string }) => u.username),
    ['bob'],
  );
  const self = await alice.request('GET', '/api/users?q=alice');
  assert.equal(self.body.users.length, 0);
});

test('sockets reject unauthenticated connections', async () => {
  await assert.rejects(socketFor(client()), /unauthorized/);
});

test('direct messages are delivered live, stored, and marked read', async () => {
  const bobId: number = (await bob.request('GET', '/api/auth/me')).body.user.id;
  const aliceId: number = (await alice.request('GET', '/api/auth/me')).body.user.id;

  const aSock = await socketFor(alice);
  const bSock = await socketFor(bob);

  // Typing indicator reaches the recipient.
  const typing = once(bSock, 'typing');
  aSock.emit('typing', { to: bobId, typing: true });
  assert.deepEqual(await typing, { from: aliceId, typing: true });

  // Sending a message reaches both sides.
  const bobGets = once(bSock, 'message:new');
  const ack = await aSock.emitWithAck('message:send', { to: bobId, body: '  hi bob  ' });
  assert.ok(ack.ok);
  const received = await bobGets;
  assert.equal(received.body, 'hi bob');
  assert.equal(received.senderId, aliceId);

  // Bad messages are rejected.
  const errorOf = async (payload: { to: number; body: string }) => {
    const res = await aSock.emitWithAck('message:send', payload);
    return 'error' in res ? res.error : '';
  };
  assert.match(await errorOf({ to: bobId, body: '   ' }), /empty/);
  assert.match(await errorOf({ to: aliceId, body: 'me' }), /yourself/);
  assert.match(await errorOf({ to: 9999, body: 'x' }), /not found/);

  // Bob sees an unread conversation with Alice.
  let convos = (await bob.request('GET', '/api/conversations')).body.conversations;
  assert.equal(convos[0].username, 'alice');
  assert.equal(convos[0].unread, 1);
  assert.equal(convos[0].online, true);

  // Bob reads it; Alice is told.
  const aliceTold = once(aSock, 'messages:read');
  bSock.emit('messages:read', { from: aliceId });
  assert.deepEqual(await aliceTold, { readerId: bobId, senderId: aliceId, upToId: received.id });

  convos = (await bob.request('GET', '/api/conversations')).body.conversations;
  assert.equal(convos[0].unread, 0);

  // History is returned oldest-first.
  await bSock.emitWithAck('message:send', { to: aliceId, body: 'hey alice' });
  const history = (await alice.request('GET', `/api/messages/${bobId}`)).body;
  assert.deepEqual(
    history.messages.map((m: { body: string }) => m.body),
    ['hi bob', 'hey alice'],
  );
  assert.ok(history.messages[0].readAt);

  // Presence: Alice sees Bob go offline.
  const offline = once(aSock, 'presence');
  bSock.disconnect();
  assert.deepEqual(await offline, { userId: bobId, online: false });

  aSock.disconnect();
});

test('message history paginates', async () => {
  const carol = client();
  await carol.request('POST', '/api/auth/register', { username: 'carol', password: 'secret1' });
  const bobId: number = (await bob.request('GET', '/api/auth/me')).body.user.id;
  const sock = await socketFor(carol);
  for (let i = 1; i <= 5; i++) await sock.emitWithAck('message:send', { to: bobId, body: `m${i}` });
  sock.disconnect();

  const bodies = (msgs: { body: string }[]) => msgs.map((m) => m.body);

  const page1 = (await carol.request('GET', `/api/messages/${bobId}?limit=3`)).body;
  assert.deepEqual(bodies(page1.messages), ['m3', 'm4', 'm5']);
  assert.equal(page1.hasMore, true);

  const page2 = (await carol.request('GET', `/api/messages/${bobId}?limit=3&before=${page1.messages[0].id}`)).body;
  assert.deepEqual(bodies(page2.messages), ['m1', 'm2']);
  assert.equal(page2.hasMore, false);
});

test('people lists every other user with online status and last chat time', async () => {
  const bSock = await socketFor(bob); // bring Bob online

  const { people } = (await alice.request('GET', '/api/people')).body as {
    people: { username: string; online: boolean; lastAt: string | null }[];
  };
  assert.deepEqual(
    people.map((p) => p.username),
    ['bob', 'carol'],
    'everyone except me, A–Z',
  );

  const [bobEntry, carolEntry] = people;
  assert.equal(bobEntry?.online, true);
  assert.ok(bobEntry?.lastAt, 'alice and bob have chatted');
  assert.equal(carolEntry?.online, false);
  assert.equal(carolEntry?.lastAt, null, 'alice and carol never chatted');

  bSock.disconnect();
});
