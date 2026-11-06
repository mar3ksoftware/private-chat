// ── E2EE session manager ───────────────────────────────────────────────
//
// Dart port of frontend/src/lib/e2ee-session.ts. Manages one ECDH keypair
// plus a per-peer AES-GCM shared key cache.

import 'dart:async';

import 'e2ee.dart';
import 'e2ee.dart'
    as crypto
    show
        decrypt,
        deriveSharedKey,
        encrypt,
        exportPublicKey,
        generateKeyPair,
        importPublicKey;

/// Manages the local ECDH keypair and per-peer shared AES keys.
class E2eeSession {
  E2eeKeyPair? _keyPair;
  Future<E2eeKeyPair>? _keyPairFuture;
  final Map<String, SharedKey> _sharedKeys = <String, SharedKey>{};

  /// Returns the P-256 keypair, generating it once and serializing concurrent
  /// callers so every key exchange uses the same identity.
  Future<E2eeKeyPair> _getKeyPair() async {
    final cached = _keyPair;
    if (cached != null) return cached;

    var future = _keyPairFuture;
    if (future == null) {
      future = crypto.generateKeyPair();
      _keyPairFuture = future;
    }

    try {
      final keyPair = await future;
      _keyPair = keyPair;
      return keyPair;
    } catch (_) {
      // Allow a later call to retry after a generation failure.
      if (identical(_keyPairFuture, future)) {
        _keyPairFuture = null;
      }
      rethrow;
    }
  }

  /// Returns our own public key as standard base64 of the raw 65-byte point.
  Future<String> getPublicKey() async {
    final keyPair = await _getKeyPair();
    return crypto.exportPublicKey(keyPair.publicKey);
  }

  /// Derives a shared key with ourselves so group messages echoed back to the
  /// sender (and group self-decryption) work without a network round-trip.
  Future<void> ensureSelfKey(String username) async {
    if (_sharedKeys.containsKey(username)) return;
    final publicKey = await getPublicKey();
    await deriveSharedSecret(username, publicKey);
  }

  /// Derives and caches the AES key shared with [peerUsername].
  Future<SharedKey> deriveSharedSecret(
    String peerUsername,
    String peerPublicKeyBase64,
  ) async {
    final keyPair = await _getKeyPair();
    final peerKey = await crypto.importPublicKey(peerPublicKeyBase64);
    final sharedKey = await crypto.deriveSharedKey(keyPair, peerKey);
    _sharedKeys[peerUsername] = sharedKey;
    return sharedKey;
  }

  /// Encrypts [plaintext] for [peerUsername]. Throws [StateError] when no
  /// shared key is available yet.
  Future<EncryptedPayload> encrypt(
    String peerUsername,
    String plaintext,
  ) async {
    final key = _sharedKeys[peerUsername];
    if (key == null) {
      throw StateError('No shared key for $peerUsername');
    }
    return crypto.encrypt(plaintext, key);
  }

  /// Decrypts [ciphertext] from [peerUsername]. Throws [StateError] when no
  /// shared key is available yet.
  Future<String> decrypt(
    String peerUsername,
    String ciphertext,
    String iv,
  ) async {
    final key = _sharedKeys[peerUsername];
    if (key == null) {
      throw StateError('No shared key for $peerUsername');
    }
    return crypto.decrypt(ciphertext, iv, key);
  }

  bool hasSharedKey(String peerUsername) =>
      _sharedKeys.containsKey(peerUsername);

  /// Drops the cached key for [peerUsername].
  ///
  /// A peer who rejoins may have generated a new keypair (page reload, logout).
  /// Dropping the old key makes sends wait for the fresh exchange instead of
  /// encrypting with a key the peer can no longer decrypt.
  void forgetSharedKey(String peerUsername) {
    _sharedKeys.remove(peerUsername);
  }

  /// Waits up to [timeoutMs] for a shared key to arrive, polling every
  /// [intervalMs].
  ///
  /// Public keys arrive asynchronously after a peer joins/reconnects, so a send
  /// should wait briefly instead of failing immediately.
  Future<bool> waitForSharedKey(
    String peerUsername, {
    int timeoutMs = 3000,
    int intervalMs = 75,
  }) async {
    if (hasSharedKey(peerUsername)) return true;

    final deadline = DateTime.now().millisecondsSinceEpoch + timeoutMs;
    while (DateTime.now().millisecondsSinceEpoch < deadline) {
      await Future<void>.delayed(Duration(milliseconds: intervalMs));
      if (hasSharedKey(peerUsername)) return true;
    }
    return hasSharedKey(peerUsername);
  }
}
