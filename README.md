# Private Chat

End-to-end encrypted private chat built with Bun, Socket.io, React, and Web Crypto.

Messages are never stored on disk. Accounts are the only persistent data (SQLite). Every message is encrypted with ECDH P-256 + AES-GCM-256 before it leaves the browser.

## Architecture

```
Private Chat/
  backend/     Bun + Socket.io server (port 3000)
  frontend/    React + Vite + Tailwind CSS (port 5173)
  install.sh   One-command setup (installs deps + starts both)
```

### Backend (`backend/`)

| Module | Purpose |
|---|---|
| `src/index.ts` | Bun.serve entry point, health check, graceful shutdown |
| `src/server.ts` | Socket.io event handlers (join, register, login, message, e2ee relay, groups, membership, vote-kick, disconnect) |
| `src/types.ts` | Branded types, event maps, payload types |
| `src/config.ts` | Environment-driven configuration |
| `src/account-store.ts` | SQLite persistence via `bun:sqlite`, bcrypt via `Bun.password` |
| `src/user-directory.ts` | Union of registered accounts + guest usernames (offline group members) |
| `src/group-store.ts` | In-memory groups and membership |
| `src/kick-vote-store.ts` | One active vote-kick per group, 60s TTL |
| `src/user-registry.ts` | In-memory active user tracking, 30s disconnect TTL |
| `src/rate-limiter.ts` | Token bucket rate limiting (10 req/s per socket) |
| `src/validators.ts` | Zod validation for all payloads |
| `src/e2ee.ts` | ECDH P-256 + HKDF + AES-GCM-256 crypto primitives |
| `src/e2ee-session.ts` | Per-peer shared key management |
| `src/logger.ts` | Pino structured logger |
| `src/config.ts` | Port, CORS, log level, ping intervals |

### Frontend (`frontend/`)

| Module | Purpose |
|---|---|
| `src/App.tsx` | Root: ChatProvider wrapper, auth gate |
| `src/context/ChatContext.tsx` | React Context + useReducer for all app state |
| `src/lib/socket.ts` | Socket.io-client singleton |
| `src/lib/e2ee.ts` | Web Crypto API primitives (same as backend) |
| `src/lib/e2ee-session.ts` | Client-side key management |
| `src/components/AuthScreen.tsx` | Login / Register / Guest tab container |
| `src/components/ChatLayout.tsx` | Split-pane responsive layout |
| `src/components/Sidebar.tsx` | User list, ephemeral banner, current user |
| `src/components/ChatArea.tsx` | Message list + input + header |
| `src/components/MessageBubble.tsx` | Individual message with E2EE status |
| `src/components/UserItem.tsx` | Selectable user row |

## Quick Start

### Option A: install.sh (recommended)

```bash
chmod +x install.sh
./install.sh
```

This installs all dependencies and starts both servers.

### Option B: run.sh scripts

