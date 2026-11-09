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
| `src/media-store.ts` | In-memory attachment blobs, 24 h TTL, quotas, periodic sweep |
| `src/media-auth.ts` | Media bearer tokens (one active token per user, 24 h TTL) |
| `src/media-http.ts` | `/media/:id` PUT/GET/OPTIONS handler with CORS and rate limiting |
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

## Media sharing

Photos and videos travel as **client-side encrypted attachments**. The sender generates a random 32-byte file key and a 12-byte IV per file, strips EXIF metadata from images, encrypts the file with AES-256-GCM, and uploads the ciphertext with `PUT /media/:id`. The chat message that references the file is an ordinary E2EE message whose decrypted plaintext carries a descriptor (`fileId`, key, IV, SHA-256 of the ciphertext, mime, size, dimensions, original name). The file key never leaves the E2EE message body — the server stores opaque bytes it cannot read. The receiver verifies SHA-256 against the descriptor before decrypting, so a swapped blob is rejected.

### Token issuance

Every `user:join`, `user:register`, and `user:login` ends with a `media:token` socket event carrying the Bearer token for HTTP media calls: 32 random bytes as 64 lowercase hex characters, valid 24 h from issue. One active token per username — re-authentication replaces the previous token, which stops working immediately. Tokens live in process memory only.

### HTTP endpoints

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| `PUT` | `/media/:id` | `Authorization: Bearer <mediaToken>` | `201 {"ok":true}` (a repeat PUT with the same id replaces the entry) | `400 {"error":"invalid_id"}`, `401 {"error":"unauthorized"}`, `404 {"error":"not_found"}`, `405 {"error":"method_not_allowed"}`, `413 {"error":"too_large"}`, `429 {"error":"rate_limited"}`, `429 {"error":"quota_exceeded"}` |
| `GET` | `/media/:id` | `Authorization: Bearer <mediaToken>` | `200`, body = ciphertext as `application/octet-stream` with `Cache-Control: no-store` | `400`, `401`, `404 {"error":"not_found"}` (missing or expired) |
| `OPTIONS` | `/media/*` | CORS preflight | `204` + CORS headers | — |

Uploads are rate-limited to 10 PUT/s per token. The server stores the exact ciphertext bytes — no parsing, no transformation.

### Quotas, TTL, crash-wipe

- **In memory only** — blobs are never written to disk or into SQLite. A restart or crash wipes every attachment; clients then render `Attachment expired`.
- **Quotas** — 16 MiB per file (the wire limit is 16 MiB + the 16-byte GCM tag), 512 MB and 1000 files total.
- **TTL** — 24 hours from upload; expired blobs are swept every 30 seconds. There is no delete-on-fetch, so several recipients can each download the same file.

### Capability URL

`GET /media/:id` requires a valid token, but any token holder with the `fileId` may fetch the blob. The server cannot know the recipients — the descriptor lives inside E2EE ciphertext — so the `fileId` is the capability: a client-chosen random UUID v4 (122 bits) is unguessable, the same capability-URL model WhatsApp and Matrix use for CDN blobs. Tokens keep the endpoint from being anonymously reachable.

### Accepted gaps

- Video containers are not scrubbed — only images carry EXIF, so only images are stripped.
- A token survives an explicit logout for up to 24 h; it lives only in process memory and is replaced on the next login.
- Old clients that receive a media message render the raw envelope JSON as text — degraded, never crashed.

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
- **Media sharing** — attach encrypted photos/videos; in-memory blobs with a 24 h TTL
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
- **Attachment ciphertext** — uploaded photos/videos held in process memory only (16 MiB per file, 512 MB / 1000 files total, 24 h TTL). Never written to disk; wiped on restart.
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

    # Proxy media uploads/downloads to backend
    location /media/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # nginx defaults to 1 MB, which would 413 every attachment upload
        client_max_body_size 17m;
    }
}
```

Both media directives matter: without `location /media/` the uploads never reach the backend, and without `client_max_body_size 17m;` (16 MiB file + 16-byte GCM tag + headroom) nginx's 1 MB default rejects every upload with a 413.

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
