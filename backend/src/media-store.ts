import { CONSTANTS } from './types';

type MediaEntry = { readonly bytes: Uint8Array; readonly createdAt: number };

type MediaStoreOptions = {
  readonly ttlMs?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxFiles?: number;
  readonly sweepIntervalMs?: number;
  readonly now?: () => number;
};

export class MediaStore {
  readonly #entries = new Map<string, MediaEntry>();
  readonly #ttlMs: number;
  readonly #maxFileBytes: number;
  readonly #maxTotalBytes: number;
  readonly #maxFiles: number;
  readonly #now: () => number;
  #totalBytes = 0;
  #fileCount = 0;
  #sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts?: MediaStoreOptions) {
    this.#ttlMs = opts?.ttlMs ?? CONSTANTS.MEDIA_TTL_MS;
    this.#maxFileBytes = opts?.maxFileBytes ?? CONSTANTS.MAX_MEDIA_BYTES + 16;
    this.#maxTotalBytes = opts?.maxTotalBytes ?? CONSTANTS.MAX_MEDIA_TOTAL_BYTES;
    this.#maxFiles = opts?.maxFiles ?? CONSTANTS.MAX_MEDIA_FILES;
    this.#now = opts?.now ?? Date.now;

    const sweepIntervalMs = opts?.sweepIntervalMs ?? CONSTANTS.MEDIA_SWEEP_INTERVAL_MS;
    if (sweepIntervalMs > 0) {
      this.#sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    }
  }

  // An expired entry counts as absent; drop it and fix the running totals.
  #takeLive(id: string, now: number): MediaEntry | undefined {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      return undefined;
    }
    if (now - entry.createdAt >= this.#ttlMs) {
      this.#entries.delete(id);
      this.#totalBytes -= entry.bytes.length;
      this.#fileCount -= 1;
      return undefined;
    }
    return entry;
  }

  put(id: string, bytes: Uint8Array): 'ok' | 'too_large' | 'quota_exceeded' {
    if (bytes.length > this.#maxFileBytes) {
      return 'too_large';
    }

    const now = this.#now();
    const existing = this.#takeLive(id, now);
    const replacedBytes = existing?.bytes.length ?? 0;
    const replacedCount = existing === undefined ? 0 : 1;

    // Prospective totals first, so a rejected replacement mutates nothing.
    const nextTotal = this.#totalBytes - replacedBytes + bytes.length;
    const nextCount = this.#fileCount - replacedCount + 1;
    if (nextTotal > this.#maxTotalBytes || nextCount > this.#maxFiles) {
      return 'quota_exceeded';
    }

    this.#entries.set(id, { bytes, createdAt: now });
    this.#totalBytes = nextTotal;
    this.#fileCount = nextCount;
    return 'ok';
  }

  get(id: string): Uint8Array | undefined {
    return this.#takeLive(id, this.#now())?.bytes;
  }

  sweep(): number {
    const now = this.#now();
    let removed = 0;
    for (const [id, entry] of this.#entries) {
      if (now - entry.createdAt >= this.#ttlMs) {
        this.#entries.delete(id);
        this.#totalBytes -= entry.bytes.length;
        this.#fileCount -= 1;
        removed += 1;
      }
    }
    return removed;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  get fileCount(): number {
    return this.#fileCount;
  }

  destroy(): void {
    if (this.#sweepTimer !== undefined) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = undefined;
    }
  }
}
