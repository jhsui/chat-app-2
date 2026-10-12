import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  server = createServer({ dbFile: ':memory:' });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});

after(() => server.close());

/** Tiny HTTP client that remembers the auth cookie, like a browser would. */
function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async request(method, path, body) {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { 'Content-Type': 'application/json', cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, body: await res.json() };
    },
  };
}

function socketFor(c) {
  return new Promise((resolve, reject) => {
    const s = connect(baseUrl, { extraHeaders: { cookie: c.cookie }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

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
  assert.deepEqual(r.body.users.map((u) => u.username), ['bob']);
  const self = await alice.request('GET', '/api/users?q=alice');
  assert.equal(self.body.users.length, 0);
});

test('sockets reject unauthenticated connections', async () => {
  await assert.rejects(socketFor(client()), /unauthorized/);
});

test('direct messages are delivered live, stored, and marked read', async () => {
  const bobId = (await bob.request('GET', '/api/auth/me')).body.user.id;
  const aliceId = (await alice.request('GET', '/api/auth/me')).body.user.id;

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
  assert.match((await aSock.emitWithAck('message:send', { to: bobId, body: '   ' })).error, /empty/);
  assert.match((await aSock.emitWithAck('message:send', { to: aliceId, body: 'me' })).error, /yourself/);
  assert.match((await aSock.emitWithAck('message:send', { to: 9999, body: 'x' })).error, /not found/);

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
  assert.deepEqual(history.messages.map((m) => m.body), ['hi bob', 'hey alice']);
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
  const bobId = (await bob.request('GET', '/api/auth/me')).body.user.id;
  const sock = await socketFor(carol);
  for (let i = 1; i <= 5; i++) await sock.emitWithAck('message:send', { to: bobId, body: `m${i}` });
  sock.disconnect();

  const page1 = (await carol.request('GET', `/api/messages/${bobId}?limit=3`)).body;
  assert.deepEqual(page1.messages.map((m) => m.body), ['m3', 'm4', 'm5']);
  assert.equal(page1.hasMore, true);

  const page2 = (await carol.request('GET', `/api/messages/${bobId}?limit=3&before=${page1.messages[0].id}`)).body;
  assert.deepEqual(page2.messages.map((m) => m.body), ['m1', 'm2']);
  assert.equal(page2.hasMore, false);
});
