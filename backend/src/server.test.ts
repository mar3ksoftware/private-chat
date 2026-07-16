import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Server as Engine } from '@socket.io/bun-engine';
import pino from 'pino';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';

import { AccountStore } from './account-store';
import { E2eeSession } from './e2ee-session';
import { GroupStore } from './group-store';
import { RateLimiterRegistry } from './rate-limiter';
import { createServer } from './server';
import type {
  ClientToServerEvents,
  E2eePublicKeyPayload,
  E2eePublicKeyRelay,
  GroupInfo,
  GroupMessage,
  PrivateMessage,
  ServerToClientEvents,
  UserInfo,
} from './types';
import { CONSTANTS, EVENTS, UserId } from './types';
import { UserRegistry } from './user-registry';

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

async function connect(client: ReturnType<typeof Client>): Promise<void> {
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

function waitEvent<T>(client: ReturnType<typeof Client>, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event "${event}" timeout`)), 5000);
    client.once(event, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

async function performKeyExchange(
  alice: ReturnType<typeof Client>,
  bob: ReturnType<typeof Client>,
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
  let accountStore: AccountStore;
  let groupStore: GroupStore;
  let bunServer: ReturnType<typeof Bun.serve>;
  let port: number;
  const clients: ReturnType<typeof Client>[] = [];

  beforeAll(() => {
    io = new Server<ClientToServerEvents, ServerToClientEvents>();
    engine = new Engine({ path: '/socket.io/' });
    io.bind(engine);
    userRegistry = new UserRegistry();
    rateLimiters = new RateLimiterRegistry();
    accountStore = new AccountStore(new Database(':memory:'));
    groupStore = new GroupStore();
    createServer(
      io,
      userRegistry,
      rateLimiters,
      accountStore,
      groupStore,
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

  test('1: user joins and receives active_users', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const usersPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    const users = await usersPromise;

    const alice = users.find((u) => u.username === 'alice');
    expect(alice).toBeDefined();
    expect(alice?.userId).toBe(UserId('alice'));
    expect(alice?.username).toBe('alice');
  });

  test('2: message delivered to connected user', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const aliceSession = new E2eeSession();
    const bobSession = new E2eeSession();

    const joinA = waitEvent<readonly UserInfo[]>(clientA, EVENTS.SERVER.ACTIVE_USERS);
    clientA.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    await joinA;

    const joinB = waitEvent<readonly UserInfo[]>(clientB, EVENTS.SERVER.ACTIVE_USERS);
    clientB.emit(EVENTS.CLIENT.USER_JOIN, 'bob');
    await joinB;

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
    const decrypted = await bobSession.decrypt('alice', msg.ciphertext, msg.iv);
    expect(decrypted).toBe('hello bob');
  });

  test('3: delivery_failed for unknown user', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    await joinPromise;

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
  });

  test('4: empty ciphertext rejected', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    await joinPromise;

    const rejectPromise = waitEvent<readonly string[]>(client, EVENTS.SERVER.MESSAGE_REJECTED);
    client.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: 'bob', ciphertext: '', iv: 'dummy' });
    const errors = await rejectPromise;

    expect(errors.length).toBeGreaterThan(0);
  });

  test('5: empty iv rejected', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    await joinPromise;

    const rejectPromise = waitEvent<readonly string[]>(client, EVENTS.SERVER.MESSAGE_REJECTED);
    client.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: 'bob', ciphertext: 'x', iv: '' });
    const errors = await rejectPromise;

    expect(errors.length).toBeGreaterThan(0);
  });

  test('6: rate limit exceeded', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    await joinPromise;

    // Send 10 messages (within limit)
    for (let i = 0; i < CONSTANTS.RATE_LIMIT_MAX; i++) {
      client.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: 'bob', ciphertext: 'x', iv: 'y' });
    }

    // The 11th should be rejected
    const rejectPromise = waitEvent<readonly string[]>(client, EVENTS.SERVER.MESSAGE_REJECTED);
    client.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: 'bob', ciphertext: 'x', iv: 'y' });
    const errors = await rejectPromise;

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Rate limit');
  });

  test('7: user disconnects and other user receives user:left', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const joinA = waitEvent<readonly UserInfo[]>(clientA, EVENTS.SERVER.ACTIVE_USERS);
    clientA.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    await joinA;

    const joinB = waitEvent<readonly UserInfo[]>(clientB, EVENTS.SERVER.ACTIVE_USERS);
    clientB.emit(EVENTS.CLIENT.USER_JOIN, 'bob');
    await joinB;

    // Set up listener before disconnecting
    const leftPromise = waitEvent<string>(clientA, EVENTS.SERVER.USER_LEFT);
    clientB.disconnect();

    const leftUserId = await leftPromise;
    expect(leftUserId).toBe('bob');
  });

  test('8: message to disconnected user returns delivery_failed', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const joinA = waitEvent<readonly UserInfo[]>(clientA, EVENTS.SERVER.ACTIVE_USERS);
    clientA.emit(EVENTS.CLIENT.USER_JOIN, 'alice');
    await joinA;

    const joinB = waitEvent<readonly UserInfo[]>(clientB, EVENTS.SERVER.ACTIVE_USERS);
    clientB.emit(EVENTS.CLIENT.USER_JOIN, 'bob');
    await joinB;

    // Force transport close to simulate unannounced disconnect (not explicit client.disconnect())
    clientB.io.engine.close();

    // Wait a tick for the disconnect to propagate
    await new Promise((r) => setTimeout(r, 100));

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
  });

  test('9: e2ee public key relay', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const joinA = waitEvent<readonly UserInfo[]>(clientA, EVENTS.SERVER.ACTIVE_USERS);
    clientA.emit(EVENTS.CLIENT.USER_JOIN, 'alice9');
    await joinA;

    const joinB = waitEvent<readonly UserInfo[]>(clientB, EVENTS.SERVER.ACTIVE_USERS);
    clientB.emit(EVENTS.CLIENT.USER_JOIN, 'bob9');
    await joinB;

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

    const joinA = waitEvent<readonly UserInfo[]>(clientA, EVENTS.SERVER.ACTIVE_USERS);
    clientA.emit(EVENTS.CLIENT.USER_JOIN, 'alice10');
    await joinA;

    const joinB = waitEvent<readonly UserInfo[]>(clientB, EVENTS.SERVER.ACTIVE_USERS);
    clientB.emit(EVENTS.CLIENT.USER_JOIN, 'bob10');
    await joinB;

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

    const joinA = waitEvent<readonly UserInfo[]>(clientA, EVENTS.SERVER.ACTIVE_USERS);
    clientA.emit(EVENTS.CLIENT.USER_JOIN, 'alice11');
    await joinA;

    const joinB = waitEvent<readonly UserInfo[]>(clientB, EVENTS.SERVER.ACTIVE_USERS);
    clientB.emit(EVENTS.CLIENT.USER_JOIN, 'bob11');
    await joinB;

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

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'gcreator');
    await joinPromise;

    const groupPromise = waitEvent<GroupInfo>(client, EVENTS.SERVER.GROUP_CREATED);
    client.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Test Group', members: [] });
    const group = await groupPromise;

    expect(group.name).toBe('Test Group');
    expect(group.members.length).toBe(1);
    expect(group.members[0].username).toBe('gcreator');
    expect(group.members[0].isAdmin).toBe(true);
  });

  test('13: group:create with empty name emits error', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'gcreator2');
    await joinPromise;

    const errorPromise = waitEvent<string>(client, EVENTS.SERVER.GROUP_CREATED_ERROR);
    client.emit(EVENTS.CLIENT.GROUP_CREATE, { name: '', members: [] });
    const error = await errorPromise;

    expect(error.length).toBeGreaterThan(0);
  });

  test('14: group:message:send delivers to group members', async () => {
    const clientA = createClient(port);
    const clientB = createClient(port);
    clients.push(clientA, clientB);
    await Promise.all([connect(clientA), connect(clientB)]);

    const joinA = waitEvent<readonly UserInfo[]>(clientA, EVENTS.SERVER.ACTIVE_USERS);
    clientA.emit(EVENTS.CLIENT.USER_JOIN, 'gsender');
    await joinA;

    const joinB = waitEvent<readonly UserInfo[]>(clientB, EVENTS.SERVER.ACTIVE_USERS);
    clientB.emit(EVENTS.CLIENT.USER_JOIN, 'gmember');
    await joinB;

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
    expect(msg.ciphertexts[0].ciphertext).toBe('encrypted1');
  });

  test('15: group:message:send from non-member emits delivery_failed', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'outsider');
    await joinPromise;

    const failPromise = waitEvent<string>(client, EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED);
    client.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, {
      groupId: 'nonexistent-group',
      ciphertexts: [{ to: 'someone', ciphertext: 'enc', iv: 'iv' }],
    });
    const error = await failPromise;

    expect(error.length).toBeGreaterThan(0);
  });

  test('16: group:create with invalid name emits error', async () => {
    const client = createClient(port);
    clients.push(client);
    await connect(client);

    const joinPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
    client.emit(EVENTS.CLIENT.USER_JOIN, 'gcreator3');
    await joinPromise;

    const errorPromise = waitEvent<string>(client, EVENTS.SERVER.GROUP_CREATED_ERROR);
    client.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'a'.repeat(51), members: [] });
    const error = await errorPromise;

    expect(error.length).toBeGreaterThan(0);
  });
});
