import { describe, expect, test } from 'bun:test';
import { KickVoteStore } from './kick-vote-store';
import type { KickTallyPayload } from './types';
import { GroupId } from './types';

const GROUP_A = GroupId('group-a');
const GROUP_B = GroupId('group-b');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('KickVoteStore', () => {
  test('start computes required = floor(N/2) + 1', () => {
    const store = new KickVoteStore(60_000, () => 1000);
    try {
      expect(store.start(GROUP_A, 'target', 3, 'voter').required).toBe(2);
      store.cancel(GROUP_A);
      expect(store.start(GROUP_A, 'target', 4, 'voter').required).toBe(3);
      store.cancel(GROUP_A);
      expect(store.start(GROUP_A, 'target', 5, 'voter').required).toBe(3);
      store.cancel(GROUP_A);
      expect(store.start(GROUP_A, 'target', 2, 'voter').required).toBe(2);
    } finally {
      store.destroy();
    }
  });

  test('expiresAt is fixed from getNow + ttl', () => {
    const store = new KickVoteStore(60_000, () => 1000);
    try {
      const tally = store.start(GROUP_A, 'target', 3, 'voter');
      expect(tally.expiresAt).toBe(61_000);
      expect(tally.status).toBe('active');
    } finally {
      store.destroy();
    }
  });

  test('addVoter appends voters in vote order', () => {
    const store = new KickVoteStore(60_000, () => 1000);
    try {
      store.start(GROUP_A, 'target', 5, 'alice');
      store.addVoter(GROUP_A, 'bob');
      store.addVoter(GROUP_A, 'carol');
      const tally = store.getTally(GROUP_A);
      expect(tally?.votes).toEqual(['alice', 'bob', 'carol']);
    } finally {
      store.destroy();
    }
  });

  test('one vote per group: a second start replaces the first', () => {
    const store = new KickVoteStore(60_000, () => 1000);
    try {
      store.start(GROUP_A, 'first', 3, 'alice');
      store.start(GROUP_A, 'second', 3, 'alice');
      const tally = store.getTally(GROUP_A);
      expect(tally?.username).toBe('second');
      expect(store.activeTallies()).toHaveLength(1);
    } finally {
      store.destroy();
    }
  });

  test('dropVoter prunes the vote and reports whether it changed', () => {
    const store = new KickVoteStore(60_000, () => 1000);
    try {
      store.start(GROUP_A, 'target', 5, 'alice');
      store.addVoter(GROUP_A, 'bob');
      expect(store.dropVoter(GROUP_A, 'bob')).toBe(true);
      expect(store.getTally(GROUP_A)?.votes).toEqual(['alice']);
      expect(store.dropVoter(GROUP_A, 'bob')).toBe(false);
      expect(store.dropVoter(GROUP_B, 'bob')).toBe(false);
    } finally {
      store.destroy();
    }
  });

  test('cancel clears the timer so onExpired never fires', async () => {
    const store = new KickVoteStore(20);
    const expired: KickTallyPayload[] = [];
    store.onExpired = (groupId, target, tally) => {
      expired.push({ ...tally, groupId, username: target });
    };
    store.start(GROUP_A, 'target', 3, 'alice');
    expect(store.cancel(GROUP_A)).toBe(true);
    await delay(60);
    expect(expired).toHaveLength(0);
    expect(store.getTally(GROUP_A)).toBeUndefined();
    store.destroy();
  });

  test('expiry fires onExpired exactly once and removes the vote', async () => {
    const store = new KickVoteStore(20);
    const calls: { groupId: GroupId; target: string; tally: KickTallyPayload }[] = [];
    store.onExpired = (groupId, target, tally) => {
      calls.push({ groupId, target, tally });
    };
    store.start(GROUP_A, 'target', 3, 'alice');
    await delay(60);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.groupId).toBe(GROUP_A);
    expect(calls[0]?.target).toBe('target');
    expect(calls[0]?.tally.status).toBe('active');
    expect(calls[0]?.tally.votes).toEqual(['alice']);
    expect(store.getTally(GROUP_A)).toBeUndefined();
    expect(store.activeTallies()).toHaveLength(0);
    await delay(40);
    expect(calls).toHaveLength(1);
    store.destroy();
  });

  test('destroy clears timers and live votes', async () => {
    const store = new KickVoteStore(20);
    let fired = 0;
    store.onExpired = () => {
      fired += 1;
    };
    store.start(GROUP_A, 'target', 3, 'alice');
    store.start(GROUP_B, 'target', 3, 'alice');
    store.destroy();
    expect(store.activeTallies()).toHaveLength(0);
    await delay(60);
    expect(fired).toBe(0);
  });

  test('activeTallies reflects only live votes', () => {
    const store = new KickVoteStore(60_000, () => 1000);
    try {
      store.start(GROUP_A, 'target-a', 3, 'alice');
      store.start(GROUP_B, 'target-b', 4, 'alice');
      expect(
        store
          .activeTallies()
          .map((t) => t.groupId)
          .sort(),
      ).toEqual([String(GROUP_A), String(GROUP_B)]);
      store.cancel(GROUP_B);
      expect(store.activeTallies().map((t) => t.groupId)).toEqual([String(GROUP_A)]);
    } finally {
      store.destroy();
    }
  });
});
