import { describe, expect, test } from 'bun:test';
import { RateLimiterRegistry } from './rate-limiter';

describe('RateLimiterRegistry', () => {
  test('consume within capacity returns allowed', () => {
    const limiter = new RateLimiterRegistry(5, 1000);

    for (let i = 0; i < 5; i++) {
      const result = limiter.check('socket-1');
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.remaining).toBe(4 - i);
      }
    }
  });

  test('exceeding capacity returns denied', () => {
    const limiter = new RateLimiterRegistry(5, 1000);

    for (let i = 0; i < 5; i++) {
      limiter.check('socket-1');
    }

    const result = limiter.check('socket-1');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  test('bucket refills after window passes', () => {
    let now = 0;
    const getNow = () => now;
    const limiter = new RateLimiterRegistry(5, 1000, getNow);

    for (let i = 0; i < 5; i++) {
      limiter.check('socket-1');
    }

    now += 1001;

    const result = limiter.check('socket-1');
    expect(result.allowed).toBe(true);
  });

  test('proportional refill — partial window', () => {
    let now = 0;
    const getNow = () => now;
    const limiter = new RateLimiterRegistry(5, 1000, getNow);

    for (let i = 0; i < 5; i++) {
      limiter.check('socket-1');
    }

    now += 500;

    const result1 = limiter.check('socket-1');
    expect(result1.allowed).toBe(true);
    if (result1.allowed) {
      expect(result1.remaining).toBe(1);
    }

    const result2 = limiter.check('socket-1');
    expect(result2.allowed).toBe(true);
    if (result2.allowed) {
      expect(result2.remaining).toBe(0);
    }

    const result3 = limiter.check('socket-1');
    expect(result3.allowed).toBe(false);
  });

  test('remove socket cleans up bucket', () => {
    const limiter = new RateLimiterRegistry(5, 1000);

    limiter.check('socket-1');
    limiter.remove('socket-1');

    const result = limiter.check('socket-1');
    expect(result.allowed).toBe(true);

    for (let i = 0; i < 4; i++) {
      const r = limiter.check('socket-1');
      expect(r.allowed).toBe(true);
    }

    const exceeded = limiter.check('socket-1');
    expect(exceeded.allowed).toBe(false);
  });

  test('destroy clears all buckets', () => {
    const limiter = new RateLimiterRegistry(5, 1000);

    limiter.check('socket-1');
    limiter.check('socket-2');

    expect(limiter.size).toBe(2);

    limiter.destroy();

    expect(limiter.size).toBe(0);
  });
});
