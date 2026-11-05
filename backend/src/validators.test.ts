import { describe, expect, test } from 'bun:test';
import type { ValidationResult } from './types';
import {
  validateGroupCreatePayload,
  validateGroupMessagePayload,
  validateMessagePayload,
  validateUserJoinPayload,
  validateUsername,
} from './validators';

describe('validateUsername', () => {
  test('valid username passes', () => {
    const result: ValidationResult<string> = validateUsername('alice');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('alice');
    }
  });

  test('empty username fails', () => {
    const result = validateUsername('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test('username with spaces fails', () => {
    const result = validateUsername('hello world');
    expect(result.success).toBe(false);
  });

  test('username with special chars fails', () => {
    const result = validateUsername('bob@evil');
    expect(result.success).toBe(false);
  });

  test('username too long fails', () => {
    const result = validateUsername('a'.repeat(31));
    expect(result.success).toBe(false);
  });
});

describe('validateUserJoinPayload', () => {
  test('object username payload passes', () => {
    const result = validateUserJoinPayload({ username: 'alice' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('alice');
    }
  });

  test('bare string username fails', () => {
    const result = validateUserJoinPayload('alice');
    expect(result.success).toBe(false);
  });
});

describe('validateMessagePayload', () => {
  test('valid message payload passes', () => {
    const result = validateMessagePayload({
      to: 'bob',
      ciphertext: 'encrypted-data',
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.to).toBe('bob');
      expect(result.data.ciphertext).toBe('encrypted-data');
      expect(result.data.iv).toBe('aGVsbG8=');
    }
  });

  test('empty ciphertext fails', () => {
    const result = validateMessagePayload({ to: 'bob', ciphertext: '', iv: 'aGVsbG8=' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test('ciphertext exceeding 30000 chars fails', () => {
    const result = validateMessagePayload({
      to: 'bob',
      ciphertext: 'x'.repeat(30_001),
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
  });

  test('large ciphertext of 20000 chars passes', () => {
    const result = validateMessagePayload({
      to: 'bob',
      ciphertext: 'x'.repeat(20_000),
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(true);
  });

  test('nested object as ciphertext fails', () => {
    const result = validateMessagePayload({
      to: 'bob',
      ciphertext: { foo: 'bar' },
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
  });

  test('array as ciphertext fails', () => {
    const result = validateMessagePayload({ to: 'bob', ciphertext: ['hello'], iv: 'aGVsbG8=' });
    expect(result.success).toBe(false);
  });

  test("malformed payload — missing 'to' field fails", () => {
    const result = validateMessagePayload({ ciphertext: 'hello', iv: 'aGVsbG8=' });
    expect(result.success).toBe(false);
  });

  test('malformed payload — extra unknown field fails', () => {
    const result = validateMessagePayload({
      to: 'bob',
      ciphertext: 'ok',
      iv: 'aGVsbG8=',
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  test('missing ciphertext field fails', () => {
    const result = validateMessagePayload({ to: 'bob', iv: 'aGVsbG8=' });
    expect(result.success).toBe(false);
  });

  test('missing iv field fails', () => {
    const result = validateMessagePayload({ to: 'bob', ciphertext: 'ok' });
    expect(result.success).toBe(false);
  });
});

describe('validateGroupCreatePayload', () => {
  test('valid payload passes', () => {
    const result = validateGroupCreatePayload({ name: 'My Group', members: ['alice', 'bob'] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Group');
      expect(result.data.members).toEqual(['alice', 'bob']);
    }
  });

  test('empty name fails', () => {
    const result = validateGroupCreatePayload({ name: '', members: ['alice'] });
    expect(result.success).toBe(false);
  });

  test('name exceeding 50 chars fails', () => {
    const result = validateGroupCreatePayload({ name: 'x'.repeat(51), members: ['alice'] });
    expect(result.success).toBe(false);
  });

  test('empty members array passes', () => {
    const result = validateGroupCreatePayload({ name: 'Group', members: [] });
    expect(result.success).toBe(true);
  });

  test('missing name fails', () => {
    const result = validateGroupCreatePayload({ members: ['alice'] });
    expect(result.success).toBe(false);
  });

  test('missing members fails', () => {
    const result = validateGroupCreatePayload({ name: 'Group' });
    expect(result.success).toBe(false);
  });

  test('extra field fails', () => {
    const result = validateGroupCreatePayload({
      name: 'Group',
      members: ['alice'],
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('validateGroupMessagePayload', () => {
  test('valid payload passes', () => {
    const result = validateGroupMessagePayload({
      groupId: 'abc-123',
      ciphertexts: [{ to: 'alice', ciphertext: 'enc', iv: 'iv123' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupId).toBe('abc-123');
      expect(result.data.ciphertexts.length).toBe(1);
    }
  });

  test('empty groupId fails', () => {
    const result = validateGroupMessagePayload({
      groupId: '',
      ciphertexts: [{ to: 'alice', ciphertext: 'enc', iv: 'iv123' }],
    });
    expect(result.success).toBe(false);
  });

  test('empty ciphertexts array fails', () => {
    const result = validateGroupMessagePayload({
      groupId: 'abc',
      ciphertexts: [],
    });
    expect(result.success).toBe(false);
  });

  test('missing ciphertext field fails', () => {
    const result = validateGroupMessagePayload({
      groupId: 'abc',
      ciphertexts: [{ to: 'alice', iv: 'iv' }],
    });
    expect(result.success).toBe(false);
  });

  test('missing groupId fails', () => {
    const result = validateGroupMessagePayload({
      ciphertexts: [{ to: 'alice', ciphertext: 'enc', iv: 'iv' }],
    });
    expect(result.success).toBe(false);
  });

  test('extra field in ciphertext entry fails', () => {
    const result = validateGroupMessagePayload({
      groupId: 'abc',
      ciphertexts: [{ to: 'alice', ciphertext: 'enc', iv: 'iv', extra: true }],
    });
    expect(result.success).toBe(false);
  });
});
