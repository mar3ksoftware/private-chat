import type { Database } from 'bun:sqlite';
import type { LoginResult, PasswordHash, PinHash, RegisterResult } from './types.js';
import { UserId } from './types.js';

// ── AccountStore ──────────────────────────────────────────────────────

export class AccountStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        user_id       TEXT PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        pin_hash      TEXT,
        created_at    INTEGER NOT NULL
      );
    `);
  }

  async createAccount(username: string, password: string, pin?: string): Promise<RegisterResult> {
    if (this.usernameExists(username)) {
      return { kind: 'register_error', reason: 'username_taken' };
    }

    const passwordHash = (await Bun.password.hash(password, {
      algorithm: 'bcrypt',
      cost: 10,
    })) as PasswordHash;

    const pinHash =
      pin !== undefined
        ? ((await Bun.password.hash(pin, { algorithm: 'bcrypt', cost: 10 })) as PinHash)
        : undefined;

    const userId = UserId(crypto.randomUUID());

    this.#db.run(
      'INSERT INTO accounts (user_id, username, password_hash, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      [userId, username, passwordHash, pinHash ?? null, Date.now()],
    );

    return { kind: 'register_success', userId, username };
  }

  async authenticate(username: string, password: string, pin?: string): Promise<LoginResult> {
    const row = this.#db
      .query('SELECT user_id, username, password_hash, pin_hash FROM accounts WHERE username = ?')
      .get(username) as
      | { user_id: string; username: string; password_hash: string; pin_hash: string | null }
      | undefined;

    if (row === undefined || row === null) {
      return { kind: 'login_error', reason: 'invalid_credentials' };
    }

    const pwValid = await Bun.password.verify(password, row.password_hash);
    if (!pwValid) {
      return { kind: 'login_error', reason: 'invalid_credentials' };
    }

    if (row.pin_hash !== null) {
      if (pin === undefined) {
        return { kind: 'login_error', reason: 'pin_required' };
      }

      const pinValid = await Bun.password.verify(pin, row.pin_hash);
      if (!pinValid) {
        return { kind: 'login_error', reason: 'pin_invalid' };
      }
    }

    return {
      kind: 'login_success',
      userId: UserId(row.user_id),
      username: row.username,
    };
  }

  usernameExists(username: string): boolean {
    const row = this.#db.query('SELECT 1 FROM accounts WHERE username = ? LIMIT 1').get(username);
    return row !== undefined && row !== null;
  }

  destroy(): void {
    this.#db.close();
  }
}
