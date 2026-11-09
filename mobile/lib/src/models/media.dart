import 'dart:convert';

import 'json_utils.dart';

/// Lowercase UUID v4, the only accepted `fileId` shape.
final RegExp _fileIdPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);

/// Largest plaintext file the backend accepts (16 MiB).
const int maxMediaBytes = 16 * 1024 * 1024;

/// The `t === 'media'` plaintext envelope carried inside an E2EE message.
///
/// The descriptor is the whole attachment: file id, AES-GCM key material,
/// ciphertext integrity hash and display metadata. None of it ever reaches
/// the server unencrypted.
class MediaDescriptor {
  const MediaDescriptor({
    required this.fileId,
    required this.key,
    required this.iv,
    required this.sha256,
    required this.mime,
    required this.size,
    this.w,
    this.h,
    this.name,
  });

  /// Parses a decoded envelope object, throwing [FormatException] when any
  /// field fails its validation rule.
  factory MediaDescriptor.fromJson(Map<String, dynamic> json) {
    if (json['t'] != 'media') {
      throw const FormatException('envelope type');
    }
    if (json['v'] != 1) {
      throw const FormatException('envelope version');
    }

    final fileId = json['fileId'];
    if (fileId is! String || !_fileIdPattern.hasMatch(fileId)) {
      throw const FormatException('fileId');
    }

    final key = _readSizedBase64(json['key'], 32);
    final iv = _readSizedBase64(json['iv'], 12);
    final sha256 = _readSizedBase64(json['sha256'], 32);

    final mime = json['mime'];
    if (mime is! String || mime.isEmpty) {
      throw const FormatException('mime');
    }

    final size = _readPositiveInt(json['size']);
    if (size == null || size > maxMediaBytes) {
      throw const FormatException('size');
    }

    final hasW = json.containsKey('w');
    final hasH = json.containsKey('h');
    int? w;
    int? h;
    if (hasW || hasH) {
      if (!hasW || !hasH) {
        throw const FormatException('w/h must appear together');
      }
      w = _readPositiveInt(json['w']);
      h = _readPositiveInt(json['h']);
      if (w == null || h == null) {
        throw const FormatException('w/h');
      }
    }

    final name = json['name'];
    String? normalizedName;
    if (name != null) {
      if (name is! String) throw const FormatException('name');
      normalizedName = name;
    }

    return MediaDescriptor(
      fileId: fileId,
      key: key,
      iv: iv,
      sha256: sha256,
      mime: mime,
      size: size,
      w: w,
      h: h,
      name: normalizedName,
    );
  }

  /// Reception rule: try the plaintext as JSON, require a non-array object
  /// with `t === 'media'` and `v === 1`, then validate every field — any
  /// failure returns null and the message stays plain text.
  static MediaDescriptor? tryParse(String plaintext) {
    try {
      final decoded = jsonDecode(plaintext);
      if (decoded is! Map<String, dynamic>) return null;
      return MediaDescriptor.fromJson(decoded);
    } catch (_) {
      return null;
    }
  }

  /// [tryParse] for an already-decoded JSON value (used by wire models).
  static MediaDescriptor? tryFromJson(Object? value) {
    if (value is! Map) return null;
    try {
      return MediaDescriptor.fromJson(asJsonMap(value));
    } catch (_) {
      return null;
    }
  }

  final String fileId;
  final String key;
  final String iv;
  final String sha256;
  final String mime;
  final int size;
  final int? w;
  final int? h;
  final String? name;

  Map<String, dynamic> toJson() => <String, dynamic>{
    't': 'media',
    'v': 1,
    'fileId': fileId,
    'key': key,
    'iv': iv,
    'sha256': sha256,
    'mime': mime,
    'size': size,
    if (w != null) 'w': w,
    if (h != null) 'h': h,
    if (name != null) 'name': name,
  };

  static String _readSizedBase64(Object? value, int expectedLength) {
    if (value is! String) throw const FormatException('base64 field');
    final bytes = base64Decode(value);
    if (bytes.length != expectedLength) {
      throw FormatException('expected $expectedLength bytes');
    }
    return value;
  }

  static int? _readPositiveInt(Object? value) {
    if (value is! num) return null;
    if (value != value.truncate()) return null;
    final integer = value.toInt();
    return integer > 0 ? integer : null;
  }
}

/// Payload of the `media:token` server event: a bearer token for the
/// `/media` HTTP endpoints.
class MediaTokenPayload {
  const MediaTokenPayload({required this.token});

  factory MediaTokenPayload.fromJson(Map<String, dynamic> json) {
    return MediaTokenPayload(token: readString(json['token']));
  }

  final String token;

  Map<String, String> toJson() => <String, String>{'token': token};
}
