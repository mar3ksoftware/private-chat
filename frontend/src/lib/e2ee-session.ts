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
  #sharedKeys: Map<string, CryptoKey>;

  constructor() {
    this.#keyPair = undefined;
    this.#sharedKeys = new Map();
  }

  async getPublicKey(): Promise<string> {
    if (this.#keyPair === undefined) {
      this.#keyPair = await generateKeyPair();
    }
    return exportPublicKey(this.#keyPair.publicKey);
  }

  async deriveSharedSecret(peerUsername: string, peerPublicKeyBase64: string): Promise<CryptoKey> {
    if (this.#keyPair === undefined) {
      this.#keyPair = await generateKeyPair();
    }
    const peerKey = await importPublicKey(peerPublicKeyBase64);
    const sharedKey = await deriveSharedKey(this.#keyPair.privateKey, peerKey);
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
}
