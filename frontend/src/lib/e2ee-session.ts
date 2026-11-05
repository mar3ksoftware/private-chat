// ── E2EE session manager ───────────────────────────────────────────────
// Manages ECDH keypair + per-peer AES-GCM shared keys.
// Adapted from backend/src/e2ee-session.ts for browser use.

import {
  deriveSharedKey,
  decrypt as e2eeDecrypt,
  encrypt as e2eeEncrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from './e2ee';

export class E2eeSession {
  #keyPair: CryptoKeyPair | undefined;
  #keyPairPromise: Promise<CryptoKeyPair> | undefined;
  #sharedKeys: Map<string, CryptoKey>;

  constructor() {
    this.#keyPair = undefined;
    this.#keyPairPromise = undefined;
    this.#sharedKeys = new Map();
  }

  // Serialize keypair generation: multiple public-key exchanges can start
  // concurrently, and they must all use the same keypair.
  async #getKeyPair(): Promise<CryptoKeyPair> {
    if (this.#keyPair !== undefined) return this.#keyPair;
    if (this.#keyPairPromise === undefined) {
      this.#keyPairPromise = generateKeyPair();
    }
    try {
      const keyPair = await this.#keyPairPromise;
      this.#keyPair = keyPair;
      return keyPair;
    } catch (error) {
      this.#keyPairPromise = undefined;
      throw error;
    }
  }

  async getPublicKey(): Promise<string> {
    const keyPair = await this.#getKeyPair();
    return exportPublicKey(keyPair.publicKey);
  }

  // Derive a shared key with ourselves so group messages echoed back to the
  // sender (and group self-decryption) work without a network round-trip.
  async ensureSelfKey(username: string): Promise<void> {
    if (this.#sharedKeys.has(username)) return;
    const publicKey = await this.getPublicKey();
    await this.deriveSharedSecret(username, publicKey);
  }

  async deriveSharedSecret(peerUsername: string, peerPublicKeyBase64: string): Promise<CryptoKey> {
    const keyPair = await this.#getKeyPair();
    const peerKey = await importPublicKey(peerPublicKeyBase64);
    const sharedKey = await deriveSharedKey(keyPair.privateKey, peerKey);
    this.#sharedKeys.set(peerUsername, sharedKey);
    return sharedKey;
  }

  async encrypt(
    peerUsername: string,
    plaintext: string,
  ): Promise<{ readonly ciphertext: string; readonly iv: string }> {
    const key = this.#sharedKeys.get(peerUsername);
    if (key === undefined) {
      throw new Error(`No shared key for ${peerUsername}`);
    }
    return e2eeEncrypt(plaintext, key);
  }

  async decrypt(peerUsername: string, ciphertext: string, iv: string): Promise<string> {
    const key = this.#sharedKeys.get(peerUsername);
    if (key === undefined) {
      throw new Error(`No shared key for ${peerUsername}`);
    }
    return e2eeDecrypt(ciphertext, iv, key);
  }

  hasSharedKey(peerUsername: string): boolean {
    return this.#sharedKeys.has(peerUsername);
  }

  // A peer who rejoins may have generated a new keypair (page reload, logout).
  // Drop the old shared key so sends wait for the fresh key exchange instead
  // of encrypting with a key the peer can no longer decrypt.
  forgetSharedKey(peerUsername: string): void {
    this.#sharedKeys.delete(peerUsername);
  }

  // Public keys arrive asynchronously after a peer joins/reconnects. Wait a
  // short while for the key instead of failing the send immediately.
  async waitForSharedKey(
    peerUsername: string,
    timeoutMs = 3000,
    intervalMs = 75,
  ): Promise<boolean> {
    if (this.hasSharedKey(peerUsername)) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, intervalMs);
      });
      if (this.hasSharedKey(peerUsername)) return true;
    }
    return this.hasSharedKey(peerUsername);
  }
}
