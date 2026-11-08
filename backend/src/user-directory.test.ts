import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AccountStore } from './account-store';
import { UserDirectory } from './user-directory';

describe('UserDirectory', () => {
  let db: Database;
  let accountStore: AccountStore;
  let directory: UserDirectory;

  function guestJoinedAt(username: string): number | undefined {
    const row = db
      .query('SELECT joined_at FROM guest_directory WHERE username = ?')
      .get(username) as { joined_at: number } | null | undefined;
    return row?.joined_at;
  }

  beforeEach(() => {
    db = new Database(':memory:');
    accountStore = new AccountStore(db);
    directory = new UserDirectory(db);
  });

  afterEach(() => {
    accountStore.destroy();
  });

  test('rememberGuest inserts a guest row', () => {
    directory.rememberGuest('alice');
    expect(directory.resolve('alice')).toEqual({ username: 'alice', userId: 'alice' });
  });

  test('rememberGuest upserts and refreshes joined_at on re-join', () => {
    directory.rememberGuest('alice');
    const first = guestJoinedAt('alice');
    expect(first).toBeDefined();

    directory.rememberGuest('alice');
    const second = guestJoinedAt('alice');
    expect(second).toBeDefined();
    expect(second).toBeGreaterThanOrEqual(first ?? 0);

    const rows = db.query('SELECT COUNT(*) AS n FROM guest_directory').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  test('resolve returns undefined for an unknown username', () => {
    expect(directory.resolve('ghost')).toBeUndefined();
  });

  test('resolve prefers the account identity over the guest row', async () => {
    directory.rememberGuest('carol');
    const created = await accountStore.createAccount('carol', 'password123');
    expect(created.kind).toBe('register_success');
    if (created.kind !== 'register_success') return;

    const resolved = directory.resolve('carol');
    expect(resolved?.userId).toBe(created.userId);
  });

  test('resolve backfills the guest row on an account hit', async () => {
    const created = await accountStore.createAccount('dave', 'password123');
    expect(created.kind).toBe('register_success');

    expect(guestJoinedAt('dave')).toBeUndefined();
    directory.resolve('dave');
    expect(guestJoinedAt('dave')).toBeDefined();
  });

  test('all() unions accounts with guests, dedups, and sorts', async () => {
    directory.rememberGuest('zoe');
    directory.rememberGuest('alice');
    const created = await accountStore.createAccount('bob', 'password123');
    expect(created.kind).toBe('register_success');
    // Same name in both tables — the account row wins, no duplicate entry.
    directory.rememberGuest('bob');

    expect(directory.all()).toEqual(['alice', 'bob', 'zoe']);
  });
});
