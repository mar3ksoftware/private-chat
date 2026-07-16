import { describe, expect, test } from 'bun:test';
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from './e2ee';

describe('e2ee', () => {
  test('generateKeyPair returns a keypair with privateKey and publicKey', async () => {
    const kp = await generateKeyPair();
    expect(kp.privateKey).toBeDefined();
    expect(kp.publicKey).toBeDefined();
  });

  test('exportPublicKey returns non-empty base64 string', async () => {
    const kp = await generateKeyPair();
    const exported = await exportPublicKey(kp.publicKey);
    expect(exported.length).toBeGreaterThan(0);
  });

  test('importPublicKey round-trips through exportPublicKey', async () => {
    const kp = await generateKeyPair();
    const exported = await exportPublicKey(kp.publicKey);
    const imported = await importPublicKey(exported);
    const reExported = await exportPublicKey(imported);
    expect(reExported).toBe(exported);
  });

  test('deriveSharedKey produces identical keys from both sides', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const aliceShared = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const bobShared = await deriveSharedKey(bob.privateKey, alice.publicKey);
    // We can't compare CryptoKey objects directly. Instead: encrypt with one, decrypt with the other
    const { ciphertext, iv } = await encrypt('hello', aliceShared);
    const decrypted = await decrypt(ciphertext, iv, bobShared);
    expect(decrypted).toBe('hello');
  });

  test('encrypt returns non-empty ciphertext and iv', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const shared = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const result = await encrypt('test message', shared);
    expect(result.ciphertext.length).toBeGreaterThan(0);
    expect(result.iv.length).toBeGreaterThan(0);
  });

  test('decrypt recovers original plaintext', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const shared = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const plaintext = 'secret message 123!';
    const { ciphertext, iv } = await encrypt(plaintext, shared);
    const decrypted = await decrypt(ciphertext, iv, shared);
    expect(decrypted).toBe(plaintext);
  });

  test('decrypt throws on wrong IV', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const shared = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const { ciphertext } = await encrypt('hello', shared);
    const wrongIv = 'A'.repeat(16); // 16 base64 chars = 12 bytes
    await expect(decrypt(ciphertext, wrongIv, shared)).rejects.toThrow();
  });

  test('decrypt throws on tampered ciphertext', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const shared = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const { iv } = await encrypt('hello', shared);
    const tampered = 'A'.repeat(24);
    await expect(decrypt(tampered, iv, shared)).rejects.toThrow();
  });

  test('decrypt throws on wrong key', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const charlie = await generateKeyPair();
    const aliceBob = await deriveSharedKey(alice.privateKey, bob.publicKey);
    const aliceCharlie = await deriveSharedKey(alice.privateKey, charlie.publicKey);
    const { ciphertext, iv } = await encrypt('hello', aliceBob);
    await expect(decrypt(ciphertext, iv, aliceCharlie)).rejects.toThrow();
  });

  test('importPublicKey rejects invalid base64', async () => {
    await expect(importPublicKey('!!!not valid base64!!!')).rejects.toThrow();
  });
});
