// Interoperability tests for the mobile E2EE layer.
//
// Vectors were generated with the real web client implementation
// (frontend/src/lib/e2ee.ts, WebCrypto). They must match byte-for-byte.

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/crypto/e2ee.dart';
import 'package:scattered_keyhole/src/crypto/e2ee_session.dart';

const String _vectorKeyHex =
    '0082a3337359b7190067416d17f653d3cad1bdea4e3b2fc8dcd41d7ff357c15b';

Uint8List _hexToBytes(String hex) {
  final result = Uint8List(hex.length ~/ 2);
  for (var i = 0; i < result.length; i++) {
    result[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return result;
}

String _bytesToHex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

void main() {
  group('web interoperability vectors', () {
    test('HKDF-SHA256 derives the expected AES-256 key', () async {
      final ikm = List<int>.generate(32, (i) => i);

      final key = await hkdfSha256(
        inputKeyMaterial: ikm,
        salt: const <int>[],
        info: utf8.encode('scattered-keyhole-e2ee-v1'),
      );

      expect(_bytesToHex(key.bytes), _vectorKeyHex);
    });

    test('AES-GCM encryption matches the expected ciphertext', () async {
      final key = SharedKey.fromBytes(_hexToBytes(_vectorKeyHex));
      final iv = base64Decode('AAECAwQFBgcICQoL');

      final payload = await encryptWithIv('interop test vector', key, iv);

      expect(
        payload.ciphertext,
        'Ku+khuVsjU0v9x7igpBF5psmmBk/yFlMn4gqTlvZ2l7gUmA=',
      );
      expect(payload.iv, 'AAECAwQFBgcICQoL');
    });

    test('AES-GCM decryption matches the expected plaintext', () async {
      final key = SharedKey.fromBytes(_hexToBytes(_vectorKeyHex));

      final plaintext = await decrypt(
        'zxlFQPjDTq1OW3bwChm9mU2lSfJ1iV8EehjgR4jD',
        'CQgHBgUEAwIBAP/+',
        key,
      );

      expect(plaintext, 'secret message');
    });

    test('public key export is raw uncompressed P-256 base64', () async {
      final keyPair = await generateKeyPair();
      final encoded = await exportPublicKey(keyPair.publicKey);
      final raw = base64Decode(encoded);

      expect(raw.length, 65);
      expect(raw.first, 0x04);
      expect(encoded.length, 88);
      expect(encoded.endsWith('='), isTrue);

      // Import/export must round-trip the same bytes.
      final imported = await importPublicKey(encoded);
      expect(await exportPublicKey(imported), encoded);
    });

    test('ECDH shared key derivation is symmetric', () async {
      final alice = await generateKeyPair();
      final bob = await generateKeyPair();

      final aliceKey = await deriveSharedKey(alice, bob.publicKey);
      final bobKey = await deriveSharedKey(bob, alice.publicKey);

      expect(aliceKey.bytes, bobKey.bytes);

      final payload = await encrypt('hello bob', aliceKey);
      expect(
        await decrypt(payload.ciphertext, payload.iv, bobKey),
        'hello bob',
      );
    });

    test('AES-GCM rejects a tampered ciphertext', () async {
      final key = SharedKey.fromBytes(_hexToBytes(_vectorKeyHex));
      final payload = await encrypt('tamper me', key);
      final bytes = base64Decode(payload.ciphertext);
      bytes[0] ^= 0xFF;

      expect(
        () => decrypt(base64Encode(bytes), payload.iv, key),
        throwsA(isA<E2eeDecryptionException>()),
      );
    });
  });

  group('E2eeSession', () {
    test('ensureSelfKey + encrypt + decrypt round-trips', () async {
      final session = E2eeSession();

      await session.ensureSelfKey('alice');
      expect(session.hasSharedKey('alice'), isTrue);

      final payload = await session.encrypt('alice', 'message to myself');
      expect(
        await session.decrypt('alice', payload.ciphertext, payload.iv),
        'message to myself',
      );
    });

    test('encrypt without a shared key throws', () async {
      final session = E2eeSession();

      expect(() => session.encrypt('nobody', 'hi'), throwsA(isA<StateError>()));
      expect(
        () => session.decrypt('nobody', 'AAAA', 'AAAA'),
        throwsA(isA<StateError>()),
      );
    });

    test('forgetSharedKey drops the cached key', () async {
      final session = E2eeSession();
      await session.ensureSelfKey('alice');
      expect(session.hasSharedKey('alice'), isTrue);

      session.forgetSharedKey('alice');

      expect(session.hasSharedKey('alice'), isFalse);
    });

    test('waitForSharedKey returns true immediately when key exists', () async {
      final session = E2eeSession();
      await session.ensureSelfKey('alice');

      expect(await session.waitForSharedKey('alice'), isTrue);
    });

    test('waitForSharedKey times out when key never arrives', () async {
      final session = E2eeSession();

      final result = await session.waitForSharedKey(
        'ghost',
        timeoutMs: 80,
        intervalMs: 10,
      );

      expect(result, isFalse);
    });

    test('waitForSharedKey resolves after a late key exchange', () async {
      final session = E2eeSession();
      final peer = E2eeSession();
      final peerPublicKey = await peer.getPublicKey();

      final waiting = session.waitForSharedKey(
        'bob',
        timeoutMs: 1000,
        intervalMs: 10,
      );

      await Future<void>.delayed(const Duration(milliseconds: 60));
      await session.deriveSharedSecret('bob', peerPublicKey);

      expect(await waiting, isTrue);
    });

    test('concurrent getPublicKey calls use one keypair', () async {
      final session = E2eeSession();

      final keys = await Future.wait(<Future<String>>[
        session.getPublicKey(),
        session.getPublicKey(),
        session.getPublicKey(),
      ]);

      expect(keys.toSet(), hasLength(1));
    });
  });
}
