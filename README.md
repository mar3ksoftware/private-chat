# Private Chat

> **Polski:** [README.pl.md](README.pl.md) — polskie tlumaczenie tego dokumentu

End-to-end encrypted chat with direct messages, groups, and encrypted photo/video sharing. Built with Bun, Socket.io, React, Web Crypto, and Flutter.

Messages are never stored on disk. Accounts are the only persistent data (SQLite). Every message is encrypted on the sender's device with ECDH P-256 → HKDF-SHA256 → AES-256-GCM and decrypted only on the receiver's device — the server relays ciphertext, presence, and group membership.

The project has three components: a Bun backend (port 3000), a React web app, and a Flutter app for Linux desktop and Android.

## Features

- **End-to-end encryption** — ECDH P-256 → HKDF-SHA256 → AES-256-GCM; the server never sees plaintext
- **Direct and group messages** — offline group members keep their membership and pick the group up on rejoin
- **Group administration** — admins add and remove members; the group creator cannot be removed or kicked
- **Vote-to-kick** — members vote to remove someone; a simple majority (`floor(members / 2) + 1`) within 60 s passes the vote
- **Guest and account auth** — join as a guest, or register/log in with a password and an optional 4–6 digit PIN
- **Encrypted media sharing** — photos and videos encrypted on the device; the server holds opaque blobs in memory with a 24 h TTL
- **Optional TLS/HTTPS** — the backend can terminate TLS itself, or run plain behind a reverse proxy
- **Configurable server address** — the Flutter app can point at any LAN host or domain from the auth screen
- **Zero chat persistence** — no localStorage, cookies, or server-side message storage
- **Rate limiting** — token bucket, 10 requests/s per socket
- **Responsive UI** — split-pane on desktop, stacked on mobile; dark glass theme

## Setup

### Prerequisites

