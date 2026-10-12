# Chat App

A real-time chat web app with user accounts and private 1:1 direct messages.

**Stack:** TypeScript everywhere · React 19 + Vite · Tailwind CSS v4 · Node.js + Express 5 · Socket.IO · PostgreSQL (node-postgres, PGlite for local dev) · bcrypt + JWT (httpOnly cookie)

## Features

- Sign up / sign in with username and password (passwords hashed with bcrypt)
- **Chats | People** tabs in the sidebar: People lists every user, online first, then by most recent chat
- Search for people by username and start a conversation
- Messages arrive instantly over WebSockets and are saved to PostgreSQL
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

## Database (PostgreSQL)

The server talks to PostgreSQL and picks where it lives at startup:

| `DATABASE_URL`                      | Database used                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| not set (default)                   | **PGlite**, real Postgres compiled to WebAssembly, running inside Node and stored in `server/data/pglite`. Nothing to install. |
| `postgres://user:pass@host:5432/db` | That PostgreSQL server (Railway, Docker, Postgres.app, …)                                                                      |

Both run exactly the same SQL (`server/src/db.ts`). Tables are created automatically on startup if they don't exist.

- To use a real Postgres locally, put `DATABASE_URL=...` in `server/.env`.
- To start over with an empty local database, stop the app and delete `server/data/pglite`.
- To browse the data, point any Postgres client (pgAdmin, TablePlus, `psql`) at your `DATABASE_URL`. PGlite's folder can only be opened by the app itself.
- Tests use a throwaway in-memory PGlite by default. `TEST_DATABASE_URL=postgres://... npm test` runs them against a real server instead (**it wipes the `users` and `messages` tables in that database**).

## Scripts (run from the project root)

| Command             | What it does                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`       | Server (runs the `.ts` files directly with tsx, restarts on change) + Vite dev server        |
| `npm run typecheck` | Type-checks the server, tests and client with `tsc`                                          |
| `npm test`          | Server tests: auth, search, live messaging, read receipts, paging                            |
| `npm run build`     | Type-checks and builds the client into `client/dist`, compiles the server into `server/dist` |
| `npm start`         | Runs the compiled server (`server/dist`); serves `client/dist` too                           |

To run it like production on one port: `npm run build && JWT_SECRET=something-long npm start`, then open http://localhost:3001.

## Styling (Tailwind CSS v4)

- Styles are Tailwind utility classes written directly in the JSX. Tailwind runs as a Vite plugin (`@tailwindcss/vite`), so there's no separate config file or PostCSS setup.
- **Theme tokens** live in `client/src/styles.css`: colors are CSS variables on `:root`, swapped for dark mode by `@media (prefers-color-scheme: dark)`, and exposed to Tailwind through `@theme`. That gives custom utilities like `bg-panel`, `text-muted`, `border-line`, `bg-accent`, `bg-bubble`, so components don't need `dark:` variants for colors. To change the accent color, edit `--accent` in one place.
- `md` is set to 720px: below it (`max-md:`), the app shows one pane at a time.
- **Shared classes** used in several components (buttons, inputs, headers) are strings in `client/src/ui.ts`; `cx()` joins class names conditionally.
- Tip: the official "Tailwind CSS IntelliSense" VS Code extension gives autocomplete and hover previews for class names.

## TypeScript setup

- **Shared types** live in `shared/types.d.ts`: the data shapes (`Message`, `Conversation`, …), every REST response, and the Socket.IO events. Both sides `import type` from it, so if you change an event's payload, `npm run typecheck` shows every place on the server _and_ client that needs updating.
- **Typed sockets:** the server is a `Server<ClientToServerEvents, ServerToClientEvents>` and the client a `Socket<ServerToClientEvents, ClientToServerEvents>`, so `socket.emit('message:send', …)` and every `socket.on(...)` handler are checked.
- **Server:** in development `tsx` runs the `.ts` files directly (no build step). For production, `tsc` compiles `server/src` to `server/dist`. `tsconfig.json` covers src + tests for type-checking; `tsconfig.build.json` is the compile config.
- **Client:** Vite compiles the `.tsx` files; `tsc --noEmit` only type-checks (run as part of `npm run build`).
- Both configs use `strict` mode plus `noUncheckedIndexedAccess`, so array lookups like `messages[0]` are typed as possibly `undefined`.

## How it works

```
Browser (React)                     Server (Express + Socket.IO)            PostgreSQL
───────────────                     ────────────────────────────            ──────────
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
├── package.json             root: workspaces + scripts
├── shared/
│   └── types.d.ts           types shared by server and client (data, API, socket events)
├── server/
│   ├── tsconfig.json        type-check config (src + test)
│   ├── tsconfig.build.json  compile config (src → dist)
│   ├── src/
│   │   ├── index.ts         starts the server (loads .env)
│   │   ├── app.ts           builds Express + Socket.IO (used by tests too)
│   │   ├── db.ts            Postgres schema, typed queries, pg / PGlite connection
│   │   ├── auth.ts          JWT cookie helpers + requireAuth middleware
│   │   ├── socket.ts        real-time events
│   │   ├── presence.ts      online tracking
│   │   └── routes/          auth.ts (register/login/logout/me), chat.ts (users, conversations, messages)
│   ├── test/chat.test.ts    node:test suite (run with tsx)
│   └── data/pglite/         local PGlite database (created on first run, git-ignored)
└── client/
    ├── tsconfig.json
    ├── vite.config.ts       proxies /api and /socket.io to :3001 in dev
    └── src/
        ├── App.tsx          session check → AuthPage or ChatPage
        ├── api.ts           typed fetch wrapper
        ├── components/      AuthPage, ChatPage (socket + state), Sidebar, ChatWindow, Avatar
        ├── ui.ts           shared Tailwind class strings + cx() helper
        └── styles.css      Tailwind entry: theme tokens (light/dark), keyframes
```

## Socket events

| Client → server | Payload              | Server → client | Payload                          |
| --------------- | -------------------- | --------------- | -------------------------------- |
| `message:send`  | `{ to, body }` + ack | `message:new`   | `Message`                        |
| `typing`        | `{ to, typing }`     | `typing`        | `{ from, typing }`               |
| `messages:read` | `{ from }`           | `messages:read` | `{ readerId, senderId, upToId }` |
|                 |                      | `presence`      | `{ userId, online }`             |

## Ideas for next steps

- Group chats (a `conversations` + `participants` table instead of sender/recipient pairs)
- Image / file attachments
- Rate limiting on login and message sending (e.g. `express-rate-limit`)
- Edit / delete messages, emoji reactions
- Deploy (Railway, Render or Fly.io) — add a Postgres database, and set `DATABASE_URL`, `JWT_SECRET` and `NODE_ENV=production`
