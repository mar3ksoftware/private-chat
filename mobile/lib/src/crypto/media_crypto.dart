// ── Media encryption helpers (PointyCastle + dart:ui) ─────────────────────
//
// Self-contained sibling of `e2ee.dart`: the same single-shot AES-256-GCM
// construction (128-bit tag, empty AAD) is duplicated here so the file-level
// crypto used for attachments can evolve independently of the E2EE session
// code. Files are small enough (≤ 16 MiB) to encrypt in one call.

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:pointycastle/api.dart' show AEADParameters, KeyParameter;
import 'package:pointycastle/block/aes.dart';
import 'package:pointycastle/block/modes/gcm.dart';
import 'package:pointycastle/digests/sha256.dart';

final Random _secureRandom = Random.secure();

/// Random lowercase UUID v4 (128 bits of entropy with the RFC 4122
/// version/variant bits forced), used as the media `fileId`.
String generateMediaId() {
  final bytes = Uint8List(16);
  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = _secureRandom.nextInt(256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-'
      '${hex.substring(20)}';
}

/// A fresh random 32-byte AES-256 file key.
Uint8List randomBytes32() {
  final bytes = Uint8List(32);
  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = _secureRandom.nextInt(256);
  }
  return bytes;
}

/// A fresh random 12-byte GCM IV.
Uint8List randomIv12() {
  final bytes = Uint8List(12);
  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = _secureRandom.nextInt(256);
  }
  return bytes;
}

GCMBlockCipher _gcmCipher(bool forEncryption, List<int> key, List<int> iv) {
  if (iv.length != 12) {
    throw ArgumentError.value(iv.length, 'iv', 'AES-GCM IV must be 12 bytes');
  }
  return GCMBlockCipher(AESEngine())
    ..init(
      forEncryption,
      AEADParameters(
        KeyParameter(Uint8List.fromList(key)),
        128,
        Uint8List.fromList(iv),
        Uint8List(0),
      ),
    );
}

/// Single-shot AES-256-GCM encryption; the result already contains the
/// 16-byte authentication tag appended by the cipher.
Uint8List encryptBytes(Uint8List plain, List<int> key, List<int> iv) {
  return _gcmCipher(true, key, iv).process(Uint8List.fromList(plain));
}

/// Single-shot AES-256-GCM decryption; throws [InvalidCipherTextException]
/// when the key, IV or ciphertext does not authenticate.
Uint8List decryptBytes(Uint8List cipher, List<int> key, List<int> iv) {
  return _gcmCipher(false, key, iv).process(Uint8List.fromList(cipher));
}

/// Standard base64 SHA-256 over [bytes] (the anti-swap hash stored in the
/// descriptor).
String sha256Base64(Uint8List bytes) =>
    base64Encode(SHA256Digest().process(bytes));

const List<int> _pngSignature = <int>[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

const Set<String> _pngDroppedChunks = <String>{'eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'};

/// Strips EXIF/XMP/IPTC metadata from [bytes] before encryption (fail
/// closed — null means the input could not be parsed and must not be sent).
///
/// JPEG drops `APP1`/`APP13` segments, PNG drops `eXIf`/`tEXt`/`iTXt`/
/// `zTXt`/`tIME` chunks and WebP drops `EXIF `/`XMP ` chunks; everything
/// else is copied byte-identically.
Uint8List? stripImageMetadata(Uint8List bytes, String mime) {
  return switch (mime) {
    'image/jpeg' => _stripJpeg(bytes),
    'image/png' => _stripPng(bytes),
    'image/webp' => _stripWebp(bytes),
    _ => null,
  };
}

Uint8List? _stripJpeg(Uint8List bytes) {
  if (bytes.length < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8) return null;

  final out = BytesBuilder();
  out.add(const <int>[0xFF, 0xD8]);
  var pos = 2;

  while (true) {
    if (pos >= bytes.length || bytes[pos] != 0xFF) return null;
    final markerStart = pos;
    while (pos < bytes.length && bytes[pos] == 0xFF) {
      pos++;
    }
    if (pos >= bytes.length) return null;
    final marker = bytes[pos];
    pos++;

    if (marker == 0xD9) return null;
    if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) return null;

    if (marker == 0xDA) {
      // SOS: the entropy-coded scan runs to the next EOI; copy it verbatim.
      final eoi = _findEoi(bytes, pos);
      if (eoi == -1) return null;
      out.add(bytes.sublist(markerStart, eoi + 2));
      return out.toBytes();
    }

    if (pos + 2 > bytes.length) return null;
    final length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2) return null;
    final segmentEnd = pos + length;
    if (segmentEnd > bytes.length) return null;
    if (marker != 0xE1 && marker != 0xED) {
      out.add(bytes.sublist(markerStart, segmentEnd));
    }
    pos = segmentEnd;
  }
}

