import { describe, expect, test } from 'bun:test';
import { MediaAuth } from './media-auth';
import { CONSTANTS } from './types';

const HEX64 = /^[0-9a-f]{64}$/;

describe('MediaAuth', () => {
  test('issue returns 64 lowercase hex chars', () => {
    const auth = new MediaAuth();
    try {
      const token = auth.issue('alice');
      expect(token).toMatch(HEX64);
      expect(token).toHaveLength(64);
    } finally {
      auth.destroy();
    }
  });

  test('reissue for the same user replaces the previous token', () => {
    const auth = new MediaAuth();
    try {
      const first = auth.issue('alice');
      const second = auth.issue('alice');
      expect(second).not.toBe(first);
      expect(auth.verify(first)).toBeUndefined();
      expect(auth.verify(second)).toEqual({ userId: 'alice' });
    } finally {
      auth.destroy();
    }
  });

  test('verify returns undefined for an unknown token', () => {
    const auth = new MediaAuth();
    try {
      expect(auth.verify('deadbeef')).toBeUndefined();
      expect(auth.verify('')).toBeUndefined();
      auth.issue('alice');
      expect(auth.verify('f'.repeat(64))).toBeUndefined();
    } finally {
      auth.destroy();
    }
  });

  test('expired tokens verify as undefined after the TTL', () => {
    let now = 0;
    const auth = new MediaAuth(CONSTANTS.MEDIA_TOKEN_TTL_MS, () => now);
    try {
      const token = auth.issue('alice');
      expect(auth.verify(token)).toEqual({ userId: 'alice' });

      now = CONSTANTS.MEDIA_TOKEN_TTL_MS - 1;
      expect(auth.verify(token)).toEqual({ userId: 'alice' });

      now = CONSTANTS.MEDIA_TOKEN_TTL_MS;
      expect(auth.verify(token)).toBeUndefined();
      expect(auth.verify(token)).toBeUndefined();
    } finally {
      auth.destroy();
    }
  });

  test('destroy clears outstanding tokens', () => {
    const auth = new MediaAuth();
    const token = auth.issue('alice');
    auth.destroy();
    expect(auth.verify(token)).toBeUndefined();
  });
});