- [Bun](https://bun.sh) v1.1+ — backend
- [Node.js](https://nodejs.org) v20+ — web frontend
- [Flutter](https://docs.flutter.dev/get-started/install) (stable channel) — mobile/desktop app

### One-command setup (backend + web)

```bash
chmod +x install.sh
./install.sh
```

Installs dependencies and starts the backend at http://localhost:3000 and the dev frontend at http://localhost:5173. Ctrl+C stops both. The Flutter app is set up separately (see below).

### Backend

```bash
cd backend
bun install
bun run src/index.ts
```

The server listens on `PORT` (default `3000`) and answers `GET /health`. `bun run dev` watches files and restarts on change; `./run.sh` is a thin wrapper around `bun run src/index.ts`.

A `.env` file ships in `backend/` with the defaults below; Bun loads it automatically on `bun run`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `CORS_ORIGINS` | `http://localhost:5173` (as set in `backend/.env`; without a `.env` the code falls back to `*`) | Comma-separated origins allowed by Socket.io and `/media` CORS |
| `LOG_LEVEL` | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `DB_PATH` | `chat.db` | SQLite database file path |
| `PING_INTERVAL` | `25000` | Socket.io ping interval (ms) |
| `PING_TIMEOUT` | `20000` | Socket.io ping timeout (ms) |
| `TLS_CERT_FILE` | _(unset)_ | Path to the TLS certificate (PEM). Must be set together with `TLS_KEY_FILE` |
| `TLS_KEY_FILE` | _(unset)_ | Path to the TLS private key (PEM). Must be set together with `TLS_CERT_FILE` |

### Web frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. In dev, Vite proxies `/socket.io` and `/media` to `http://localhost:3000`, so no extra configuration is needed.

Production build:

```bash
cd frontend
npm run build        # type check + bundle → frontend/dist/
```

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | _(unset — same origin)_ | Backend URL, baked in at build time (e.g. `VITE_API_URL=https://chat.example.com npm run build`). If unset, socket.io connects same-origin (Vite proxy in dev, reverse proxy in prod). |

### Flutter app (Linux desktop + Android)

```bash
cd mobile
flutter pub get

flutter run -d linux            # desktop dev build
flutter build apk --release     # Android APK → build/app/outputs/flutter-apk/app-release.apk
flutter build linux --release   # Linux bundle → build/linux/
```

**Server address.** By default the app talks to `http://localhost:3000`. On the auth screen, expand the **Server** row, enter the backend address, and press Save — for example `http://192.168.1.5:3000` on a LAN or `https://chat.example.com` behind TLS. The address is stored on the device and can only be edited while logged out.

**Android cleartext HTTP.** The Android manifest sets `android:usesCleartextTraffic="true"`, so plain `http://` servers on a LAN work out of the box. Over the public internet, use HTTPS.

### Running on the LAN

1. Put the server and the clients on the same network.
2. Allow TCP 3000 through the server firewall (e.g. `sudo ufw allow 3000/tcp`).
3. The backend listens on all interfaces. With the server at `192.168.1.5`, check `http://192.168.1.5:3000/health`.
4. Flutter: set the Server row on the auth screen to `http://192.168.1.5:3000`.
5. Web dev: Vite already binds `0.0.0.0:5173` — open `http://192.168.1.5:5173` from another machine and add that origin to `CORS_ORIGINS` on the backend.

### TLS / HTTPS with a domain

Certificates are always provisioned externally (certbot, your CA, `openssl`) — the app contains no ACME/Let's Encrypt automation. With a domain, pick one of two options:

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

### Production deployment

#### 1. Build the web frontend

```bash
cd frontend
npm run build
# Output: frontend/dist/
```

#### 2. Configure the reverse proxy (nginx example)

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

#### 3. Start the backend

```bash
cd backend
PORT=3000 LOG_LEVEL=warn bun run src/index.ts
```

#### 4. Use a process manager (optional)

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
# Optional TLS (see TLS / HTTPS with a domain)
# Environment=TLS_CERT_FILE=/etc/private-chat/fullchain.pem
# Environment=TLS_KEY_FILE=/etc/private-chat/privkey.pem

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now private-chat
```

## Architecture

```
Private Chat/
  backend/     Bun + Socket.io server (port 3000)
  frontend/    React + Vite + Tailwind CSS (dev port 5173)
  mobile/      Flutter app (Linux desktop + Android)
  install.sh   One-command setup (installs deps + starts backend and web)
```

- **Backend** — Bun HTTP server serving `/health`, `/media/*`, and the Socket.io engine on `/socket.io`. It validates every payload with Zod, relays events, stores accounts and the guest directory in SQLite, and keeps groups, kick votes, presence, and media blobs in memory.
- **Web frontend** — React SPA. All crypto runs in the browser through the Web Crypto API; attachments move over HTTP `PUT`/`GET /media/:id`.
- **Flutter app** — the same event contract and crypto as the web client, built on `socket_io_client` and `dart:io`.

### Backend modules (`backend/`)

| Module | Purpose |
|---|---|
| `src/index.ts` | Bun.serve entry point, health check, graceful shutdown |
| `src/server.ts` | Socket.io event handlers (join, register, login, message, e2ee relay, groups, membership, vote-kick, disconnect) |
| `src/types.ts` | Branded types, event maps, payload types |
| `src/config.ts` | Environment-driven configuration (port, CORS, log level, ping, TLS, DB path) |
| `src/account-store.ts` | SQLite persistence via `bun:sqlite`, bcrypt via `Bun.password` |
| `src/user-directory.ts` | Union of registered accounts + guest usernames (offline group members) |
| `src/group-store.ts` | In-memory groups and membership |
| `src/kick-vote-store.ts` | One active vote-kick per group, 60s TTL |
| `src/user-registry.ts` | In-memory active user tracking, 30s disconnect TTL |
| `src/rate-limiter.ts` | Token bucket rate limiting (10 req/s per socket) |
| `src/validators.ts` | Zod validation for all payloads |
| `src/e2ee.ts` | ECDH P-256 + HKDF-SHA256 + AES-GCM-256 crypto primitives |
| `src/e2ee-session.ts` | Per-peer shared key management |
| `src/media-store.ts` | In-memory attachment blobs, 24 h TTL, quotas, periodic sweep |
| `src/media-auth.ts` | Media bearer tokens (one active token per user, 24 h TTL) |
| `src/media-http.ts` | `/media/:id` PUT/GET/OPTIONS handler with CORS and rate limiting |
| `src/logger.ts` | Pino structured logger |

### Web modules (`frontend/`)

| Module | Purpose |
|---|---|
| `src/App.tsx` | Root: ChatProvider wrapper, auth gate |
| `src/context/ChatContext.tsx` | React Context + useReducer for all app state |
| `src/lib/socket.ts` | Socket.io-client singleton (honours `VITE_API_URL`) |
| `src/lib/e2ee.ts` | Web Crypto API primitives (same as backend) |
| `src/lib/e2ee-session.ts` | Client-side key management |
| `src/components/AuthScreen.tsx` | Login / Register / Guest tab container |
| `src/components/ChatLayout.tsx` | Split-pane responsive layout |
| `src/components/Sidebar.tsx` | User list, ephemeral banner, current user |
| `src/components/ChatArea.tsx` | Message list + input + header |
| `src/components/MessageBubble.tsx` | Individual message with E2EE status |
| `src/components/UserItem.tsx` | Selectable user row |

### Mobile modules (`mobile/`)

| Module | Purpose |
|---|---|
| `lib/main.dart` | App entry point |
| `lib/src/state/chat_controller.dart` | Application state (ChangeNotifier), mirrors the web `ChatContext` |
| `lib/src/net/socket_service.dart` | Socket.io connection (default `http://localhost:3000`) |
| `lib/src/net/server_config.dart` | Validated, persisted server address from the auth screen |
| `lib/src/net/chat_events.dart` | Socket.io event name constants (same names as the backend) |
| `lib/src/net/media_client.dart` | HTTP `PUT`/`GET /media` client with the bearer token |
| `lib/src/net/media_opener.dart` | Opens a fetched attachment in an external viewer |
| `lib/src/crypto/e2ee.dart` | ECDH P-256 + HKDF-SHA256 + AES-GCM-256 primitives |
| `lib/src/crypto/e2ee_session.dart` | Per-peer shared key management |
| `lib/src/crypto/media_crypto.dart` | Per-file encryption (file key + IV, SHA-256) |
| `lib/src/models/` | Wire models: user, group, message, media, auth, errors |
| `lib/src/ui/` | Screens (auth, chat shell, conversation list) and widgets |

### Socket.io event contract

Full types live in `backend/src/types.ts`; the Flutter client mirrors the names in `lib/src/net/chat_events.dart`.

**Client → server:**

| Event | Purpose |
|---|---|
| `user:join` | Join as a guest with a username |
| `user:register`, `user:login` | Account auth (password, optional PIN) |
| `e2ee:public_key` | Send own ECDH public key to one peer |
| `message:send` | Relay one encrypted direct message (`to`, `ciphertext`, `iv`) |
| `group:create` | Create a group from a name plus member usernames (offline users allowed) |
| `group:member:add`, `group:member:remove` | Admin-only membership changes |
| `group:kick:vote` | Vote to kick a member (majority required, 60 s window) |
| `group:message:send` | Group message: one ciphertext per member the sender holds a shared key for |

**Server → client:**

| Event | Purpose |
|---|---|
| `user:joined`, `user:left`, `active_users` | Presence roster |
| `users:directory` | All known usernames (accounts + guests), so offline members can be added to groups |
| `active_groups` | Group snapshot on join, followed by any still-active kick tallies |
| `e2ee:public_key` | Relayed peer public key (a key sent by a client is also relayed back to it, which provides the self key used to decrypt own group echoes) |
| `private_message` | Ciphertext-only direct message |
| `group:message` | Group message carrying the per-member ciphertexts |
| `group:created`, `group:created_error`, `group:message_delivery_failed`, `group:member:removed`, `group:kick:tally` | Group lifecycle, membership changes, live vote tallies (`active` / `passed` / `expired`) |
| `delivery_failed`, `message_rejected`, `error` | Failures — there is no offline queue, a message to an offline user fails immediately |
| `register_success` / `register_error`, `login_success` / `login_error` | Auth results |
| `media:token` | Bearer token for the HTTP media endpoints |

After a successful join, register, or login the server sends a snapshot: `active_groups`, `users:directory`, any active kick tallies, `media:token`, and `active_users`.

## How E2EE works

1. **Key generation:** each client generates an ECDH P-256 key pair on connect
2. **Key exchange:** after the `active_users` snapshot a client sends its public key to every active user; when someone new joins, the existing clients send theirs to the newcomer. The server only relays.
3. **Key derivation:** each side derives a shared AES-256-GCM key via HKDF-SHA256 (empty salt, info `private-chat-e2ee-v1`)
4. **Encryption:** messages are encrypted client-side before transmission
5. **Decryption:** messages are decrypted client-side after reception

For groups the sender encrypts the same plaintext once per member it holds a shared key for (including its own copy, so it can render its own message) and sends the resulting ciphertexts array; the server fans the same array out to every member.

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

## Testing

### Backend

```bash
cd backend
bun test               # unit tests
bun run typecheck      # tsc --noEmit
bunx biome check src/  # lint
```

### Web frontend

```bash
cd frontend
npm run typecheck
npm run lint
```

### Flutter app

```bash
cd mobile
flutter analyze
flutter test
```

### Live end-to-end test

Start the backend, then run the live suite with `RUN_LIVE_E2E=1` (without it the suite is skipped):

```bash
# Terminal 1 — backend
cd backend
bun run src/index.ts

# Terminal 2 — live E2E
cd mobile
RUN_LIVE_E2E=1 flutter test test/e2e_live_test.dart
```

The suite drives real `ChatController` clients against the running backend and verifies bidirectional E2EE messages between two clients, group membership (an invitee added while offline, admin remove, a passed vote-kick, the user directory), and a media attachment round trip (upload → descriptor over E2EE → download → byte-for-byte check). `SERVER_URL` overrides the target (`http://localhost:3000` by default).

## Tech Stack

**Backend:** Bun, Socket.io v4, Zod v4, Pino, bun:sqlite, Bun.password (bcrypt)

**Web:** React 19, Vite, TypeScript 6, Tailwind CSS v4, Socket.io-client v4, Biome

**Mobile:** Flutter/Dart, socket_io_client, cryptography, pointycastle, shared_preferences, file_picker

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
