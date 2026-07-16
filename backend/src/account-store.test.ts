import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AccountStore } from './account-store';

describe('AccountStore', () => {
  let store: AccountStore;

  beforeAll(() => {
    store = new AccountStore(new Database(':memory:'));
  });

  afterAll(() => {
    store.destroy();
  });

  test('createAccount returns success', async () => {
    const result = await store.createAccount('alice', 'secret123');

    expect(result.kind).toBe('register_success');
    if (result.kind === 'register_success') {
      expect(result.username).toBe('alice');
    }
  });

  test('createAccount rejects duplicate username', async () => {
    const first = await store.createAccount('bob', 'pass1');

    expect(first.kind).toBe('register_success');
    if (first.kind !== 'register_success') {
      throw new Error('Expected register_success');
    }

    const second = await store.createAccount('bob', 'pass2');

    expect(second.kind).toBe('register_error');
    if (second.kind === 'register_error') {
      expect(second.reason).toBe('username_taken');
    }
  });

  test('authenticate succeeds with correct password', async () => {
    const reg = await store.createAccount('charlie', 'pass1');

    expect(reg.kind).toBe('register_success');

    const result = await store.authenticate('charlie', 'pass1');

    expect(result.kind).toBe('login_success');
    if (result.kind === 'login_success') {
      expect(result.username).toBe('charlie');
    }
  });

  test('authenticate fails with wrong password', async () => {
    const reg = await store.createAccount('dave', 'right');

    expect(reg.kind).toBe('register_success');

    const result = await store.authenticate('dave', 'wrong');

    expect(result.kind).toBe('login_error');
    if (result.kind === 'login_error') {
      expect(result.reason).toBe('invalid_credentials');
    }
  });

  test('authenticate fails for unknown user', async () => {
    const result = await store.authenticate('ghost', 'anything');

    expect(result.kind).toBe('login_error');
    if (result.kind === 'login_error') {
      expect(result.reason).toBe('invalid_credentials');
    }
  });

  test('createAccount with PIN succeeds', async () => {
    const result = await store.createAccount('eve', 'pass', '1234');

    expect(result.kind).toBe('register_success');
    if (result.kind === 'register_success') {
      expect(result.username).toBe('eve');
    }
  });

  test('authenticate with correct PIN succeeds', async () => {
    const reg = await store.createAccount('frank', 'pass', '5678');

    expect(reg.kind).toBe('register_success');

    const result = await store.authenticate('frank', 'pass', '5678');

    expect(result.kind).toBe('login_success');
    if (result.kind === 'login_success') {
      expect(result.username).toBe('frank');
    }
  });

  test('authenticate with wrong PIN fails', async () => {
    const reg = await store.createAccount('grace', 'pass', '9999');

    expect(reg.kind).toBe('register_success');

    const result = await store.authenticate('grace', 'pass', '0000');

    expect(result.kind).toBe('login_error');
    if (result.kind === 'login_error') {
      expect(result.reason).toBe('pin_invalid');
    }
  });

  test('authenticate without PIN when account has PIN fails', async () => {
    const reg = await store.createAccount('heidi', 'pass', '1111');

    expect(reg.kind).toBe('register_success');

    const result = await store.authenticate('heidi', 'pass');

    expect(result.kind).toBe('login_error');
    if (result.kind === 'login_error') {
      expect(result.reason).toBe('pin_required');
    }
  });

  test('usernameExists returns true for existing user', async () => {
    const reg = await store.createAccount('ivan', 'pass');

    expect(reg.kind).toBe('register_success');

    expect(store.usernameExists('ivan')).toBe(true);
  });

  test('usernameExists returns false for unknown user', () => {
    expect(store.usernameExists('nobody')).toBe(false);
  });

  test('destroy closes database', async () => {
    const testDb = new Database(':memory:');
    const testStore = new AccountStore(testDb);

    const reg = await testStore.createAccount('testuser', 'testpass');

    expect(reg.kind).toBe('register_success');

    testStore.destroy();

    expect(() => {
      testDb.query('SELECT 1').all();
    }).toThrow();
  });
});
