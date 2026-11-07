# TODO

## Comprehensive README

After all planned features are done, rewrite README.md into a full project
guide:
- What the app is, features overview (E2EE, groups, admin/vote-kick, TLS).
- Setup guide: backend (Bun), web frontend (Vite), Flutter app (desktop +
  Android APK), environment variables, TLS certificate setup with a domain.
- How to run everything locally and on the LAN, with firewall notes.
- Architecture overview: event contract, E2EE flow (P-256 + HKDF + AES-GCM),
  storage (what is and is not persisted).
- Testing: how to run each test suite and the live E2E test.

## Media sharing (pictures / videos)

Deferred until the group-management work (offline members, admin add/remove,
vote-kick, TLS) is finished.

Requirements:
- Users can send images/videos in chats.
- Files must not be viewable as-is if someone gets them off the server —
  encrypt at rest (server-side), or better: encrypt on the sender's device
  so the server only ever holds opaque blobs (consistent with how messages
  already work).
- Storage should be temporary — e.g. a temp directory or in-memory cache,
  with a TTL, so files do not accumulate.
- If the server or the server machine crashes, all pending files get wiped —
  acceptable and even desirable (nothing durable to leak).

Open questions to research before implementing:
- Is persistent storage needed at all, or is an ephemeral queue enough
  (recipient online → stream → delete)?
- Best strategy for privacy: E2EE blob + ephemeral cache vs server-decrypt
  with TLS only. Prefer sender-side encryption so the server cannot read
  content even in memory.
- How to handle offline recipients (file must outlive the sender's session
  but still expire) — bounded TTL + size quotas.
- Where files live: temp dir vs memory, cleanup on restart, quota caps.
