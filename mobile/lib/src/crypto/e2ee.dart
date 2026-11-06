// ── E2EE crypto primitives (PointyCastle) ──────────────────────────────
//
// Byte-compatible Dart port of frontend/src/lib/e2ee.ts:
//
//   ECDH P-256 (raw 65-byte public keys)
//     → HKDF-SHA256 (empty salt, info "private-chat-e2ee-v1", 256 bits)
//     → AES-256-GCM (12-byte IV, 128-bit tag).
//
// Wire format uses standard base64 with padding, exactly like `btoa`/`atob`
// in the web client.

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:pointycastle/api.dart'
    show AEADParameters, InvalidCipherTextException, KeyParameter;
import 'package:pointycastle/block/aes.dart';
import 'package:pointycastle/block/modes/gcm.dart';
import 'package:pointycastle/digests/sha256.dart';
import 'package:pointycastle/ecc/api.dart';
import 'package:pointycastle/ecc/curves/prime256v1.dart';
import 'package:pointycastle/key_derivators/api.dart';
import 'package:pointycastle/key_derivators/hkdf.dart';

/// HKDF `info` string shared with the web client. Changing this breaks
/// interoperability with every existing client.
const String e2eeHkdfInfo = 'private-chat-e2ee-v1';

/// UTF-8 bytes of [e2eeHkdfInfo].
final List<int> e2eeHkdfInfoBytes = List<int>.unmodifiable(
  utf8.encode(e2eeHkdfInfo),
);

/// NIST P-256 domain parameters (also known as secp256r1 / prime256v1).
final ECDomainParameters _p256 = ECCurve_prime256v1();

final Random _secureRandom = Random.secure();

/// An ECDH P-256 key pair.
///
/// The private scalar is intentionally not exposed; callers only need the
/// exported raw public key and [deriveSharedKey].
class E2eeKeyPair {
  final ECPrivateKey _privateKey;

  /// Raw (uncompressed, 65-byte) public key.
  final E2eePublicKey publicKey;

  E2eeKeyPair._(this._privateKey, this.publicKey);
}

/// A P-256 public key backed by a point on the curve.
class E2eePublicKey {
  final ECPoint _point;
  final ECDomainParameters _parameters;

  E2eePublicKey._(this._point, this._parameters);

  /// RAW uncompressed encoding: `0x04 || X (32 bytes) || Y (32 bytes)`.
  Uint8List get rawBytes => _point.getEncoded(false);
}

/// AES-256 key derived from an ECDH shared secret.
class SharedKey {
  final Uint8List _bytes;

  /// Creates a key from 32 raw bytes.
  SharedKey.fromBytes(List<int> bytes) : _bytes = Uint8List.fromList(bytes) {
    if (_bytes.length != 32) {
      throw ArgumentError.value(
        bytes.length,
        'bytes',
        'AES-256 key must be exactly 32 bytes',
      );
    }
  }

  /// A copy of the raw key material.
  List<int> get bytes => Uint8List.fromList(_bytes);
}

/// The JSON-safe shape used on the wire: `{ciphertext, iv}`.
class EncryptedPayload {
  /// Standard base64 of `ciphertext || GCM tag`.
  final String ciphertext;

  /// Standard base64 of the 12-byte IV.
  final String iv;

  const EncryptedPayload({required this.ciphertext, required this.iv});

  Map<String, String> toJson() => <String, String>{
    'ciphertext': ciphertext,
    'iv': iv,
  };
}

/// Thrown when AES-GCM authentication fails (wrong key, tampered data or IV).
class E2eeDecryptionException implements Exception {
  final String message;

  const E2eeDecryptionException(this.message);

  @override
  String toString() => 'E2eeDecryptionException: $message';
}

// ── Key pair generation ────────────────────────────────────────────────

/// Generates a fresh ECDH P-256 key pair.
Future<E2eeKeyPair> generateKeyPair() async {
  final n = _p256.n;

  // WebCrypto picks a uniformly random scalar in [1, n-1]. Do the same with
  // the platform CSPRNG rather than relying on PointyCastle's RNG seeding.
  BigInt d;
  do {
    final bytes = Uint8List(32);
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = _secureRandom.nextInt(256);
    }
    d = _bytesToBigInt(bytes);
  } while (d == BigInt.zero || d >= n);

  final point = _p256.G * d;
  if (point == null || point.isInfinity) {
    throw StateError('Failed to generate a P-256 key pair');
  }

  return E2eeKeyPair._(ECPrivateKey(d, _p256), E2eePublicKey._(point, _p256));
}

// ── Public key export / import ─────────────────────────────────────────

/// Exports [key] as standard base64 of its raw uncompressed point.
Future<String> exportPublicKey(E2eePublicKey key) async =>
    base64Encode(key.rawBytes);

