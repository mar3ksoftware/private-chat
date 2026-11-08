import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Server as Engine } from '@socket.io/bun-engine';
import pino from 'pino';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';

import { AccountStore } from './account-store';
import { E2eeSession } from './e2ee-session';
import { GroupStore } from './group-store';
import { KickVoteStore } from './kick-vote-store';
import { RateLimiterRegistry } from './rate-limiter';
import { createServer } from './server';
import type {
  ClientToServerEvents,
  E2eePublicKeyPayload,
  E2eePublicKeyRelay,
  GroupInfo,
  GroupMemberRemovedPayload,
  GroupMessage,
  KickTallyPayload,
  LoginResult,
  MessageRejectedPayload,
  PrivateMessage,
  RegisterResult,
  ServerToClientEvents,
  UserInfo,
  UserLeftPayload,
} from './types';
import { CONSTANTS, EVENTS, GroupId, SocketId, UserId } from './types';
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

function waitForDisconnect(client: TestClient): Promise<string> {
  return waitEvent<string>(client, 'disconnect');
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

async function joinWithDirectory(client: TestClient, username: string): Promise<readonly string[]> {
  const directoryPromise = waitEvent<readonly string[]>(client, EVENTS.SERVER.USERS_DIRECTORY);
  await join(client, username);
  return directoryPromise;
}

async function performKeyExchange(
  alice: TestClient,
  bob: TestClient,
  aliceSession: E2eeSession,
  bobSession: E2eeSession,
  aliceName: string,
  bobName: string,
): Promise<void> {
  const aliceKey = await aliceSession.getPublicKey();
  const receivedPromise = waitEvent<E2eePublicKeyRelay>(bob, EVENTS.SERVER.E2EE_PUBLIC_KEY);
  alice.emit(EVENTS.CLIENT.E2EE_PUBLIC_KEY, { to: bobName, publicKey: aliceKey });
  const received = await receivedPromise;
  expect(received.fromUsername).toBe(aliceName);

  const bobKey = await bobSession.getPublicKey();
  await bobSession.deriveSharedSecret(aliceName, received.publicKey);
  const received2Promise = waitEvent<E2eePublicKeyRelay>(alice, EVENTS.SERVER.E2EE_PUBLIC_KEY);
  bob.emit(EVENTS.CLIENT.E2EE_PUBLIC_KEY, { to: aliceName, publicKey: bobKey });
  const received2 = await received2Promise;
  await aliceSession.deriveSharedSecret(bobName, received2.publicKey);
}

describe('Socket.io Server', () => {
  let io: Server<ClientToServerEvents, ServerToClientEvents>;
  let engine: Engine;
  let userRegistry: UserRegistry;
  let rateLimiters: RateLimiterRegistry;
  let db: Database;
  let accountStore: AccountStore;
  let groupStore: GroupStore;
  let userDirectory: UserDirectory;
  let kickVoteStore: KickVoteStore;
  let bunServer: ReturnType<typeof Bun.serve>;
  let port: number;
  const clients: TestClient[] = [];

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
    createServer(
      io,
      userRegistry,
      rateLimiters,
      accountStore,
      groupStore,
      userDirectory,
      kickVoteStore,
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

  test('1: user joins with { username } and receives active_users/active_groups', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const { users, groups } = await join(client, 'alice');

    const alice = users.find((u) => u.username === 'alice');
    expect(alice).toBeDefined();
    expect(alice?.userId).toBe(UserId('alice'));
    expect(alice?.username).toBe('alice');
    expect(groups).toHaveLength(0);
  });

  test('2: message delivered to connected user', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const aliceSession = new E2eeSession();
    const bobSession = new E2eeSession();

    await join(clientA, 'alice');
    await join(clientB, 'bob');

    await performKeyExchange(clientA, clientB, aliceSession, bobSession, 'alice', 'bob');

    const enc = await aliceSession.encrypt('bob', 'hello bob');
    const msgPromise = waitEvent<PrivateMessage>(clientB, EVENTS.SERVER.PRIVATE_MESSAGE);
    clientA.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      to: 'bob',
      ciphertext: enc.ciphertext,
      iv: enc.iv,
    });
    const msg = await msgPromise;

    expect(msg.fromUsername).toBe('alice');
    expect(msg.toUsername).toBe('bob');
    const decrypted = await bobSession.decrypt('alice', msg.ciphertext, msg.iv);
    expect(decrypted).toBe('hello bob');
  });

  test('3: delivery_failed for unknown user', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'alice');

    const failPromise = waitEvent<{
      readonly delivered: boolean;
      readonly reason: string;
      readonly to: string;
    }>(client, EVENTS.SERVER.DELIVERY_FAILED);
    client.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      to: 'nonexistent',
      ciphertext: 'dummy',
      iv: 'dummy',
    });
    const result = await failPromise;

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('user_not_found');
    expect(result.to).toBe('nonexistent');
  });

  test('4: empty ciphertext rejected', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'alice');

    const rejectPromise = waitEvent<MessageRejectedPayload>(client, EVENTS.SERVER.MESSAGE_REJECTED);
    client.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: 'bob', ciphertext: '', iv: 'dummy' });
    const rejected = await rejectPromise;

    expect(rejected.reason.length).toBeGreaterThan(0);
  });

  test('5: empty iv rejected', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'alice');

    const rejectPromise = waitEvent<MessageRejectedPayload>(client, EVENTS.SERVER.MESSAGE_REJECTED);
    client.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: 'bob', ciphertext: 'x', iv: '' });
    const rejected = await rejectPromise;

    expect(rejected.reason.length).toBeGreaterThan(0);
  });

  test('6: rate limit exceeded', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'alice');

    const rejectPromise = waitEvent<MessageRejectedPayload>(client, EVENTS.SERVER.MESSAGE_REJECTED);
    for (let i = 0; i < CONSTANTS.RATE_LIMIT_MAX + 5; i++) {
      client.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: 'bob', ciphertext: 'x', iv: 'y' });
    }
    const rejected = await rejectPromise;

    expect(rejected.reason).toContain('Rate limit');
  });

  test('7: user disconnects and other user receives user:left object', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    await join(clientA, 'alice');
    await join(clientB, 'bob');

    // Set up listener before disconnecting
    const leftPromise = waitEvent<UserLeftPayload>(clientA, EVENTS.SERVER.USER_LEFT);
    clientB.disconnect();

    const left = await leftPromise;
    expect(left).toEqual({ userId: UserId('bob'), username: 'bob' });
  });

  test('8: message to disconnected user returns delivery_failed', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    await join(clientA, 'alice');
    await join(clientB, 'bob');

    // Force transport close to simulate unannounced disconnect (not explicit client.disconnect())
    const leftPromise = waitEvent<UserLeftPayload>(clientA, EVENTS.SERVER.USER_LEFT);
    clientB.io.engine.close();
    await leftPromise;

    const failPromise = waitEvent<{
      readonly delivered: boolean;
      readonly reason: string;
      readonly to: string;
    }>(clientA, EVENTS.SERVER.DELIVERY_FAILED);
    clientA.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      to: 'bob',
      ciphertext: 'dummy',
      iv: 'dummy',
    });
    const result = await failPromise;

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('user_disconnected');
    expect(result.to).toBe('bob');
  });

  test('9: e2ee public key relay', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    await join(clientA, 'alice9');
    await join(clientB, 'bob9');

    const relayPromise = waitEvent<E2eePublicKeyRelay>(clientB, EVENTS.SERVER.E2EE_PUBLIC_KEY);
    clientA.emit(EVENTS.CLIENT.E2EE_PUBLIC_KEY, {
      to: 'bob9',
      publicKey: 'test-key-base64',
    } as E2eePublicKeyPayload);
    const relay = await relayPromise;

    expect(relay.fromUsername).toBe('alice9');
    expect(relay.publicKey).toBe('test-key-base64');
  });

  test('10: e2ee full encrypted message round-trip', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const aliceSession = new E2eeSession();
    const bobSession = new E2eeSession();

    await join(clientA, 'alice10');
    await join(clientB, 'bob10');

    await performKeyExchange(clientA, clientB, aliceSession, bobSession, 'alice10', 'bob10');

    const plaintext = 'secret message from alice to bob';
    const enc = await aliceSession.encrypt('bob10', plaintext);
    const msgPromise = waitEvent<PrivateMessage>(clientB, EVENTS.SERVER.PRIVATE_MESSAGE);
    clientA.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      to: 'bob10',
      ciphertext: enc.ciphertext,
      iv: enc.iv,
    });
    const msg = await msgPromise;

    expect(msg.fromUsername).toBe('alice10');
    expect(msg.toUsername).toBe('bob10');
    expect(msg.ciphertext).toBe(enc.ciphertext);
    expect(msg.iv).toBe(enc.iv);

    const decrypted = await bobSession.decrypt('alice10', msg.ciphertext, msg.iv);
    expect(decrypted).toBe(plaintext);
  });

  test('11: e2ee message echo', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const aliceSession = new E2eeSession();
    const bobSession = new E2eeSession();

    await join(clientA, 'alice11');
    await join(clientB, 'bob11');

    await performKeyExchange(clientA, clientB, aliceSession, bobSession, 'alice11', 'bob11');

    const plaintext = 'echo test message';
    const enc = await aliceSession.encrypt('bob11', plaintext);

    const echoPromise = waitEvent<PrivateMessage>(clientA, EVENTS.SERVER.PRIVATE_MESSAGE);
    const msgPromise = waitEvent<PrivateMessage>(clientB, EVENTS.SERVER.PRIVATE_MESSAGE);
    clientA.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      to: 'bob11',
      ciphertext: enc.ciphertext,
      iv: enc.iv,
    });

    const echo = await echoPromise;
    const msg = await msgPromise;

    // Alice's echo should match the message she sent
    expect(echo.ciphertext).toBe(enc.ciphertext);
    expect(echo.iv).toBe(enc.iv);
    expect(echo.fromUsername).toBe('alice11');
    expect(echo.toUsername).toBe('bob11');

    // Bob should also receive the same ciphertext
    expect(msg.ciphertext).toBe(enc.ciphertext);
    expect(msg.iv).toBe(enc.iv);

    const decrypted = await bobSession.decrypt('alice11', msg.ciphertext, msg.iv);
    expect(decrypted).toBe(plaintext);
  });

  test('12: group:create creates group and notifies creator', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'gcreator');

    const groupPromise = waitEvent<GroupInfo>(client, EVENTS.SERVER.GROUP_CREATED);
    client.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Test Group', members: [] });
    const group = await groupPromise;

    expect(group.name).toBe('Test Group');
    expect(group.members.length).toBe(1);
    const [firstMember] = group.members;
    expect(firstMember?.username).toBe('gcreator');
    expect(firstMember?.isAdmin).toBe(true);
  });

  test('13: group:create with empty name emits error', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'gcreator2');

    const errorPromise = waitEvent<{ readonly message: string }>(
      client,
      EVENTS.SERVER.GROUP_CREATED_ERROR,
    );
    client.emit(EVENTS.CLIENT.GROUP_CREATE, { name: '', members: [] });
    const error = await errorPromise;

    expect(error.message.length).toBeGreaterThan(0);
  });

  test('14: group:message:send delivers to group members', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    await join(clientA, 'gsender');
    await join(clientB, 'gmember');

    const groupPromise = waitEvent<GroupInfo>(clientA, EVENTS.SERVER.GROUP_CREATED);
    clientA.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Msg Group', members: ['gmember'] });
    const group = await groupPromise;

    const msgPromise = waitEvent<GroupMessage>(clientB, EVENTS.SERVER.GROUP_MESSAGE);
    clientA.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, {
      groupId: group.groupId,
      ciphertexts: [{ to: 'gmember', ciphertext: 'encrypted1', iv: 'iv1' }],
    });
    const msg = await msgPromise;

    expect(msg.groupId).toBe(group.groupId);
    expect(msg.fromUsername).toBe('gsender');
    const [firstCiphertext] = msg.ciphertexts;
    expect(firstCiphertext?.ciphertext).toBe('encrypted1');
  });

  test('15: group:message:send from non-member emits delivery_failed', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'outsider');

    const failPromise = waitEvent<{ readonly message: string }>(
      client,
      EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED,
    );
    client.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, {
      groupId: 'nonexistent-group',
      ciphertexts: [{ to: 'someone', ciphertext: 'enc', iv: 'iv' }],
    });
    const error = await failPromise;

    expect(error.message.length).toBeGreaterThan(0);
  });

  test('16: group:create with invalid name emits error', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    await join(client, 'gcreator3');

    const errorPromise = waitEvent<{ readonly message: string }>(
      client,
      EVENTS.SERVER.GROUP_CREATED_ERROR,
    );
    client.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'a'.repeat(51), members: [] });
    const error = await errorPromise;

    expect(error.message.length).toBeGreaterThan(0);
  });

  test('17: guest reconnect within TTL succeeds and appears once', async () => {
    const clientA = createClient(port);
    clients.push(clientA);
    await connect(clientA);
    await join(clientA, 'reconnectguest');

    clientA.io.engine.close();
    await delay(150);

    const clientB = createClient(port);
    clients.push(clientB);
    await connect(clientB);
    const { users } = await join(clientB, 'reconnectguest');

    const matching = users.filter((u) => u.username === 'reconnectguest');
    expect(matching).toHaveLength(1);

    const clientBId = clientB.id;
    expect(clientBId).toBeDefined();
    if (clientBId !== undefined) {
      expect(matching[0]?.socketId).toBe(SocketId(clientBId));
    }
  });

  test('18: registered account reattaches and disconnects previous socket', async () => {
    const clientA = createClient(port);
    clients.push(clientA);
    await connect(clientA);

    const registerPromise = waitEvent<Extract<RegisterResult, { kind: 'register_success' }>>(
      clientA,
      EVENTS.SERVER.REGISTER_SUCCESS,
    );
    clientA.emit(EVENTS.CLIENT.USER_REGISTER, {
      username: 'acctuser',
      password: 'password123',
    });
    const registered = await registerPromise;
    expect(registered.kind).toBe('register_success');

    const clientB = createClient(port);
    clients.push(clientB);
    await connect(clientB);

    const oldSocketClosed = waitForDisconnect(clientA);
    const loginPromise = waitEvent<Extract<LoginResult, { kind: 'login_success' }>>(
      clientB,
      EVENTS.SERVER.LOGIN_SUCCESS,
    );
    clientB.emit(EVENTS.CLIENT.USER_LOGIN, {
      username: 'acctuser',
      password: 'password123',
    });
    const loggedIn = await loginPromise;

    expect(loggedIn.kind).toBe('login_success');
    await oldSocketClosed;
    expect(clientA.connected).toBe(false);

    clientB.io.engine.close();
    await delay(150);

    const clientC = createClient(port);
    clients.push(clientC);
    await connect(clientC);

    const usersPromise = waitEvent<readonly UserInfo[]>(clientC, EVENTS.SERVER.ACTIVE_USERS);
    const loginAgainPromise = waitEvent<Extract<LoginResult, { kind: 'login_success' }>>(
      clientC,
      EVENTS.SERVER.LOGIN_SUCCESS,
    );
    clientC.emit(EVENTS.CLIENT.USER_LOGIN, {
      username: 'acctuser',
      password: 'password123',
    });
    const loggedInAgain = await loginAgainPromise;
    const users = await usersPromise;

    expect(loggedInAgain.kind).toBe('login_success');
    const matching = users.filter((u) => u.username === 'acctuser');
    expect(matching).toHaveLength(1);
    expect(matching[0]?.userId).toBe(registered.userId);

    const clientCId = clientC.id;
    expect(clientCId).toBeDefined();
    if (clientCId !== undefined) {
      expect(matching[0]?.socketId).toBe(SocketId(clientCId));
    }
  });

  test('19: active_groups is emitted on join with the user groups', async () => {
    const clientA = createClient(port);
    clients.push(clientA);
    await connect(clientA);
    await join(clientA, 'groupjoin');

    const groupPromise = waitEvent<GroupInfo>(clientA, EVENTS.SERVER.GROUP_CREATED);
    clientA.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Persisted Group', members: [] });
    const group = await groupPromise;

    clientA.disconnect();

    const clientB = createClient(port);
    clients.push(clientB);
    await connect(clientB);
    const { groups } = await join(clientB, 'groupjoin');

    expect(groups.some((g) => g.groupId === group.groupId)).toBe(true);
  });

  test('20: guest join with an existing account username is rejected', async () => {
    const created = await accountStore.createAccount('existingacct', 'password123');
    expect(created.kind).toBe('register_success');

    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const errorPromise = waitEvent<{ readonly message: string }>(client, EVENTS.SERVER.ERROR);
    client.emit(EVENTS.CLIENT.USER_JOIN, { username: 'existingacct' });
    const error = await errorPromise;

    expect(error.message).toBe('username taken');
    expect(userRegistry.getUserByUsername('existingacct')).toBeUndefined();
  });

  test('21: registering an online guest username is rejected without creating an account', async () => {
    const guest = createClient(port);
    const registrant = createClient(port);
    clients.push(guest, registrant);
    await Promise.all([connect(guest), connect(registrant)]);
    await join(guest, 'raceuser');

    const registerErrorPromise = waitEvent<Extract<RegisterResult, { kind: 'register_error' }>>(
      registrant,
      EVENTS.SERVER.REGISTER_ERROR,
    );
    registrant.emit(EVENTS.CLIENT.USER_REGISTER, {
      username: 'raceuser',
      password: 'password123',
    });
    const registerError = await registerErrorPromise;

    expect(registerError.reason).toBe('username_taken');
    expect(accountStore.usernameExists('raceuser')).toBe(false);

    const loginErrorPromise = waitEvent<Extract<LoginResult, { kind: 'login_error' }>>(
      registrant,
      EVENTS.SERVER.LOGIN_ERROR,
    );
    registrant.emit(EVENTS.CLIENT.USER_LOGIN, {
      username: 'raceuser',
      password: 'password123',
    });
    const loginError = await loginErrorPromise;

    expect(loginError.reason).toBe('invalid_credentials');
  });

  test('22: large ciphertext (~20k chars) is accepted', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);
    await join(client, 'bigsender');

    const ciphertext = 'x'.repeat(20_000);
    const msgPromise = waitEvent<PrivateMessage>(client, EVENTS.SERVER.PRIVATE_MESSAGE);
    client.emit(EVENTS.CLIENT.MESSAGE_SEND, {
      to: 'bigsender',
      ciphertext,
      iv: 'aGVsbG8=',
    });
    const msg = await msgPromise;

    expect(msg.ciphertext).toBe(ciphertext);
  });

  test('23: users:directory arrives on join and includes both guests', async () => {
    const clientA = createClient(port);
    clients.push(clientA);
    await connect(clientA);
    const directoryA = await joinWithDirectory(clientA, 'dirguest1');
    expect(directoryA).toContain('dirguest1');

    const clientB = createClient(port);
    clients.push(clientB);
    await connect(clientB);
    const directoryB = await joinWithDirectory(clientB, 'dirguest2');
    expect(directoryB).toContain('dirguest1');
    expect(directoryB).toContain('dirguest2');
  });

  test('24: offline member added at create shows up and reappears on rejoin', async () => {
    const alice = createClient(port);
    clients.push(alice);
    await connect(alice);
    await join(alice, 'offmember1');
    alice.disconnect();

    const bob = createClient(port);
    clients.push(bob);
    await connect(bob);
    await join(bob, 'offcreator1');

    const groupPromise = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Offline Group', members: ['offmember1'] });
    const group = await groupPromise;
    expect(group.members.map((m) => m.username)).toContain('offmember1');

    const aliceAgain = createClient(port);
    clients.push(aliceAgain);
    await connect(aliceAgain);
    const { groups } = await join(aliceAgain, 'offmember1');
    expect(groups.some((g) => g.groupId === group.groupId)).toBe(true);
  });

  test('25: group:create with unknown member emits error and creates nothing', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);
    await join(client, 'ghostcreator');

    let createdCount = 0;
    client.on(EVENTS.SERVER.GROUP_CREATED, () => {
      createdCount += 1;
    });

    const errorPromise = waitEvent<{ readonly message: string }>(
      client,
      EVENTS.SERVER.GROUP_CREATED_ERROR,
    );
    client.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Ghost Group', members: ['ghost'] });
    const error = await errorPromise;

    expect(error.message).toBe('Unknown members: ghost');
    await delay(200);
    expect(createdCount).toBe(0);
  });

  test('26: admin add member flow and guards', async () => {
    const offlineAlice = createClient(port);
    clients.push(offlineAlice);
    await connect(offlineAlice);
    await join(offlineAlice, 'addalice');
    offlineAlice.disconnect();

    const bob = createClient(port);
    const charlie = createClient(port);
    clients.push(bob, charlie);
    await Promise.all([connect(bob), connect(charlie)]);
    await join(bob, 'addbob');
    await join(charlie, 'addcharlie');

    const groupPromise = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Add Group', members: [] });
    const group = await groupPromise;
    const groupId = group.groupId;

    const bobGotFirst = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    const charlieGotFirst = waitEvent<GroupInfo>(charlie, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, { groupId, username: 'addcharlie' });
    const [bobFirst, charlieFirst] = await Promise.all([bobGotFirst, charlieGotFirst]);
    expect(bobFirst.members).toHaveLength(2);
    expect(charlieFirst.members).toHaveLength(2);

    const bobGotOffline = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, { groupId, username: 'addalice' });
    const bobOffline = await bobGotOffline;
    expect(bobOffline.members.map((m) => m.username)).toContain('addalice');

    const nonAdminError = waitEvent<{ readonly message: string }>(charlie, EVENTS.SERVER.ERROR);
    charlie.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, { groupId, username: 'addstranger' });
    expect((await nonAdminError).message).toBe('Only admins can add members');

    const existingError = waitEvent<{ readonly message: string }>(bob, EVENTS.SERVER.ERROR);
    bob.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, { groupId, username: 'addcharlie' });
    expect((await existingError).message).toBe('User is already a member');

    const unknownError = waitEvent<{ readonly message: string }>(bob, EVENTS.SERVER.ERROR);
    bob.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, { groupId, username: 'nobody' });
    expect((await unknownError).message).toBe('Unknown user: nobody');

    const current = groupStore.getGroup(GroupId(groupId));
    expect(current).toBeDefined();
    if (current !== undefined) {
      for (let i = current.members.length; i < CONSTANTS.MAX_GROUP_MEMBERS; i++) {
        groupStore.addGroupMember(GroupId(groupId), UserId(`filler${i}`), `filler${i}`);
      }
    }

    const fullError = waitEvent<{ readonly message: string }>(bob, EVENTS.SERVER.ERROR);
    bob.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, { groupId, username: 'addlate' });
    expect((await fullError).message).toBe('Group is full');
  });

  test('27: admin remove member flow and guards', async () => {
    const mate = createClient(port);
    clients.push(mate);
    await connect(mate);
    await join(mate, 'rmmate');
    mate.disconnect();

    const bob = createClient(port);
    const charlie = createClient(port);
    clients.push(bob, charlie);
    await Promise.all([connect(bob), connect(charlie)]);
    await join(bob, 'rmob');
    await join(charlie, 'rmcharlie');

    const groupPromise = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_CREATE, {
      name: 'Remove Group',
      members: ['rmcharlie', 'rmmate'],
    });
    const group = await groupPromise;
    const groupId = group.groupId;
    expect(group.members).toHaveLength(3);

    const nonAdminError = waitEvent<{ readonly message: string }>(charlie, EVENTS.SERVER.ERROR);
    charlie.emit(EVENTS.CLIENT.GROUP_MEMBER_REMOVE, { groupId, username: 'rmob' });
    expect((await nonAdminError).message).toBe('Only admins can remove members');

    const removedPromise = waitEvent<GroupMemberRemovedPayload>(
      charlie,
      EVENTS.SERVER.GROUP_MEMBER_REMOVED,
    );
    const bobGotUpdated = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_MEMBER_REMOVE, { groupId, username: 'rmcharlie' });
    const [removed, updated] = await Promise.all([removedPromise, bobGotUpdated]);
    expect(removed).toEqual({ groupId, username: 'rmcharlie', reason: 'removed' });
    expect(updated.members).toHaveLength(2);

    const creatorError = waitEvent<{ readonly message: string }>(bob, EVENTS.SERVER.ERROR);
    bob.emit(EVENTS.CLIENT.GROUP_MEMBER_REMOVE, { groupId, username: 'rmob' });
    expect((await creatorError).message).toBe('The group creator cannot be removed');
  });

  test('28: kick vote passes at the required threshold', async () => {
    const alice = createClient(port);
    const charlie = createClient(port);
    const bob = createClient(port);
    clients.push(alice, charlie, bob);
    await Promise.all([connect(alice), connect(charlie), connect(bob)]);
    await join(alice, 'votealice');
    await join(charlie, 'votecharlie');
    await join(bob, 'votebob');

    const groupPromise = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    const aliceCreated = waitEvent<GroupInfo>(alice, EVENTS.SERVER.GROUP_CREATED);
    const charlieCreated = waitEvent<GroupInfo>(charlie, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_CREATE, {
      name: 'Vote Group',
      members: ['votealice', 'votecharlie'],
    });
    const group = await groupPromise;
    await Promise.all([aliceCreated, charlieCreated]);
    const groupId = group.groupId;
    expect(group.members).toHaveLength(3);

    const firstAlice = waitEvent<KickTallyPayload>(alice, EVENTS.SERVER.GROUP_KICK_TALLY);
    const firstBob = waitEvent<KickTallyPayload>(bob, EVENTS.SERVER.GROUP_KICK_TALLY);
    const firstCharlie = waitEvent<KickTallyPayload>(charlie, EVENTS.SERVER.GROUP_KICK_TALLY);
    alice.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'votecharlie' });
    const [tallyAlice, tallyBob, tallyCharlie] = await Promise.all([
      firstAlice,
      firstBob,
      firstCharlie,
    ]);
    for (const tally of [tallyAlice, tallyBob, tallyCharlie]) {
      expect(tally.groupId).toBe(groupId);
      expect(tally.username).toBe('votecharlie');
      expect(tally.votes).toEqual(['votealice']);
      expect(tally.required).toBe(2);
      expect(tally.status).toBe('active');
    }

    const passAlice = waitEvent<KickTallyPayload>(alice, EVENTS.SERVER.GROUP_KICK_TALLY);
    const passBob = waitEvent<KickTallyPayload>(bob, EVENTS.SERVER.GROUP_KICK_TALLY);
    const passCharlie = waitEvent<KickTallyPayload>(charlie, EVENTS.SERVER.GROUP_KICK_TALLY);
    const kickedCharlie = waitEvent<GroupMemberRemovedPayload>(
      charlie,
      EVENTS.SERVER.GROUP_MEMBER_REMOVED,
    );
    const remainingAlice = waitEvent<GroupInfo>(alice, EVENTS.SERVER.GROUP_CREATED);
    const remainingBob = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'votecharlie' });
    const [passedAlice, passedBob, passedCharlie, kicked, leftAlice, leftBob] = await Promise.all([
      passAlice,
      passBob,
      passCharlie,
      kickedCharlie,
      remainingAlice,
      remainingBob,
    ]);
    expect(passedAlice.status).toBe('passed');
    expect(passedBob.status).toBe('passed');
    expect(passedCharlie.status).toBe('passed');
    expect(passedCharlie.votes).toEqual(['votealice', 'votebob']);
    expect(kicked).toEqual({ groupId, username: 'votecharlie', reason: 'kicked' });
    expect(leftAlice.members).toHaveLength(2);
    expect(leftBob.members).toHaveLength(2);
    expect(leftAlice.members.map((m) => m.username)).not.toContain('votecharlie');
  });

  test('29: kick vote guards reject bad targets and duplicate casts', async () => {
    const alice = createClient(port);
    const charlie = createClient(port);
    const dave = createClient(port);
    const bob = createClient(port);
    clients.push(alice, charlie, dave, bob);
    await Promise.all([connect(alice), connect(charlie), connect(dave), connect(bob)]);
    await join(alice, 'guardalice');
    await join(charlie, 'guardcharlie');
    await join(dave, 'guarddave');
    await join(bob, 'guardbob');

    const groupPromise = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_CREATE, {
      name: 'Guard Group',
      members: ['guardalice', 'guardcharlie', 'guarddave'],
    });
    const group = await groupPromise;
    const groupId = group.groupId;

    const selfError = waitEvent<{ readonly message: string }>(alice, EVENTS.SERVER.ERROR);
    alice.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'guardalice' });
    expect((await selfError).message).toBe('You cannot vote to kick yourself');

    const creatorError = waitEvent<{ readonly message: string }>(alice, EVENTS.SERVER.ERROR);
    alice.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'guardbob' });
    expect((await creatorError).message).toBe('The group creator cannot be kicked');

    const startedAlice = waitEvent<KickTallyPayload>(alice, EVENTS.SERVER.GROUP_KICK_TALLY);
    const startedCharlie = waitEvent<KickTallyPayload>(charlie, EVENTS.SERVER.GROUP_KICK_TALLY);
    alice.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'guardcharlie' });
    const [started1, started2] = await Promise.all([startedAlice, startedCharlie]);
    expect(started1.status).toBe('active');
    expect(started1.votes).toEqual(['guardalice']);
    expect(started2.votes).toEqual(['guardalice']);

    const busyError = waitEvent<{ readonly message: string }>(alice, EVENTS.SERVER.ERROR);
    alice.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'guarddave' });
    expect((await busyError).message).toBe('A vote is already in progress');

    alice.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'guardcharlie' });
    await delay(200);
    expect(kickVoteStore.getTally(GroupId(groupId))?.votes).toEqual(['guardalice']);
  });

  test('30: join snapshot order is active_groups, users:directory, group:kick:tally', async () => {
    const daveFirst = createClient(port);
    clients.push(daveFirst);
    await connect(daveFirst);
    await join(daveFirst, 'snapdave');
    daveFirst.disconnect();

    const alice = createClient(port);
    const charlie = createClient(port);
    const bob = createClient(port);
    clients.push(alice, charlie, bob);
    await Promise.all([connect(alice), connect(charlie), connect(bob)]);
    await join(alice, 'snapalice');
    await join(charlie, 'snapcharlie');
    await join(bob, 'snapbob');

    const groupPromise = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_CREATE, {
      name: 'Snapshot Group',
      members: ['snapalice', 'snapcharlie', 'snapdave'],
    });
    const group = await groupPromise;
    const groupId = group.groupId;

    const voteAlice = waitEvent<KickTallyPayload>(alice, EVENTS.SERVER.GROUP_KICK_TALLY);
    alice.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username: 'snapcharlie' });
    await voteAlice;

    const dave = createClient(port);
    clients.push(dave);
    await connect(dave);

    const order: string[] = [];
    let receivedTally: KickTallyPayload | undefined;
    const snapshotDone = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('snapshot timeout')), 5000);
      let seen = 0;
      const tick = (): void => {
        seen += 1;
        if (seen === 3) {
          clearTimeout(timer);
          resolve();
        }
      };
      dave.once(EVENTS.SERVER.ACTIVE_GROUPS, () => {
        order.push('active_groups');
        tick();
      });
      dave.once(EVENTS.SERVER.USERS_DIRECTORY, () => {
        order.push('users:directory');
        tick();
      });
      dave.once(EVENTS.SERVER.GROUP_KICK_TALLY, (tally: KickTallyPayload) => {
        receivedTally = tally;
        order.push('group:kick:tally');
        tick();
      });
    });

    dave.emit(EVENTS.CLIENT.USER_JOIN, { username: 'snapdave' });
    await snapshotDone;

    expect(order).toEqual(['active_groups', 'users:directory', 'group:kick:tally']);
    expect(receivedTally?.groupId).toBe(groupId);
    expect(receivedTally?.status).toBe('active');
    expect(receivedTally?.votes).toEqual(['snapalice']);
  });

  test('31: rapid group:member:add emits hit the rate limit', async () => {
    const bob = createClient(port);
    clients.push(bob);
    await connect(bob);
    await join(bob, 'rlbob');

    const groupPromise = waitEvent<GroupInfo>(bob, EVENTS.SERVER.GROUP_CREATED);
    bob.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Rate Group', members: [] });
    const group = await groupPromise;

    const errors: string[] = [];
    bob.on(EVENTS.SERVER.ERROR, (payload: { readonly message: string }) => {
      errors.push(payload.message);
    });
    for (let i = 0; i < 15; i++) {
      bob.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, {
        groupId: group.groupId,
        username: 'rltarget',
      });
    }
    await delay(400);
    expect(errors).toContain('Rate limit exceeded');
  });
});