int _findEoi(Uint8List bytes, int from) {
  for (var i = from; i + 1 < bytes.length; i++) {
    if (bytes[i] == 0xFF && bytes[i + 1] == 0xD9) return i;
  }
  return -1;
}

Uint8List? _stripPng(Uint8List bytes) {
  if (bytes.length < _pngSignature.length) return null;
  for (var i = 0; i < _pngSignature.length; i++) {
    if (bytes[i] != _pngSignature[i]) return null;
  }

  final out = BytesBuilder()..add(_pngSignature);
  var pos = _pngSignature.length;

  while (pos < bytes.length) {
    if (pos + 12 > bytes.length) return null;
    final length = _readBe32(bytes, pos);
    final type = String.fromCharCodes(bytes, pos + 4, pos + 8);
    final chunkEnd = pos + 12 + length;
    if (chunkEnd > bytes.length) return null;
    if (!_pngDroppedChunks.contains(type)) {
      out.add(bytes.sublist(pos, chunkEnd));
    }
    pos = chunkEnd;
    if (type == 'IEND') break;
  }
  return out.toBytes();
}

Uint8List? _stripWebp(Uint8List bytes) {
  if (bytes.length < 12) return null;
  if (String.fromCharCodes(bytes, 0, 4) != 'RIFF') return null;
  if (String.fromCharCodes(bytes, 8, 12) != 'WEBP') return null;

  final body = BytesBuilder()..add(bytes.sublist(8, 12));
  var pos = 12;

  while (pos < bytes.length) {
    if (pos + 8 > bytes.length) return null;
    final id = String.fromCharCodes(bytes, pos, pos + 4);
    final size = _readLe32(bytes, pos + 4);
    final dataEnd = pos + 8 + size;
    if (dataEnd > bytes.length) return null;
    final paddedEnd = dataEnd + (size & 1);
    if (id != 'EXIF ' && id != 'XMP ') {
      body.add(bytes.sublist(pos, paddedEnd <= bytes.length ? paddedEnd : dataEnd));
    }
    pos = paddedEnd <= bytes.length ? paddedEnd : bytes.length;
  }

  final out = BytesBuilder()
    ..add('RIFF'.codeUnits)
    ..add(_le32Bytes(8 + body.length))
    ..add(body.toBytes());
  return out.toBytes();
}

int _readBe32(Uint8List bytes, int offset) =>
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3];

int _readLe32(Uint8List bytes, int offset) =>
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);

List<int> _le32Bytes(int value) => <int>[
  value & 0xFF,
  (value >> 8) & 0xFF,
  (value >> 16) & 0xFF,
  (value >> 24) & 0xFF,
];

/// Decodes the image header to its pixel dimensions (first frame, disposed
/// immediately); null when the bytes do not decode as an image.
Future<({int w, int h})?> readImageSize(Uint8List bytes) async {
  ui.Codec? codec;
  try {
    codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final size = (w: frame.image.width, h: frame.image.height);
    frame.image.dispose();
    return size;
  } catch (_) {
    return null;
  } finally {
    codec?.dispose();
  }
}

/// Maps a file name extension onto the A.2 MIME allowlist, or null when the
/// extension is unknown/absent.
String? mimeForFileName(String name) {
  final dot = name.lastIndexOf('.');
  if (dot <= 0 || dot == name.length - 1) return null;
  final extension = name.substring(dot + 1).toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'mp4' => 'video/mp4',
    'webm' => 'video/webm',
    'mov' => 'video/quicktime',
    _ => null,
  };
}
