import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Server as Engine } from '@socket.io/bun-engine';
import pino from 'pino';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';

import { AccountStore } from './account-store';
import { GroupStore } from './group-store';
import { KickVoteStore } from './kick-vote-store';
import { MediaAuth } from './media-auth';
import { ProfileStore } from './profile-store';
import { RateLimiterRegistry } from './rate-limiter';
import { createServer } from './server';
import type {
  ClientToServerEvents,
  GroupInfo,
  GroupMessage,
  MessageDeletedPayload,
  MessageEditedPayload,
  MessageReactedPayload,
  MessageRejectedPayload,
  PrivateMessage,
  ProfileUpdatedPayload,
  ReceiptReadRelay,
  ServerToClientEvents,
  TypingChangedPayload,
  UserInfo,
  UserLeftPayload,
} from './types';
import { CONSTANTS, EVENTS, UserId } from './types';
import { UserDirectory } from './user-directory';
import { UserRegistry } from './user-registry';

type TestClient = ReturnType<typeof Client>;

function makeUrl(port: number): string {
  return `http://localhost:${port}`;
}

function createClient(port: number) {
  return Client(makeUrl(port), {
    path: '/socket.io/',
    autoConnect: false,
    reconnection: false,
    timeout: 5000,
    forceNew: true,
  });
}

async function connect(client: TestClient): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    client.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    client.once('connect_error', (err: Error) => {
      clearTimeout(t);
      reject(err);
    });
  });
  client.connect();
  await promise;
}

