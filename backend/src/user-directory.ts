import type { Database } from 'bun:sqlite';

export type DirectoryEntry = {
  readonly username: string;
  readonly userId: string;
};

// The accounts table is the source of truth for registered identities; the
// guest directory only persists names that have joined without an account.
export class UserDirectory {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS guest_directory (
        username  TEXT PRIMARY KEY,
        joined_at INTEGER NOT NULL
      );
    `);
  }

  rememberGuest(username: string): void {
    this.#db.run(
      'INSERT INTO guest_directory (username, joined_at) VALUES (?, ?) ' +
        'ON CONFLICT(username) DO UPDATE SET joined_at = excluded.joined_at',
      [username, Date.now()],
    );
  }

  resolve(username: string): DirectoryEntry | undefined {
    const accountRow = this.#db
      .query('SELECT user_id, username FROM accounts WHERE username = ?')
      .get(username) as { user_id: string; username: string } | null | undefined;

    if (accountRow !== undefined && accountRow !== null) {
      // Sticky: keep the guest row so the directory union stays stable even
      // if the account row were ever removed.
      this.#db.run('INSERT OR IGNORE INTO guest_directory (username, joined_at) VALUES (?, ?)', [
        username,
        Date.now(),
      ]);
      return { username: accountRow.username, userId: accountRow.user_id };
    }

    const guestRow = this.#db
      .query('SELECT username FROM guest_directory WHERE username = ?')
      .get(username) as { username: string } | null | undefined;

    if (guestRow !== undefined && guestRow !== null) {
      return { username: guestRow.username, userId: guestRow.username };
    }

    return undefined;
  }

  all(): readonly string[] {
    const rows = this.#db
      .query(
        'SELECT username FROM accounts ' +
          'UNION SELECT username FROM guest_directory ' +
          'WHERE username NOT IN (SELECT username FROM accounts)',
      )
      .all() as { username: string }[];
    return rows.map((row) => row.username).sort();
  }
}