**Prerequisites:** [Bun](https://bun.sh) v1.1+, [Node.js](https://nodejs.org) v20+

Open two terminals:

```bash
# Terminal 1 - Backend
cd backend
bun install
./run.sh

# Terminal 2 - Frontend
cd frontend
npm install
./run.sh
```

Open http://localhost:5173.

### Option C: Manual setup

```bash
# Backend
cd backend
bun install
bun run src/index.ts

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

## Environment Variables

### Backend

A `.env` file is included in `backend/` with all defaults. Bun loads it automatically on `bun run`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `LOG_LEVEL` | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `PING_INTERVAL` | `25000` | Socket.io ping interval (ms) |
| `PING_TIMEOUT` | `20000` | Socket.io ping timeout (ms) |
| `DB_PATH` | `chat.db` | SQLite database file path |
| `TLS_CERT_FILE` | _(unset)_ | Path to the TLS certificate (PEM). Must be set together with `TLS_KEY_FILE` |
| `TLS_KEY_FILE` | _(unset)_ | Path to the TLS private key (PEM). Must be set together with `TLS_CERT_FILE` |

### Frontend

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | _(unset — same-origin)_ | Backend URL. Set at build time (e.g. `VITE_API_URL=https://chat.example.com npm run build`). If unset, socket.io connects to same-origin (Vite proxy in dev, reverse proxy in prod). |

## How E2EE Works

1. **Key Generation:** Each client generates an ECDH P-256 key pair on connect
2. **Key Exchange:** Public keys are relayed through the server to each peer
3. **Key Derivation:** Each side derives a shared AES-256-GCM key via HKDF
4. **Encryption:** Messages are encrypted client-side before transmission
5. **Decryption:** Messages are decrypted client-side after reception

The server only sees ciphertext. It cannot read message contents.

```
Client A                    Server                    Client B
   |                          |                          |
   |-- e2ee:public_key ------>|                          |
   |                          |--- e2ee:public_key ----->|
   |                          |                          |
   |-- message:send(encrypted) -->|                      |
   |                          |--- private_message ----->|
   |                          |      (ciphertext only)  |
```

## TLS / HTTPS

Certificates are always provisioned externally (certbot, your CA, `openssl`) — the app contains no ACME/Let's Encrypt automation. Pick one of two options:

**Option A — the backend terminates TLS.** Set both variables and Bun serves `https`/`wss` directly on `PORT` (unset both to keep plain `http`, the default):

```bash
TLS_CERT_FILE=/etc/private-chat/fullchain.pem TLS_KEY_FILE=/etc/private-chat/privkey.pem bun run src/index.ts
```

Both variables must be set together; setting only one fails fast with `TLS_CERT_FILE and TLS_KEY_FILE must be set together`.

**Option B — a reverse proxy terminates TLS.** Keep the backend on plain `http` behind nginx (see the production example below, `listen 443 ssl`). Nothing changes in the backend.

Clients need no special handling: `socket.io-client` derives `wss:` from `https:` automatically, and the mobile client accepts `https://` server URLs as-is. Point them at the https origin:

```bash
# Web build
VITE_API_URL=https://chat.example.com npm run build
```

Set `CORS_ORIGINS` to the https origin (e.g. `https://chat.example.com`). `*` still works but is discouraged for production.

Manual smoke test:

```bash
cd backend
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=localhost"
TLS_CERT_FILE=cert.pem TLS_KEY_FILE=key.pem bun run src/index.ts
curl -k https://localhost:3000/health
```

With the variables unset the server must still answer plain `http://localhost:3000/health`.

## Features

- **End-to-end encryption** — ECDH + AES-GCM-256, server never sees plaintext
- **Account system** — Register/login with password (bcrypt), optional PIN
- **Guest mode** — Join without an account (ephemeral identity)
- **Offline group members** — Users can be added to groups while they are offline
- **Vote-kick** — Members can vote to remove a member (creator is immune)
- **SQLite persistence** — Accounts survive server restarts, chat messages do not
- **Zero chat persistence** — No localStorage, cookies, or server-side message storage
- **Rate limiting** — Token bucket per socket (10 req/s)
- **Responsive UI** — Split-pane on desktop, stacked on mobile
- **Dark glassmorphism** — Deep zinc theme with indigo accent

## Data & Privacy

What the server stores:

- **Accounts** — username, bcrypt password hash, optional PIN hash (SQLite).
- **Guest usernames** — a guest name that has joined once is kept in a small directory table so that person can be added to groups later, even while offline. No messages, credentials, or presence history are stored for guests.

What the server never stores: message bodies (E2EE, relay only), session state beyond the in-memory registry.

Known limitations, accepted by design:

- **The server sees metadata.** Usernames, group membership, presence, and e2ee public keys are visible to the server because it is the relay. TLS protects them from network observers only — not from the server operator.
- **No offline message storage.** Messages addressed to an offline user are not queued; the sender gets a delivery failure, exactly as before.
- **Stale guest identity.** If a guest name is later registered as an account, group rows created while they were a guest keep the old guest userId and are not migrated. New lookups resolve to the account.
- **No certificate automation.** TLS certificates must be renewed externally.

## Tech Stack

**Backend:** Bun, Socket.io v4, Zod v4, Pino, bun:sqlite, Bun.password (bcrypt)

**Frontend:** React 19, Vite, TypeScript 6, Tailwind CSS v4, Socket.io-client v4, Biome

## Development

### Backend tests

```bash
cd backend
bun test
```

### Frontend type check

```bash
cd frontend
npm run typecheck
```

### Lint

```bash
# Backend
cd backend && bunx biome check src/

# Frontend
cd frontend && npm run lint
```

## Production Deployment

### 1. Build frontend

```bash
cd frontend
npm run build
# Output: frontend/dist/
```

### 2. Configure reverse proxy (nginx example)

TLS terminates in nginx; the backend stays on plain `http` (TLS option B). Certificates are provisioned externally (e.g. certbot).

```nginx
server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    # Serve frontend static files
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Proxy Socket.io to backend
    location /socket.io {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

If the backend terminates TLS instead (option A), change `proxy_pass` to `https://127.0.0.1:3000`.

### 3. Start backend

```bash
cd backend
PORT=3000 LOG_LEVEL=warn bun run src/index.ts
```

### 4. Use a process manager (optional)

```bash
# systemd example
cat > /etc/systemd/system/private-chat.service << 'EOF'
[Unit]
Description=Private Chat Backend
After=network.target

[Service]
Type=simple
User=chat
WorkingDirectory=/path/to/backend
ExecStart=/usr/bin/bun run src/index.ts
Restart=on-failure
Environment=PORT=3000
Environment=LOG_LEVEL=warn
Environment=DB_PATH=/var/lib/private-chat/accounts.db
# Optional TLS (see the TLS / HTTPS section)
# Environment=TLS_CERT_FILE=/etc/private-chat/fullchain.pem
# Environment=TLS_KEY_FILE=/etc/private-chat/privkey.pem

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now private-chat
```

## Project Constraints

- **No chat persistence** — Messages exist only in memory during the session
- **No localStorage/cookies** — Chat state never touches browser storage
- **Accounts only persistence** — SQLite stores username, password hash, optional PIN hash
- **TypeScript strict** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- **No `any`** — Zero tolerance for `any`, `!`, or `@ts-ignore`
- **Under 250 LOC** — Every production file stays under 250 lines
- **Named exports only** — No `export default` anywhere

## License

Private use.