function waitEvent<T>(client: TestClient, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event "${event}" timeout`)), 5000);
    client.once(event, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function join(
  client: TestClient,
  username: string,
): Promise<{ users: readonly UserInfo[]; groups: readonly GroupInfo[] }> {
  const usersPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
  const groupsPromise = waitEvent<readonly GroupInfo[]>(client, EVENTS.SERVER.ACTIVE_GROUPS);
  client.emit(EVENTS.CLIENT.USER_JOIN, { username });
  const [users, groups] = await Promise.all([usersPromise, groupsPromise]);
  return { users, groups };
}

async function createGroup(
  creator: TestClient,
  name: string,
  members: readonly string[],
): Promise<GroupInfo> {
  const groupPromise = waitEvent<GroupInfo>(creator, EVENTS.SERVER.GROUP_CREATED);
  creator.emit(EVENTS.CLIENT.GROUP_CREATE, { name, members: [...members] });
  return groupPromise;
}

// Valid sender-generated UUID used as a relay target/message id.
const TARGET_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('Tier-1 relays', () => {
  let io: Server<ClientToServerEvents, ServerToClientEvents>;
  let engine: Engine;
  let userRegistry: UserRegistry;
  let rateLimiters: RateLimiterRegistry;
  let db: Database;
  let accountStore: AccountStore;
  let groupStore: GroupStore;
  let userDirectory: UserDirectory;
  let kickVoteStore: KickVoteStore;
  let mediaAuth: MediaAuth;
  let profileStore: ProfileStore;
  let bunServer: ReturnType<typeof Bun.serve>;
  let port: number;
  const clients: TestClient[] = [];

  // Three joined members in one fresh group, used by the fan-out tests.
  async function trio(
    prefix: string,
  ): Promise<readonly [TestClient, TestClient, TestClient, GroupInfo]> {
    const a = createClient(port);
    const b = createClient(port);
    const c = createClient(port);
    clients.push(a, b, c);
    await Promise.all([connect(a), connect(b), connect(c)]);
    await join(a, `${prefix}a`);
    await join(b, `${prefix}b`);
    await join(c, `${prefix}c`);
    const group = await createGroup(a, `${prefix} group`, [`${prefix}b`, `${prefix}c`]);
    return [a, b, c, group];
  }

  beforeAll(() => {
    io = new Server<ClientToServerEvents, ServerToClientEvents>();
    engine = new Engine({ path: '/socket.io/' });
    io.bind(engine);
    userRegistry = new UserRegistry();
    rateLimiters = new RateLimiterRegistry();
    db = new Database(':memory:');
    accountStore = new AccountStore(db);
    groupStore = new GroupStore();
    userDirectory = new UserDirectory(db);
    kickVoteStore = new KickVoteStore();
    mediaAuth = new MediaAuth();
    profileStore = new ProfileStore();
    createServer(
      io,
      userRegistry,
      rateLimiters,
      accountStore,
      groupStore,
      userDirectory,
      kickVoteStore,
      mediaAuth,
      profileStore,
      pino({ level: 'silent' }),
    );

    const handler = engine.handler();
    bunServer = Bun.serve({
      port: 0,
      idleTimeout: 30,
      fetch: handler.fetch,
      websocket: handler.websocket,
    });
    const assignedPort = bunServer.port;
    if (assignedPort === undefined) {
      throw new Error('no port assigned');
    }
    port = assignedPort;
  });

  afterAll(() => {
    for (const c of clients) {
      if (c.connected) {
        c.disconnect();
      }
    }
    clients.length = 0;
    io.close();
    bunServer.stop();
    userRegistry.destroy();
    kickVoteStore.destroy();
    mediaAuth.destroy();
    profileStore.destroy();
    rateLimiters.destroy();
    accountStore.destroy();
    groupStore.destroy();
  });

  afterEach(() => {
    for (const c of clients) {
      if (c.connected) {
        c.disconnect();
      }
    }
    clients.length = 0;
  });

  // ── typing:send / typing:changed ─────────────────────────────────────

  test('T1: typing:send relays to the DM peer only', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'ty_a');
    await join(b, 'ty_b');

    const got = waitEvent<TypingChangedPayload>(b, EVENTS.SERVER.TYPING_CHANGED);
    a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'ty_b', active: true });
    const payload = await got;

    expect(payload.from).toBe(UserId('ty_a'));
    expect(payload.fromUsername).toBe('ty_a');
    expect(payload.to).toBe('ty_b');
    expect(payload.active).toBe(true);

    let echoed = false;
    a.on(EVENTS.SERVER.TYPING_CHANGED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('T2: group typing reaches other members but never the sender', async () => {
    const [a, b, c, group] = await trio('tg_');

    const fromA = waitEvent<TypingChangedPayload>(a, EVENTS.SERVER.TYPING_CHANGED);
    const fromB = waitEvent<TypingChangedPayload>(b, EVENTS.SERVER.TYPING_CHANGED);
    let senderSaw = false;
    c.on(EVENTS.SERVER.TYPING_CHANGED, () => {
      senderSaw = true;
    });
    c.emit(EVENTS.CLIENT.TYPING_SEND, { groupId: group.groupId, active: true });

    const [payloadA, payloadB] = await Promise.all([fromA, fromB]);
    expect(payloadA.groupId).toBe(group.groupId);
    expect(payloadA.fromUsername).toBe('tg_c');
    expect(payloadB.fromUsername).toBe('tg_c');
    expect(payloadB.active).toBe(true);
    await delay(200);
    expect(senderSaw).toBe(false);
  });

  test('T3: typing with both to and groupId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'tb_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.TYPING_SEND, {
      to: 'tb_b',
      groupId: 'some-group',
      active: true,
    });
    const payload = await rejected;
    expect(payload.reason).toContain('exactly one');
  });

  test('T4: typing with neither to nor groupId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'tn_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.TYPING_SEND, { active: true });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('T5: group typing from a non-member is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'tnm_a');
    await join(b, 'tnm_b');
    const group = await createGroup(a, 'Nonmember Typing', []);

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.TYPING_SEND, { groupId: group.groupId, active: true });
    const payload = await rejected;
    expect(payload.reason).toBe('Not a group member');
  });

  test('T6: typing to a nonexistent user is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'tnx_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'ghost_ty', active: true });
    const payload = await rejected;
    expect(payload.reason).toBe('User not found');
  });

  test('T7: invalid typing payload is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'tinv_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'tinv_b', active: 'loud' } as never);
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('T8: typing to an offline peer drops silently', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'tpf_a');
    await join(b, 'tpf_b');

    const left = waitEvent<UserLeftPayload>(a, EVENTS.SERVER.USER_LEFT);
    b.io.engine.close();
    await left;

    const problems: string[] = [];
    a.on(EVENTS.SERVER.MESSAGE_REJECTED, (payload: MessageRejectedPayload) => {
      problems.push(payload.reason);
    });
    a.on(EVENTS.SERVER.DELIVERY_FAILED, () => {
      problems.push('delivery_failed');
    });
    a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'tpf_b', active: true });
    await delay(300);
    expect(problems).toHaveLength(0);
  });

  test('T9: duplicate typing inside the 3s debounce is suppressed', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'tdb_a');
    await join(b, 'tdb_b');

    let received = 0;
    b.on(EVENTS.SERVER.TYPING_CHANGED, () => {
      received += 1;
    });

    a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'tdb_b', active: true });
    a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'tdb_b', active: true });
    await delay(300);
    expect(received).toBe(1);

    // Once the window has passed the next burst relays again.
    await delay(CONSTANTS.TYPING_DEBOUNCE_MS);
    a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'tdb_b', active: true });
    await delay(300);
    expect(received).toBe(2);
  });

  // ── receipt:read ─────────────────────────────────────────────────────

  test('R1: receipt:read reaches the peer and never echoes to the sender', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'rc_a');
    await join(b, 'rc_b');

    const upTo = Date.now();
    const got = waitEvent<ReceiptReadRelay>(b, EVENTS.SERVER.RECEIPT_READ);
    a.emit(EVENTS.CLIENT.RECEIPT_READ, { to: 'rc_b', upTo });
    const payload = await got;

    expect(payload.from).toBe(UserId('rc_a'));
    expect(payload.fromUsername).toBe('rc_a');
    expect(payload.upTo).toBe(upTo);

    let echoed = false;
    a.on(EVENTS.SERVER.RECEIPT_READ, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('R2: receipt:read with upTo beyond the future bound is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'rf_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.RECEIPT_READ, { to: 'rf_b', upTo: Date.now() + 120_000 });
    const payload = await rejected;
    expect(payload.reason).toContain('future');
  });

  test('R3: receipt:read for a nonexistent user is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'rn_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.RECEIPT_READ, { to: 'ghost_rc', upTo: Date.now() });
    const payload = await rejected;
    expect(payload.reason).toBe('User not found');
  });

  test('R4: receipt:read scoped to a group is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'rg_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.RECEIPT_READ, {
      to: 'rg_b',
      upTo: Date.now(),
      groupId: 'some-group',
    } as never);
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  // ── message:react / message:reacted ──────────────────────────────────

  test('X1: message:react fans out to the DM peer only', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'rx_a');
    await join(b, 'rx_b');

    const got = waitEvent<MessageReactedPayload>(b, EVENTS.SERVER.MESSAGE_REACTED);
    a.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      to: 'rx_b',
      targetId: TARGET_ID,
      emoji: '👍',
      active: true,
    });
    const payload = await got;

    expect(payload.fromUsername).toBe('rx_a');
    expect(payload.to).toBe('rx_b');
    expect(payload.targetId).toBe(TARGET_ID);
    expect(payload.emoji).toBe('👍');
    expect(payload.active).toBe(true);
    expect(typeof payload.timestamp).toBe('number');

    let echoed = false;
    a.on(EVENTS.SERVER.MESSAGE_REACTED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('X2: message:react with active:false relays correctly', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'rfa_a');
    await join(b, 'rfa_b');

    const got = waitEvent<MessageReactedPayload>(b, EVENTS.SERVER.MESSAGE_REACTED);
    a.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      to: 'rfa_b',
      targetId: TARGET_ID,
      emoji: '🎉',
      active: false,
    });
    const payload = await got;
    expect(payload.active).toBe(false);
    expect(payload.emoji).toBe('🎉');
  });

  test('X3: message:react with an empty emoji is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'rem_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      to: 'rem_b',
      targetId: TARGET_ID,
      emoji: '',
      active: true,
    });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('X4: message:react with an emoji over 16 units is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'rlen_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      to: 'rlen_b',
      targetId: TARGET_ID,
      emoji: 'x'.repeat(17),
      active: true,
    });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('X5: message:react with whitespace in the emoji is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'rws_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      to: 'rws_b',
      targetId: TARGET_ID,
      emoji: '👍 👍',
      active: true,
    });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('X6: message:react with a non-UUID targetId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'rtid_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      to: 'rtid_b',
      targetId: 'not-a-uuid',
      emoji: '👍',
      active: true,
    });
    const payload = await rejected;
    expect(payload.reason).toContain('UUID');
  });

  test('X7: group message:react from a non-member is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'rxm_a');
    await join(b, 'rxm_b');
    const group = await createGroup(a, 'Nonmember React', []);

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      groupId: group.groupId,
      targetId: TARGET_ID,
      emoji: '👍',
      active: true,
    });
    const payload = await rejected;
    expect(payload.reason).toBe('Not a group member');
  });

  test('X8: group message:react fans out excluding the sender', async () => {
    const [a, b, c, group] = await trio('rga_');

    const fromA = waitEvent<MessageReactedPayload>(a, EVENTS.SERVER.MESSAGE_REACTED);
    const fromB = waitEvent<MessageReactedPayload>(b, EVENTS.SERVER.MESSAGE_REACTED);
    let senderSaw = false;
    c.on(EVENTS.SERVER.MESSAGE_REACTED, () => {
      senderSaw = true;
    });
    c.emit(EVENTS.CLIENT.MESSAGE_REACT, {
      groupId: group.groupId,
      targetId: TARGET_ID,
      emoji: '🔥',
      active: true,
    });

    const [payloadA, payloadB] = await Promise.all([fromA, fromB]);
    expect(payloadA.groupId).toBe(group.groupId);
    expect(payloadA.fromUsername).toBe('rga_c');
    expect(payloadB.emoji).toBe('🔥');
    await delay(200);
    expect(senderSaw).toBe(false);
  });

  // ── message:edit / message:edited ────────────────────────────────────

  test('E1: message:edit fans out to the DM peer only', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'ed_a');
    await join(b, 'ed_b');

    const got = waitEvent<MessageEditedPayload>(b, EVENTS.SERVER.MESSAGE_EDITED);
    a.emit(EVENTS.CLIENT.MESSAGE_EDIT, {
      to: 'ed_b',
      targetId: TARGET_ID,
      ciphertext: 'fresh-ciphertext',
      iv: 'aGVsbG8=',
    });
    const payload = await got;

    expect(payload.fromUsername).toBe('ed_a');
    expect(payload.to).toBe('ed_b');
    expect(payload.targetId).toBe(TARGET_ID);
    expect(payload.ciphertext).toBe('fresh-ciphertext');
    expect(payload.iv).toBe('aGVsbG8=');
    expect(typeof payload.timestamp).toBe('number');

    let echoed = false;
    a.on(EVENTS.SERVER.MESSAGE_EDITED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('E2: group message:edit fans out excluding the sender', async () => {
    const [a, b, c, group] = await trio('ega_');

    const fromA = waitEvent<MessageEditedPayload>(a, EVENTS.SERVER.MESSAGE_EDITED);
    const fromB = waitEvent<MessageEditedPayload>(b, EVENTS.SERVER.MESSAGE_EDITED);
    let senderSaw = false;
    c.on(EVENTS.SERVER.MESSAGE_EDITED, () => {
      senderSaw = true;
    });
    c.emit(EVENTS.CLIENT.MESSAGE_EDIT, {
      groupId: group.groupId,
      targetId: TARGET_ID,
      ciphertext: 'edited-body',
      iv: 'aGVsbG8=',
    });

    const [payloadA, payloadB] = await Promise.all([fromA, fromB]);
    expect(payloadA.fromUsername).toBe('ega_c');
    expect(payloadA.ciphertext).toBe('edited-body');
    expect(payloadB.groupId).toBe(group.groupId);
    await delay(200);
    expect(senderSaw).toBe(false);
  });

  test('E3: message:edit with ciphertext over 30000 chars is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'ect_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_EDIT, {
      to: 'ect_b',
      targetId: TARGET_ID,
      ciphertext: 'x'.repeat(30_001),
      iv: 'aGVsbG8=',
    });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('E4: message:edit with iv over 64 chars is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'eiv_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_EDIT, {
      to: 'eiv_b',
      targetId: TARGET_ID,
      ciphertext: 'fresh-ciphertext',
      iv: 'x'.repeat(65),
    });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('E5: group message:edit from a non-member is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'enm_a');
    await join(b, 'enm_b');
    const group = await createGroup(a, 'Nonmember Edit', []);

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.MESSAGE_EDIT, {
      groupId: group.groupId,
      targetId: TARGET_ID,
      ciphertext: 'fresh-ciphertext',
      iv: 'aGVsbG8=',
    });
    const payload = await rejected;
    expect(payload.reason).toBe('Not a group member');
  });

  // ── message:delete / message:deleted ─────────────────────────────────

  test('D1: message:delete fans out to the DM peer only', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'dl_a');
    await join(b, 'dl_b');

    const got = waitEvent<MessageDeletedPayload>(b, EVENTS.SERVER.MESSAGE_DELETED);
    a.emit(EVENTS.CLIENT.MESSAGE_DELETE, { to: 'dl_b', targetId: TARGET_ID });
    const payload = await got;

    expect(payload.fromUsername).toBe('dl_a');
    expect(payload.to).toBe('dl_b');
    expect(payload.targetId).toBe(TARGET_ID);
    expect(typeof payload.timestamp).toBe('number');

    let echoed = false;
    a.on(EVENTS.SERVER.MESSAGE_DELETED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('D2: group message:delete fans out excluding the sender', async () => {
    const [a, b, c, group] = await trio('dga_');

    const fromA = waitEvent<MessageDeletedPayload>(a, EVENTS.SERVER.MESSAGE_DELETED);
    const fromB = waitEvent<MessageDeletedPayload>(b, EVENTS.SERVER.MESSAGE_DELETED);
    let senderSaw = false;
    c.on(EVENTS.SERVER.MESSAGE_DELETED, () => {
      senderSaw = true;
    });
    c.emit(EVENTS.CLIENT.MESSAGE_DELETE, {
      groupId: group.groupId,
      targetId: TARGET_ID,
    });

    const [payloadA, payloadB] = await Promise.all([fromA, fromB]);
    expect(payloadA.fromUsername).toBe('dga_c');
    expect(payloadA.targetId).toBe(TARGET_ID);
    expect(payloadB.groupId).toBe(group.groupId);
    await delay(200);
    expect(senderSaw).toBe(false);
  });

  test('D3: message:delete with a non-UUID targetId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'dtid_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_DELETE, { to: 'dtid_b', targetId: 'nope' });
    const payload = await rejected;
    expect(payload.reason).toContain('UUID');
  });

  test('D4: group message:delete from a non-member is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'dnm_a');
    await join(b, 'dnm_b');
    const group = await createGroup(a, 'Nonmember Delete', []);

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.MESSAGE_DELETE, { groupId: group.groupId, targetId: TARGET_ID });
    const payload = await rejected;
    expect(payload.reason).toBe('Not a group member');
  });

  // ── profile:update / profile:updated ─────────────────────────────────

  test('P1: profile:update broadcasts profile:updated to every active session', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pr1_a');
    await join(b, 'pr1_b');

    const forA = waitEvent<ProfileUpdatedPayload>(a, EVENTS.SERVER.PROFILE_UPDATED);
    const forB = waitEvent<ProfileUpdatedPayload>(b, EVENTS.SERVER.PROFILE_UPDATED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: 'Alice Prime', status: 'busy' });

    const [payloadA, payloadB] = await Promise.all([forA, forB]);
    for (const payload of [payloadA, payloadB]) {
      expect(payload.username).toBe('pr1_a');
      expect(payload.displayName).toBe('Alice Prime');
      expect(payload.status).toBe('busy');
    }
  });

  test('P2: displayName bounds — 33 rejected, 32 accepted', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pr2_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: 'x'.repeat(33), status: '' });
    const bad = await rejected;
    expect(bad.reason).toContain('32');

    const updated = waitEvent<ProfileUpdatedPayload>(a, EVENTS.SERVER.PROFILE_UPDATED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: 'x'.repeat(32), status: '' });
    const good = await updated;
    expect(good.displayName).toHaveLength(32);
  });

  test('P3: status bounds — 81 rejected, 80 accepted', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pr3_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: 'Alice', status: 'x'.repeat(81) });
    const bad = await rejected;
    expect(bad.reason).toContain('80');

    const updated = waitEvent<ProfileUpdatedPayload>(a, EVENTS.SERVER.PROFILE_UPDATED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: 'Alice', status: 'x'.repeat(80) });
    const good = await updated;
    expect(good.status).toHaveLength(80);
  });

  test('P4: empty displayName is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pr4_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: '   ', status: '' });
    const payload = await rejected;
    expect(payload.reason).toContain('empty');
  });

  test('P5: control characters in displayName are rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pr5_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, {
      displayName: `Al${String.fromCharCode(7)}ice`,
      status: '',
    });
    const payload = await rejected;
    expect(payload.reason).toContain('control');
  });

  test('P6: active_users after an update carries displayName and status', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pr6_a');

    const updated = waitEvent<ProfileUpdatedPayload>(a, EVENTS.SERVER.PROFILE_UPDATED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: 'Pristine Six', status: 'on air' });
    await updated;

    const b = createClient(port);
    clients.push(b);
    await connect(b);
    const { users } = await join(b, 'pr6_b');
    const seen = users.find((u) => u.username === 'pr6_a');
    expect(seen?.displayName).toBe('Pristine Six');
    expect(seen?.status).toBe('on air');
  });

  test('P7: users without a profile fall back to username and empty status', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pr7_a');

    const joined = waitEvent<UserInfo>(a, EVENTS.SERVER.USER_JOINED);
    const b = createClient(port);
    clients.push(b);
    await connect(b);
    const { users } = await join(b, 'pr7_b');

    const payload = await joined;
    expect(payload.username).toBe('pr7_b');
    expect(payload.displayName).toBe('pr7_b');
    expect(payload.status).toBe('');

    const seen = users.find((u) => u.username === 'pr7_b');
    expect(seen?.displayName).toBe('pr7_b');
    expect(seen?.status).toBe('');
  });

  test('P8: group member lists carry profile fields with username fallback', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pr8_a');
    await join(b, 'pr8_b');

    const updated = waitEvent<ProfileUpdatedPayload>(a, EVENTS.SERVER.PROFILE_UPDATED);
    a.emit(EVENTS.CLIENT.PROFILE_UPDATE, { displayName: 'Group Owner', status: 'mod' });
    await updated;

    const group = await createGroup(a, 'Profile Group', ['pr8_b']);
    const owner = group.members.find((m) => m.username === 'pr8_a');
    const member = group.members.find((m) => m.username === 'pr8_b');
    expect(owner?.displayName).toBe('Group Owner');
    expect(owner?.status).toBe('mod');
    expect(member?.displayName).toBe('pr8_b');
    expect(member?.status).toBe('');
  });

  // ── message ids ──────────────────────────────────────────────────────

  test('I1: message:send preserves a valid id on the private_message relay', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'id1_a');
    await join(b, 'id1_b');

    const id = crypto.randomUUID();
    const got = waitEvent<PrivateMessage>(b, EVENTS.SERVER.PRIVATE_MESSAGE);
    a.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      id,
      to: 'id1_b',
      ciphertext: 'sealed-body',
      iv: 'aGVsbG8=',
    });
    const message = await got;
    expect(message.id).toBe(id);
    expect(message.fromUsername).toBe('id1_a');
  });

  test('I2: message:send with a non-UUID id is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'id2_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      id: 'not-a-uuid',
      to: 'id2_b',
      ciphertext: 'sealed-body',
      iv: 'aGVsbG8=',
    });
    const payload = await rejected;
    expect(payload.reason).toContain('UUID');
  });

  test('I3: group:message:send preserves a valid id on the group:message relay', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'id3_a');
    await join(b, 'id3_b');
    const group = await createGroup(a, 'Id Group', ['id3_b']);

    const id = crypto.randomUUID();
    const got = waitEvent<GroupMessage>(b, EVENTS.SERVER.GROUP_MESSAGE);
    a.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, {
      id,
      groupId: group.groupId,
      ciphertexts: [{ to: 'id3_b', ciphertext: 'sealed-body', iv: 'aGVsbG8=' }],
    });
    const message = await got;
    expect(message.id).toBe(id);
    expect(message.fromUsername).toBe('id3_a');
  });

  test('I4: group:message:send with a non-UUID id is rejected via message_rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'id4_a');
    await join(b, 'id4_b');
    const group = await createGroup(a, 'Bad Id Group', ['id4_b']);

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, {
      id: 'nope',
      groupId: group.groupId,
      ciphertexts: [{ to: 'id4_b', ciphertext: 'sealed-body', iv: 'aGVsbG8=' }],
    });
    const payload = await rejected;
    expect(payload.reason).toContain('UUID');
  });

  // ── rate limiting ────────────────────────────────────────────────────

  test('RL1: a burst of typing:send trips the shared rate-limit bucket', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'rl_a');
    await join(b, 'rl_b');

    const reasons: string[] = [];
    a.on(EVENTS.SERVER.MESSAGE_REJECTED, (payload: MessageRejectedPayload) => {
      reasons.push(payload.reason);
    });
    for (let i = 0; i < CONSTANTS.RATE_LIMIT_MAX + 5; i++) {
      a.emit(EVENTS.CLIENT.TYPING_SEND, { to: 'rl_b', active: true });
    }
    await delay(400);
    expect(reasons).toContain('Rate limit exceeded');
  });
});
