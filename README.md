# Chat App

A real-time chat web app with user accounts and private 1:1 direct messages.

**Stack:** React 19 + Vite · Node.js + Express 5 · Socket.IO · SQLite (better-sqlite3) · bcrypt + JWT (httpOnly cookie)

## Features

- Sign up / sign in with username and password (passwords hashed with bcrypt)
- Search for people by username and start a conversation
- Messages arrive instantly over WebSockets and are saved to SQLite
- Conversation list sorted by latest message, with unread badges
- Online / offline status, typing indicator, and "Sent / Seen" read receipts
- Message history with "load older" pagination
- Works across multiple tabs, reconnects automatically, light/dark mode, mobile layout

## Getting started

You need **Node.js 22.12 or newer** (`node -v` to check).

```bash
npm install      # installs the server and client together (npm workspaces)
npm run dev      # starts the API on :3001 and the React app on :5173
```

Open http://localhost:5173. To try chatting with yourself, open a second browser
(or a private window), create another account, search for the first one, and say hi.

Optional: copy `server/.env.example` to `server/.env` to set your own `JWT_SECRET`, port, etc.

## Scripts (run from the project root)

| Command         | What it does                                                    |
| --------------- | --------------------------------------------------------------- |
| `npm run dev`   | Server (auto-restarts on change) + Vite dev server together     |
| `npm test`      | Server tests: auth, search, live messaging, read receipts, paging |
| `npm run build` | Builds the React app into `client/dist`                         |
| `npm start`     | Runs the server; if `client/dist` exists it serves the app too  |

To run it like production on one port: `npm run build && JWT_SECRET=something-long npm start`, then open http://localhost:3001.

## How it works

```
Browser (React)                     Server (Express + Socket.IO)            SQLite
───────────────                     ────────────────────────────            ──────
login / register  ── REST /api ──▶  bcrypt check, sets httpOnly JWT cookie ─▶ users
load chats/history ── REST /api ──▶  /conversations, /messages/:userId  ───▶ messages
send message      ── socket ─────▶  validate, save, emit to both users ───▶ messages
                  ◀── socket ─────  message:new · typing · presence · messages:read
```

- **Auth:** the same cookie authenticates both REST calls and the WebSocket handshake, so the token is never exposed to JavaScript.
- **Delivery:** each connected socket joins a room named `user:<id>`. Sending to that room reaches every open tab of that user.
- **Presence:** the server counts open sockets per user, so you only go offline when your last tab closes.

## Project structure

```
chat-app/
├── package.json            root: workspaces + "dev" script
├── server/
│   ├── src/
│   │   ├── index.js        starts the server (loads .env)
│   │   ├── app.js          builds Express + Socket.IO (used by tests too)
│   │   ├── db.js           SQLite schema and queries
│   │   ├── auth.js         JWT cookie helpers + requireAuth middleware
│   │   ├── socket.js       real-time events
│   │   ├── presence.js     online tracking
│   │   └── routes/         auth.js (register/login/logout/me), chat.js (users, conversations, messages)
│   ├── test/chat.test.js   node:test suite
│   └── data/               SQLite database (created on first run, git-ignored)
└── client/
    ├── vite.config.js      proxies /api and /socket.io to :3001 in dev
    └── src/
        ├── App.jsx         session check → AuthPage or ChatPage
        ├── api.js          fetch wrapper
        ├── components/     AuthPage, ChatPage (socket + state), Sidebar, ChatWindow, Avatar
        └── styles.css
```

## Socket events

| Client → server  | Payload          | Server → client  | Payload                              |
| ---------------- | ---------------- | ---------------- | ------------------------------------ |
| `message:send`   | `{ to, body }` + ack | `message:new`  | message row                          |
| `typing`         | `{ to, typing }` | `typing`         | `{ from, typing }`                   |
| `messages:read`  | `{ from }`       | `messages:read`  | `{ readerId, senderId, upToId }`     |
|                  |                  | `presence`       | `{ userId, online }`                 |

## Ideas for next steps

- Group chats (a `conversations` + `participants` table instead of sender/recipient pairs)
- Image / file attachments
- Rate limiting on login and message sending (e.g. `express-rate-limit`)
- Edit / delete messages, emoji reactions
- Deploy (Railway, Render or Fly.io) — set `JWT_SECRET` and `NODE_ENV=production`, and keep the SQLite file on a persistent volume