/// Imports a standard-base64 raw uncompressed P-256 public key.
Future<E2eePublicKey> importPublicKey(String base64Key) async {
  final raw = base64Decode(base64Key);
  if (raw.length != 65 || raw[0] != 0x04) {
    throw ArgumentError.value(
      base64Key,
      'base64Key',
      'P-256 public key must be a 65-byte uncompressed point',
    );
  }

  final point = _p256.curve.decodePoint(raw);
  if (point == null || point.isInfinity) {
    throw ArgumentError.value(base64Key, 'base64Key', 'Invalid P-256 point');
  }

  return E2eePublicKey._(point, _p256);
}

// ── Shared key derivation (ECDH → HKDF → AES-GCM) ──────────────────────

/// Derives the AES-GCM key shared with [peerPublicKey].
Future<SharedKey> deriveSharedKey(
  E2eeKeyPair privateKey,
  E2eePublicKey peerPublicKey,
) async {
  final agreement = ECDHBasicAgreement()..init(privateKey._privateKey);
  final x = agreement.calculateAgreement(
    ECPublicKey(peerPublicKey._point, peerPublicKey._parameters),
  );

  // WebCrypto's deriveBits(256) returns the fixed-width 32-byte x coordinate.
  final sharedSecret = _bigIntToFixedBytes(x, 32);
  return hkdfSha256(inputKeyMaterial: sharedSecret);
}

/// HKDF-SHA256 with an empty salt and [e2eeHkdfInfo] by default.
///
/// Exposed separately so the interoperability vector for the KDF can be
/// tested directly.
Future<SharedKey> hkdfSha256({
  required List<int> inputKeyMaterial,
  List<int> salt = const <int>[],
  List<int>? info,
}) async {
  final derivator = HKDFKeyDerivator(SHA256Digest())
    ..init(
      HkdfParameters(
        Uint8List.fromList(inputKeyMaterial),
        32,
        Uint8List.fromList(salt),
        Uint8List.fromList(info ?? e2eeHkdfInfoBytes),
      ),
    );

  final output = Uint8List(32);
  derivator.deriveKey(null, 0, output, 0);
  return SharedKey.fromBytes(output);
}

// ── Encryption / decryption ────────────────────────────────────────────

/// Encrypts [plaintext] with a fresh random 12-byte IV.
Future<EncryptedPayload> encrypt(String plaintext, SharedKey key) async {
  final iv = Uint8List(12);
  for (var i = 0; i < iv.length; i++) {
    iv[i] = _secureRandom.nextInt(256);
  }
  return encryptWithIv(plaintext, key, iv);
}

/// Encrypts [plaintext] with an explicit IV.
///
/// Production code should use [encrypt]; this exists for deterministic test
/// vectors and is otherwise identical to the web implementation.
Future<EncryptedPayload> encryptWithIv(
  String plaintext,
  SharedKey key,
  List<int> iv,
) async {
  final ivBytes = Uint8List.fromList(iv);
  final cipher = _createGcmCipher(true, key, ivBytes);
  final ciphertext = cipher.process(Uint8List.fromList(utf8.encode(plaintext)));

  return EncryptedPayload(
    ciphertext: base64Encode(ciphertext),
    iv: base64Encode(ivBytes),
  );
}

/// Decrypts a base64 `ciphertext`/`iv` pair back to UTF-8 plaintext.
Future<String> decrypt(String ciphertext, String iv, SharedKey key) async {
  final ciphertextBytes = base64Decode(ciphertext);
  final ivBytes = base64Decode(iv);

  try {
    final plaintext = _createGcmCipher(
      false,
      key,
      ivBytes,
    ).process(ciphertextBytes);
    return utf8.decode(plaintext);
  } on InvalidCipherTextException catch (error) {
    throw E2eeDecryptionException(error.message);
  }
}

GCMBlockCipher _createGcmCipher(
  bool forEncryption,
  SharedKey key,
  Uint8List iv,
) {
  if (iv.length != 12) {
    throw ArgumentError.value(iv.length, 'iv', 'AES-GCM IV must be 12 bytes');
  }

  return GCMBlockCipher(AESEngine())..init(
    forEncryption,
    AEADParameters(
      KeyParameter(key._bytes),
      128, // 128-bit authentication tag, matching WebCrypto.
      iv,
      Uint8List(0),
    ),
  );
}

// ── BigInt helpers ─────────────────────────────────────────────────────

BigInt _bytesToBigInt(List<int> bytes) {
  var result = BigInt.zero;
  for (final byte in bytes) {
    result = (result << 8) | BigInt.from(byte);
  }
  return result;
}

Uint8List _bigIntToFixedBytes(BigInt value, int length) {
  if (value.isNegative) {
    throw ArgumentError.value(value, 'value', 'Cannot encode a negative value');
  }

  final result = Uint8List(length);
  var remaining = value;
  for (var i = length - 1; i >= 0; i--) {
    result[i] = (remaining & BigInt.from(0xff)).toInt();
    remaining >>= 8;
  }

  if (remaining != BigInt.zero) {
    throw ArgumentError.value(
      value,
      'value',
      'Value does not fit in $length bytes',
    );
  }
  return result;
}
