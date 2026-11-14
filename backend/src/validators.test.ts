import { describe, expect, test } from 'bun:test';
import type { ValidationResult } from './types';
import {
  validateGroupCreatePayload,
  validateGroupMessagePayload,
  validateGroupTargetPayload,
  validateMessageDeletePayload,
  validateMessageEditPayload,
  validateMessagePayload,
  validateMessageReactPayload,
  validateProfileUpdatePayload,
  validateReceiptReadPayload,
  validateTypingSendPayload,
  validateUserJoinPayload,
  validateUsername,
} from './validators';

// Sender-generated UUIDv4, required on both send events since Tier 1.
const MESSAGE_ID = '3f2bc19d-58ac-4b2d-9f15-1a4e93a3b7c4';
const GROUP_MESSAGE_ID = '9d4e6f12-3c5b-4a8e-9f70-2b6d1c8e5a31';

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
      id: MESSAGE_ID,
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
    const result = validateMessagePayload({
      id: MESSAGE_ID,
      to: 'bob',
      ciphertext: '',
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test('ciphertext exceeding 30000 chars fails', () => {
    const result = validateMessagePayload({
      id: MESSAGE_ID,
      to: 'bob',
      ciphertext: 'x'.repeat(30_001),
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
  });

  test('large ciphertext of 20000 chars passes', () => {
    const result = validateMessagePayload({
      id: MESSAGE_ID,
      to: 'bob',
      ciphertext: 'x'.repeat(20_000),
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(true);
  });

  test('nested object as ciphertext fails', () => {
    const result = validateMessagePayload({
      id: MESSAGE_ID,
      to: 'bob',
      ciphertext: { foo: 'bar' },
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
  });

  test('array as ciphertext fails', () => {
    const result = validateMessagePayload({
      id: MESSAGE_ID,
      to: 'bob',
      ciphertext: ['hello'],
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
  });

  test("malformed payload — missing 'to' field fails", () => {
    const result = validateMessagePayload({ id: MESSAGE_ID, ciphertext: 'hello', iv: 'aGVsbG8=' });
    expect(result.success).toBe(false);
  });

  test('malformed payload — extra unknown field fails', () => {
    const result = validateMessagePayload({
      id: MESSAGE_ID,
      to: 'bob',
      ciphertext: 'ok',
      iv: 'aGVsbG8=',
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  test('missing ciphertext field fails', () => {
    const result = validateMessagePayload({ id: MESSAGE_ID, to: 'bob', iv: 'aGVsbG8=' });
    expect(result.success).toBe(false);
  });

  test('missing iv field fails', () => {
    const result = validateMessagePayload({ id: MESSAGE_ID, to: 'bob', ciphertext: 'ok' });
    expect(result.success).toBe(false);
  });

  test('missing id fails', () => {
    const result = validateMessagePayload({ to: 'bob', ciphertext: 'ok', iv: 'aGVsbG8=' });
    expect(result.success).toBe(false);
  });

  test('non-UUID id fails', () => {
    const result = validateMessagePayload({
      id: 'not-a-uuid',
      to: 'bob',
      ciphertext: 'ok',
      iv: 'aGVsbG8=',
    });
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
      id: GROUP_MESSAGE_ID,
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
      id: GROUP_MESSAGE_ID,
      groupId: '',
      ciphertexts: [{ to: 'alice', ciphertext: 'enc', iv: 'iv123' }],
    });
    expect(result.success).toBe(false);
  });

  test('empty ciphertexts array fails', () => {
    const result = validateGroupMessagePayload({
      id: GROUP_MESSAGE_ID,
      groupId: 'abc',
      ciphertexts: [],
    });
    expect(result.success).toBe(false);
  });

  test('missing ciphertext field fails', () => {
    const result = validateGroupMessagePayload({
      id: GROUP_MESSAGE_ID,
      groupId: 'abc',
      ciphertexts: [{ to: 'alice', iv: 'iv' }],
    });
    expect(result.success).toBe(false);
  });

  test('missing groupId fails', () => {
    const result = validateGroupMessagePayload({
      id: GROUP_MESSAGE_ID,
      ciphertexts: [{ to: 'alice', ciphertext: 'enc', iv: 'iv' }],
    });
    expect(result.success).toBe(false);
  });

  test('extra field in ciphertext entry fails', () => {
    const result = validateGroupMessagePayload({
      id: GROUP_MESSAGE_ID,
      groupId: 'abc',
      ciphertexts: [{ to: 'alice', ciphertext: 'enc', iv: 'iv', extra: true }],
    });
    expect(result.success).toBe(false);
  });
});

describe('validateGroupTargetPayload', () => {
  test('valid payload passes', () => {
    const result = validateGroupTargetPayload({ groupId: 'abc-123', username: 'alice' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupId).toBe('abc-123');
      expect(result.data.username).toBe('alice');
    }
  });

  test('extra field fails', () => {
    const result = validateGroupTargetPayload({
      groupId: 'abc-123',
      username: 'alice',
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  test('username with bad chars fails', () => {
    const result = validateGroupTargetPayload({ groupId: 'abc-123', username: 'bad name!' });
    expect(result.success).toBe(false);
  });

  test('empty groupId fails', () => {
    const result = validateGroupTargetPayload({ groupId: '', username: 'alice' });
    expect(result.success).toBe(false);
  });
});

describe('validateTypingSendPayload', () => {
  test('DM payload passes', () => {
    const result = validateTypingSendPayload({ to: 'bob', active: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.to).toBe('bob');
      expect(result.data.active).toBe(true);
    }
  });

  test('group payload passes', () => {
    const result = validateTypingSendPayload({ groupId: 'group-1', active: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupId).toBe('group-1');
      expect(result.data.active).toBe(false);
    }
  });

  test('both targets fails', () => {
    const result = validateTypingSendPayload({ to: 'bob', groupId: 'group-1', active: true });
    expect(result.success).toBe(false);
  });

  test('neither target fails', () => {
    const result = validateTypingSendPayload({ active: true });
    expect(result.success).toBe(false);
  });

  test('non-boolean active fails', () => {
    const result = validateTypingSendPayload({ to: 'bob', active: 'yes' });
    expect(result.success).toBe(false);
  });
});

describe('validateReceiptReadPayload', () => {
  test('valid receipt passes', () => {
    const result = validateReceiptReadPayload({ to: 'bob', upTo: Date.now() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.to).toBe('bob');
    }
  });

  test('upTo beyond the future bound fails', () => {
    const result = validateReceiptReadPayload({ to: 'bob', upTo: Date.now() + 120_000 });
    expect(result.success).toBe(false);
  });

  test('groupId alongside to fails (receipts are DM-only)', () => {
    const result = validateReceiptReadPayload({
      to: 'bob',
      upTo: Date.now(),
      groupId: 'group-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('validateMessageReactPayload', () => {
  const TARGET_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  test('valid react passes', () => {
    const result = validateMessageReactPayload({
      to: 'bob',
      targetId: TARGET_ID,
      emoji: '👍',
      active: true,
    });
    expect(result.success).toBe(true);
  });

  test('empty emoji fails', () => {
    const result = validateMessageReactPayload({
      to: 'bob',
      targetId: TARGET_ID,
      emoji: '',
      active: true,
    });
    expect(result.success).toBe(false);
  });

  test('emoji longer than 16 UTF-16 units fails', () => {
    const result = validateMessageReactPayload({
      to: 'bob',
      targetId: TARGET_ID,
      emoji: 'x'.repeat(17),
      active: true,
    });
    expect(result.success).toBe(false);
  });

  test('emoji with whitespace fails', () => {
    const result = validateMessageReactPayload({
      to: 'bob',
      targetId: TARGET_ID,
      emoji: '👍 👍',
      active: true,
    });
    expect(result.success).toBe(false);
  });

  test('non-UUID targetId fails', () => {
    const result = validateMessageReactPayload({
      to: 'bob',
      targetId: 'not-a-uuid',
      emoji: '👍',
      active: true,
    });
    expect(result.success).toBe(false);
  });

  test('both targets fails', () => {
    const result = validateMessageReactPayload({
      to: 'bob',
      groupId: 'group-1',
      targetId: TARGET_ID,
      emoji: '👍',
      active: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('validateMessageEditPayload', () => {
  const TARGET_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  test('valid edit passes', () => {
    const result = validateMessageEditPayload({
      to: 'bob',
      targetId: TARGET_ID,
      ciphertext: 'fresh-ciphertext',
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(true);
  });

  test('ciphertext exceeding 30000 chars fails', () => {
    const result = validateMessageEditPayload({
      to: 'bob',
      targetId: TARGET_ID,
      ciphertext: 'x'.repeat(30_001),
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
  });

  test('iv exceeding 64 chars fails', () => {
    const result = validateMessageEditPayload({
      groupId: 'group-1',
      targetId: TARGET_ID,
      ciphertext: 'fresh-ciphertext',
      iv: 'x'.repeat(65),
    });
    expect(result.success).toBe(false);
  });

  test('non-UUID targetId fails', () => {
    const result = validateMessageEditPayload({
      to: 'bob',
      targetId: 'nope',
      ciphertext: 'fresh-ciphertext',
      iv: 'aGVsbG8=',
    });
    expect(result.success).toBe(false);
  });
});

describe('validateMessageDeletePayload', () => {
  test('valid delete passes', () => {
    const result = validateMessageDeletePayload({
      groupId: 'group-1',
      targetId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    });
    expect(result.success).toBe(true);
  });

  test('non-UUID targetId fails', () => {
    const result = validateMessageDeletePayload({ to: 'bob', targetId: 'nope' });
    expect(result.success).toBe(false);
  });

  test('both targets fails', () => {
    const result = validateMessageDeletePayload({
      to: 'bob',
      groupId: 'group-1',
      targetId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    });
    expect(result.success).toBe(false);
  });
});

describe('validateProfileUpdatePayload', () => {
  // BEL (0x07) is a Cc control character: it must be rejected in both fields.
  const BEL = String.fromCharCode(7);

  test('profile with trimmed fields passes', () => {
    const result = validateProfileUpdatePayload({ displayName: '  Alice  ', status: '  away  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('Alice');
      expect(result.data.status).toBe('away');
    }
  });

  test('displayName of 1 char passes', () => {
    const result = validateProfileUpdatePayload({ displayName: 'A', status: '' });
    expect(result.success).toBe(true);
  });

  test('displayName of 32 chars passes', () => {
    const result = validateProfileUpdatePayload({ displayName: 'x'.repeat(32), status: '' });
    expect(result.success).toBe(true);
  });

  test('displayName of 33 chars fails', () => {
    const result = validateProfileUpdatePayload({ displayName: 'x'.repeat(33), status: '' });
    expect(result.success).toBe(false);
  });

  test('empty displayName fails', () => {
    const result = validateProfileUpdatePayload({ displayName: '   ', status: '' });
    expect(result.success).toBe(false);
  });

  test('control char in displayName fails', () => {
    const result = validateProfileUpdatePayload({ displayName: `Al${BEL}ice`, status: '' });
    expect(result.success).toBe(false);
  });

  test('status of 80 chars passes', () => {
    const result = validateProfileUpdatePayload({ displayName: 'Alice', status: 'x'.repeat(80) });
    expect(result.success).toBe(true);
  });

  test('status of 81 chars fails', () => {
    const result = validateProfileUpdatePayload({ displayName: 'Alice', status: 'x'.repeat(81) });
    expect(result.success).toBe(false);
  });

  test('control char in status fails', () => {
    const result = validateProfileUpdatePayload({ displayName: 'Alice', status: `ok${BEL}no` });
    expect(result.success).toBe(false);
  });
});
