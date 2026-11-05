import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';

import type { UserInfo } from './types';
import { CONSTANTS, SocketId, UserId } from './types';
import { UserRegistry } from './user-registry';

describe('UserRegistry', () => {
  let registry: UserRegistry;

  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    registry = new UserRegistry();
  });

  test('addUser creates entry', () => {
    const socketId = SocketId('socket-1');
    const info: UserInfo | undefined = registry.addUser('alice', socketId);

    expect(info).toBeDefined();
    expect(info?.userId).toBe(UserId('alice'));
    expect(info?.username).toBe('alice');
    expect(info?.socketId).toBe(socketId);

    const retrieved: UserInfo | undefined = registry.getUser(UserId('alice'));
    expect(retrieved).toBeDefined();
    expect(retrieved?.userId).toBe(UserId('alice'));
    expect(retrieved?.username).toBe('alice');
    expect(retrieved?.socketId).toBe(socketId);
  });

  test('different userId claiming an existing username is rejected', () => {
    const socketId1 = SocketId('sock-a');
    const socketId2 = SocketId('sock-b');

    const first: UserInfo | undefined = registry.registerSocket(UserId('user-a'), 'bob', socketId1);
    expect(first).toBeDefined();

    const second: UserInfo | undefined = registry.registerSocket(
      UserId('user-b'),
      'bob',
      socketId2,
    );
    expect(second).toBeUndefined();

    expect(registry.size).toBe(1);
  });

  test('same username and userId reattaches the new socket', () => {
    const socketId1 = SocketId('sock-r1');
    const socketId2 = SocketId('sock-r2');

    const first = registry.addUser('bob', socketId1);
    expect(first).toBeDefined();

    const second = registry.addUser('bob', socketId2);
    expect(second).toBeDefined();
    expect(second?.socketId).toBe(socketId2);
    expect(registry.getUserBySocketId(socketId1)).toBeUndefined();
    expect(registry.getUserBySocketId(socketId2)?.socketId).toBe(socketId2);
    expect(registry.size).toBe(1);
  });

  test('reattach cancels a pending removal timer', () => {
    const userId = UserId('frank-reattach');
    const onRemoved = vi.fn<(uid: ReturnType<typeof UserId>, uname: string) => void>();

    registry.onUserRemoved = onRemoved;
    registry.addUser('frank-reattach', SocketId('sock-fr1'));
    registry.markDisconnected(userId);

    const reattached = registry.addUser('frank-reattach', SocketId('sock-fr2'));
    expect(reattached).toBeDefined();

    vi.advanceTimersByTime(CONSTANTS.USER_STALE_TIMEOUT_MS);

    expect(registry.getUser(userId)).toBeDefined();
    expect(registry.size).toBe(1);
    expect(onRemoved).not.toHaveBeenCalled();
  });

  test('removeUser deletes entry', () => {
    const userId = UserId('charlie');
    const socketId = SocketId('sock-c');

    registry.addUser('charlie', socketId);
    expect(registry.size).toBe(1);

    const removed: boolean = registry.removeUser(userId);
    expect(removed).toBe(true);
    expect(registry.getUser(userId)).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  test('removeUser returns false for unknown user', () => {
    const removed: boolean = registry.removeUser(UserId('ghost'));
    expect(removed).toBe(false);
  });

  test('removeUserBySocketId works', () => {
    const userId = UserId('dave');
    const socketId = SocketId('sock-d');

    const added: UserInfo | undefined = registry.addUser('dave', socketId);
    expect(added).toBeDefined();

    const removed: UserInfo | undefined = registry.removeUserBySocketId(socketId);
    expect(removed).toBeDefined();
    expect(removed?.userId).toBe(userId);
    expect(removed?.username).toBe('dave');
    expect(registry.size).toBe(0);
  });

  test('removeUserBySocketId returns undefined for unknown socket', () => {
    const removed: UserInfo | undefined = registry.removeUserBySocketId(SocketId('nonesuch'));
    expect(removed).toBeUndefined();
  });

  test('pending removal after markDisconnected — timer fires and user is removed', () => {
    const userId = UserId('eve');
    const socketId = SocketId('sock-e');
    const onRemoved = vi.fn<(uid: ReturnType<typeof UserId>, uname: string) => void>();

    registry.onUserRemoved = onRemoved;
    registry.addUser('eve', socketId);
    expect(registry.size).toBe(1);

    registry.markDisconnected(userId);
    // User should still be present before timer fires
    expect(registry.getUser(userId)).toBeDefined();
    expect(registry.size).toBe(1);

    vi.advanceTimersByTime(CONSTANTS.USER_STALE_TIMEOUT_MS);

    // After timer fires, user is removed
    expect(registry.getUser(userId)).toBeUndefined();
    expect(registry.size).toBe(0);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(onRemoved).toHaveBeenCalledWith(userId, 'eve');
  });

  test('reconnect before TTL cancels pending removal', () => {
    const userId = UserId('frank');
    const socketId = SocketId('sock-f');
    const onRemoved = vi.fn<(uid: ReturnType<typeof UserId>, uname: string) => void>();

    registry.onUserRemoved = onRemoved;
    registry.addUser('frank', socketId);

    registry.markDisconnected(userId);
    const cancelled: boolean = registry.cancelPendingRemoval(userId);
    expect(cancelled).toBe(true);

    // User still in registry after cancellation
    expect(registry.getUser(userId)).toBeDefined();
    expect(registry.size).toBe(1);

    vi.advanceTimersByTime(CONSTANTS.USER_STALE_TIMEOUT_MS);

    // Timer did NOT fire — user still present, callback not called
    expect(registry.getUser(userId)).toBeDefined();
    expect(registry.size).toBe(1);
    expect(onRemoved).not.toHaveBeenCalled();
  });

  test('cancelPendingRemoval returns false when no timer exists', () => {
    const userId = UserId('nobody');
    const cancelled: boolean = registry.cancelPendingRemoval(userId);
    expect(cancelled).toBe(false);
  });

  test('getAllUsers returns all active users', () => {
    registry.addUser('alice', SocketId('s1'));
    registry.addUser('bob', SocketId('s2'));
    registry.addUser('charlie', SocketId('s3'));

    const all: readonly UserInfo[] = registry.getAllUsers();
    expect(all).toHaveLength(3);

    const usernames = all.map((u) => u.username).sort();
    expect(usernames).toEqual(['alice', 'bob', 'charlie']);
  });

  test('getUserBySocketId finds user', () => {
    const userId = UserId('grace');
    const socketId = SocketId('sock-g');

    registry.addUser('grace', socketId);

    const found: UserInfo | undefined = registry.getUserBySocketId(socketId);
    expect(found).toBeDefined();
    expect(found?.userId).toBe(userId);
    expect(found?.username).toBe('grace');
  });

  test('getUserBySocketId returns undefined for unknown socket', () => {
    const found: UserInfo | undefined = registry.getUserBySocketId(SocketId('ghost-socket'));
    expect(found).toBeUndefined();
  });

  test('destroy clears all pending timers and entries', () => {
    const onRemoved = vi.fn<(uid: ReturnType<typeof UserId>, uname: string) => void>();
    registry.onUserRemoved = onRemoved;

    const userId1 = UserId('heidi');
    const userId2 = UserId('ivan');

    registry.addUser('heidi', SocketId('sock-h'));
    registry.addUser('ivan', SocketId('sock-i'));

    registry.markDisconnected(userId1);
    registry.markDisconnected(userId2);

    expect(registry.size).toBe(2);

    registry.destroy();

    expect(registry.size).toBe(0);

    // Advance time: no timers should fire after destroy
    vi.advanceTimersByTime(CONSTANTS.USER_STALE_TIMEOUT_MS);
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
