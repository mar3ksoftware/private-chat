// Unit tests for the attachment crypto helpers: fileId generation, the
// AES-256-GCM round-trip, the frozen anti-swap hash, metadata stripping
// and descriptor envelope validation (contract A.2).

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pointycastle/api.dart' show InvalidCipherTextException;
import 'package:private_chat_mobile/src/crypto/media_crypto.dart';
import 'package:private_chat_mobile/src/models/models.dart';

void main() {
  test('generateMediaId returns lowercase UUID v4 ids that never repeat', () {
    final first = generateMediaId();
    final second = generateMediaId();
    expect(
      first,
      matches(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      ),
    );
    expect(first, isNot(second));
  });

  test('encryptBytes/decryptBytes round-trip; wrong key fails to authenticate', () {
    final key = randomBytes32();
    final iv = randomIv12();
    final data = Uint8List.fromList(
      List<int>.generate(200, (index) => index % 256),
    );

    final ciphertext = encryptBytes(data, key, iv);
    expect(ciphertext, isNot(orderedEquals(data)));
    expect(decryptBytes(ciphertext, key, iv), orderedEquals(data));

    expect(
      () => decryptBytes(ciphertext, randomBytes32(), iv),
      throwsA(isA<InvalidCipherTextException>()),
    );
  });

  test('sha256Base64 matches the frozen digest of "abc"', () {
    expect(
      sha256Base64(Uint8List.fromList(utf8.encode('abc'))),
      'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
    );
  });

  test('stripImageMetadata drops JPEG APP1 and PNG metadata chunks only', () {
    // JPEG: SOI + APP1(Exif) + APP2(ICC) + scan + EOI. The length fields
    // cover the 2 length bytes plus the payload, as JPEG segments require.
    const soi = <int>[0xFF, 0xD8];
    const app1 = <int>[0xFF, 0xE1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66];
    const app2 = <int>[0xFF, 0xE2, 0x00, 0x06, 0x49, 0x43, 0x43, 0x58];
    const scan = <int>[0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02, 0x03, 0xAA, 0xBB];
    const eoi = <int>[0xFF, 0xD9];
    final jpeg = Uint8List.fromList([
      ...soi,
      ...app1,
      ...app2,
      ...scan,
      ...eoi,
    ]);

    final strippedJpeg = stripImageMetadata(jpeg, 'image/jpeg');
    expect(strippedJpeg, isNotNull);
    // APP1 is gone; APP2 and the entropy-coded scan stay byte-identical.
    expect(strippedJpeg, orderedEquals([...soi, ...app2, ...scan, ...eoi]));

    // PNG: signature + IHDR + eXIf + IDAT + tIME + IEND (synthetic CRCs —
    // the stripper copies kept chunks without verifying them).
    Uint8List chunk(String type, List<int> data) {
      final builder = BytesBuilder();
      final length = data.length;
      builder.add([
        (length >> 24) & 0xFF,
        (length >> 16) & 0xFF,
        (length >> 8) & 0xFF,
        length & 0xFF,
      ]);
      builder.add(type.codeUnits);
      builder.add(data);
      builder.add(const <int>[0, 0, 0, 0]);
      return builder.toBytes();
    }

    const signature = <int>[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    final ihdr = chunk('IHDR', List<int>.filled(13, 1));
    final exif = chunk('eXIf', const <int>[1, 2, 3, 4]);
    final idat = chunk('IDAT', List<int>.filled(8, 9));
    final time = chunk('tIME', List<int>.filled(7, 5));
    final iend = chunk('IEND', const <int>[]);
    final png = Uint8List.fromList([
      ...signature,
      ...ihdr,
      ...exif,
      ...idat,
      ...time,
      ...iend,
    ]);

    final strippedPng = stripImageMetadata(png, 'image/png');
    expect(strippedPng, isNotNull);
    expect(strippedPng, orderedEquals([...signature, ...ihdr, ...idat, ...iend]));

    // Garbage never survives a strip — the caller fails closed.
    expect(
      stripImageMetadata(Uint8List.fromList(const <int>[1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg'),
      isNull,
    );
    expect(
      stripImageMetadata(Uint8List.fromList(const <int>[1, 2, 3, 4, 5, 6, 7, 8]), 'image/png'),
      isNull,
    );
    expect(
      stripImageMetadata(Uint8List.fromList([...signature, 0, 0, 0, 5]), 'image/png'),
      isNull,
    );
  });

  test('MediaDescriptor.tryParse accepts a valid envelope and rejects the rest', () {
    final key = base64Encode(randomBytes32());
    final iv = base64Encode(randomIv12());
    final sha256 = base64Encode(List<int>.filled(32, 7));
    final fileId = generateMediaId();
    final envelope = jsonEncode(<String, Object?>{
      't': 'media',
      'v': 1,
      'fileId': fileId,
      'key': key,
      'iv': iv,
      'sha256': sha256,
      'mime': 'image/jpeg',
      'size': 183422,
      'w': 1920,
      'h': 1080,
      'name': 'IMG_0042.jpg',
    });

    final descriptor = MediaDescriptor.tryParse(envelope);
    expect(descriptor, isNotNull);
    expect(descriptor!.fileId, fileId);
    expect(descriptor.key, key);
    expect(descriptor.iv, iv);
    expect(descriptor.sha256, sha256);
    expect(descriptor.mime, 'image/jpeg');
    expect(descriptor.size, 183422);
    expect(descriptor.w, 1920);
    expect(descriptor.h, 1080);
    expect(descriptor.name, 'IMG_0042.jpg');
    expect(descriptor.toJson(), jsonDecode(envelope));

    // Rejection matrix — every malformed shape falls back to plain text.
    String withField(String field, Object? value) {
      final map = Map<String, Object?>.from(descriptor.toJson());
      map[field] = value;
      return jsonEncode(map);
    }

    String withoutField(String field) {
      final map = Map<String, Object?>.from(descriptor.toJson());
      map.remove(field);
      return jsonEncode(map);
    }

    expect(MediaDescriptor.tryParse('just some plain text'), isNull);
    expect(MediaDescriptor.tryParse(withField('t', 'text')), isNull);
    expect(MediaDescriptor.tryParse(withoutField('key')), isNull);
    expect(
      MediaDescriptor.tryParse(withField('iv', base64Encode(List<int>.filled(11, 0)))),
      isNull,
    );
    expect(MediaDescriptor.tryParse(withField('size', 0)), isNull);
    expect(
      MediaDescriptor.tryParse(
        withField('fileId', '6f9619ff-8b86-4d01-c42d-00cf4fc964ff'),
      ),
      isNull,
    );
    expect(MediaDescriptor.tryParse(withoutField('h')), isNull);
  });
}
