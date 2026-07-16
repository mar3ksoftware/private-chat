import { CONSTANTS, type RateLimitResult } from './types';

type TokenBucket = { tokens: number; lastRefill: number };

export class RateLimiterRegistry {
  readonly #buckets: Map<string, TokenBucket>;
  readonly #capacity: number;
  readonly #windowMs: number;
  readonly #getNow: () => number;

  constructor(
    capacity: number = CONSTANTS.RATE_LIMIT_MAX,
    windowMs: number = CONSTANTS.RATE_LIMIT_WINDOW_MS,
    getNow: () => number = Date.now,
  ) {
    this.#buckets = new Map();
    this.#capacity = capacity;
    this.#windowMs = windowMs;
    this.#getNow = getNow;
  }

  check(socketId: string): RateLimitResult {
    const now = this.#getNow();
    let bucket = this.#buckets.get(socketId);

    if (bucket === undefined) {
      bucket = { tokens: this.#capacity, lastRefill: now };
      this.#buckets.set(socketId, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / this.#windowMs) * this.#capacity;
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + refillAmount);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      return {
        allowed: false,
        retryAfterMs: Math.ceil((1 - bucket.tokens) * (this.#windowMs / this.#capacity)),
      };
    }

    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }

  remove(socketId: string): void {
    this.#buckets.delete(socketId);
  }

  destroy(): void {
    this.#buckets.clear();
  }

  get size(): number {
    return this.#buckets.size;
  }
}
