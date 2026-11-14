export type Profile = {
  readonly displayName: string;
  readonly status: string;
};

// Deliberately in-memory only: profiles die with the process, same philosophy
// as presence. Nothing here touches disk or the database.
export class ProfileStore {
  #profiles: Map<string, Profile>;

  constructor() {
    this.#profiles = new Map();
  }

  set(username: string, profile: Profile): void {
    this.#profiles.set(username, profile);
  }

  get(username: string): Profile | undefined {
    return this.#profiles.get(username);
  }

  // Every emitted profile carries both fields; users who never set one fall
  // back to their username and an empty status.
  resolve(username: string): Profile {
    return this.#profiles.get(username) ?? { displayName: username, status: '' };
  }

  destroy(): void {
    this.#profiles.clear();
  }
}
