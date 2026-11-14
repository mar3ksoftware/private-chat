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
  MessageRejectedPayload,
  PollClosedPayload,
  PollVotedPayload,
  ServerToClientEvents,
  UserInfo,
  UserLeftPayload,
} from './types';
import { CONSTANTS, EVENTS } from './types';
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

// Valid sender-generated UUID used as the pollId (the id of the poll message).
const POLL_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('Poll relays', () => {
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

  // ── poll:vote / poll:voted ───────────────────────────────────────────

  test('PV1: poll:vote relays to the DM peer with u and never echoes the sender', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pv1_a');
    await join(b, 'pv1_b');

    const got = waitEvent<PollVotedPayload>(b, EVENTS.SERVER.POLL_VOTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 2, to: 'pv1_b' });
    const payload = await got;

    expect(payload.pollId).toBe(POLL_ID);
    expect(payload.option).toBe(2);
    expect(payload.u).toBe('pv1_a');
    expect(payload.to).toBe('pv1_b');

    let echoed = false;
    a.on(EVENTS.SERVER.POLL_VOTED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('PV2: poll:vote with a non-UUID pollId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pv2_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: 'not-a-uuid', option: 1, to: 'pv2_b' });
    const payload = await rejected;
    expect(payload.reason).toContain('UUID');
  });

  test('PV3: poll:vote with a non-integer option is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pv3_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 1.5, to: 'pv3_b' });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('PV4: poll:vote with option 10 (over the 0..9 bound) is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pv4_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 10, to: 'pv4_b' });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('PV5: poll:vote with option -1 (under the 0..9 bound) is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pv5_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: -1, to: 'pv5_b' });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('PV6: poll:vote without an option field is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pv6_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, to: 'pv6_b' } as never);
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('PV7: poll:vote with neither to nor groupId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pv7_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 0 });
    const payload = await rejected;
    expect(payload.reason).toContain('exactly one');
  });

  test('PV8: poll:vote with both to and groupId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pv8_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, {
      pollId: POLL_ID,
      option: 0,
      to: 'pv8_b',
      groupId: 'some-group',
    });
    const payload = await rejected;
    expect(payload.reason).toContain('exactly one');
  });

  test('PV9: poll:vote accepts the 0 and 9 option bounds', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pv9_a');
    await join(b, 'pv9_b');

    const first = waitEvent<PollVotedPayload>(b, EVENTS.SERVER.POLL_VOTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 0, to: 'pv9_b' });
    expect((await first).option).toBe(0);

    const second = waitEvent<PollVotedPayload>(b, EVENTS.SERVER.POLL_VOTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 9, to: 'pv9_b' });
    expect((await second).option).toBe(9);
  });

  test('PV10: group poll:vote fans out to the other members but never the sender', async () => {
    const [a, b, c, group] = await trio('pvg_');

    const fromA = waitEvent<PollVotedPayload>(a, EVENTS.SERVER.POLL_VOTED);
    const fromB = waitEvent<PollVotedPayload>(b, EVENTS.SERVER.POLL_VOTED);
    let senderSaw = false;
    c.on(EVENTS.SERVER.POLL_VOTED, () => {
      senderSaw = true;
    });
    c.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 3, groupId: group.groupId });

    const [payloadA, payloadB] = await Promise.all([fromA, fromB]);
    expect(payloadA.groupId).toBe(group.groupId);
    expect(payloadA.u).toBe('pvg_c');
    expect(payloadB.option).toBe(3);
    await delay(200);
    expect(senderSaw).toBe(false);
  });

  test('PV11: group poll:vote from a non-member is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pvm_a');
    await join(b, 'pvm_b');
    const group = await createGroup(a, 'Nonmember Vote', []);

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 1, groupId: group.groupId });
    const payload = await rejected;
    expect(payload.reason).toBe('Not a group member');
  });

  test('PV12: poll:vote to a nonexistent user is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pvgst_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 1, to: 'ghost_pv' });
    const payload = await rejected;
    expect(payload.reason).toBe('User not found');
  });

  test('PV13: poll:vote to an offline peer drops silently', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pvof_a');
    await join(b, 'pvof_b');

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
    a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 1, to: 'pvof_b' });
    await delay(300);
    expect(problems).toHaveLength(0);
  });

  test('PV14: a burst of poll:vote trips the shared rate-limit bucket', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pvrl_a');
    await join(b, 'pvrl_b');

    const reasons: string[] = [];
    a.on(EVENTS.SERVER.MESSAGE_REJECTED, (payload: MessageRejectedPayload) => {
      reasons.push(payload.reason);
    });
    for (let i = 0; i < CONSTANTS.RATE_LIMIT_MAX + 5; i++) {
      a.emit(EVENTS.CLIENT.POLL_VOTE, { pollId: POLL_ID, option: 1, to: 'pvrl_b' });
    }
    await delay(400);
    expect(reasons).toContain('Rate limit exceeded');
  });

  // ── poll:close / poll:closed ─────────────────────────────────────────

  test('PC1: poll:close relays to the DM peer with u and never echoes the sender', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pc1_a');
    await join(b, 'pc1_b');

    const got = waitEvent<PollClosedPayload>(b, EVENTS.SERVER.POLL_CLOSED);
    a.emit(EVENTS.CLIENT.POLL_CLOSE, { pollId: POLL_ID, to: 'pc1_b' });
    const payload = await got;

    expect(payload.pollId).toBe(POLL_ID);
    expect(payload.u).toBe('pc1_a');
    expect(payload.to).toBe('pc1_b');

    let echoed = false;
    a.on(EVENTS.SERVER.POLL_CLOSED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('PC2: group poll:close fans out to the other members but never the sender', async () => {
    const [a, b, c, group] = await trio('pcg_');

    const fromA = waitEvent<PollClosedPayload>(a, EVENTS.SERVER.POLL_CLOSED);
    const fromB = waitEvent<PollClosedPayload>(b, EVENTS.SERVER.POLL_CLOSED);
    let senderSaw = false;
    c.on(EVENTS.SERVER.POLL_CLOSED, () => {
      senderSaw = true;
    });
    c.emit(EVENTS.CLIENT.POLL_CLOSE, { pollId: POLL_ID, groupId: group.groupId });

    const [payloadA, payloadB] = await Promise.all([fromA, fromB]);
    expect(payloadA.groupId).toBe(group.groupId);
    expect(payloadA.u).toBe('pcg_c');
    expect(payloadB.pollId).toBe(POLL_ID);
    await delay(200);
    expect(senderSaw).toBe(false);
  });

  test('PC3: poll:close with a non-UUID pollId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pc3_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_CLOSE, { pollId: 'nope', to: 'pc3_b' });
    const payload = await rejected;
    expect(payload.reason).toContain('UUID');
  });

  test('PC4: poll:close with neither to nor groupId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pc4_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_CLOSE, { pollId: POLL_ID });
    const payload = await rejected;
    expect(payload.reason).toContain('exactly one');
  });

  test('PC5: poll:close with both to and groupId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pc5_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.POLL_CLOSE, {
      pollId: POLL_ID,
      to: 'pc5_b',
      groupId: 'some-group',
    });
    const payload = await rejected;
    expect(payload.reason).toContain('exactly one');
  });

  test('PC6: group poll:close from a non-member is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pcm_a');
    await join(b, 'pcm_b');
    const group = await createGroup(a, 'Nonmember Close', []);

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.POLL_CLOSE, { pollId: POLL_ID, groupId: group.groupId });
    const payload = await rejected;
    expect(payload.reason).toBe('Not a group member');
  });

  test('PC7: poll:close to an offline peer drops silently', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pcof_a');
    await join(b, 'pcof_b');

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
    a.emit(EVENTS.CLIENT.POLL_CLOSE, { pollId: POLL_ID, to: 'pcof_b' });
    await delay(300);
    expect(problems).toHaveLength(0);
  });
});
