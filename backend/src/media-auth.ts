import { CONSTANTS } from './types';

type MediaTokenEntry = { readonly userId: string; readonly expiresAt: number };

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export class MediaAuth {
  readonly #byToken = new Map<string, MediaTokenEntry>();
  readonly #tokenByUser = new Map<string, string>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(ttlMs?: number, now?: () => number) {
    this.#ttlMs = ttlMs ?? CONSTANTS.MEDIA_TOKEN_TTL_MS;
    this.#now = now ?? Date.now;
  }

  issue(userId: string): string {
    const previous = this.#tokenByUser.get(userId);
    if (previous !== undefined) {
      this.#byToken.delete(previous);
      this.#tokenByUser.delete(userId);
    }

    const token = randomToken();
    this.#byToken.set(token, { userId, expiresAt: this.#now() + this.#ttlMs });
    this.#tokenByUser.set(userId, token);
    return token;
  }

  verify(token: string): { userId: string } | undefined {
    const entry = this.#byToken.get(token);
    if (entry === undefined) {
      return undefined;
    }
    if (this.#now() >= entry.expiresAt) {
      this.#byToken.delete(token);
      if (this.#tokenByUser.get(entry.userId) === token) {
        this.#tokenByUser.delete(entry.userId);
      }
      return undefined;
    }
    return { userId: entry.userId };
  }

  destroy(): void {
    this.#byToken.clear();
    this.#tokenByUser.clear();
  }
}
