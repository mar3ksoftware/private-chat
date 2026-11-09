// ── Media HTTP client ──────────────────────────────────────────────────────
//
// `PUT`/`GET /media/:id` against the backend's plain fetch server (the
// same origin as the Socket.IO connection, minus `/socket.io/`). Only the
// opaque ciphertext ever travels over this channel — keys and descriptors
// stay inside E2EE messages.

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Outcome of a media download: raw ciphertext on `ready`, a 404 on
/// `expired`, anything else on `error`.
class MediaFetchResult {
  const MediaFetchResult._(this.status, this.bytes);

  const MediaFetchResult.ready(Uint8List bytes) : this._('ready', bytes);

  const MediaFetchResult.expired() : this._('expired', null);

  const MediaFetchResult.error() : this._('error', null);

  /// `'ready' | 'expired' | 'error'`.
  final String status;

  /// Raw download bytes (present only for `ready`); verification and
  /// decryption happen in the controller, so fakes only move bytes.
  final Uint8List? bytes;
}

/// An upload failure carrying the exact user-facing text from the contract.
class MediaUploadException implements Exception {
  const MediaUploadException(this.message);

  final String message;

  @override
  String toString() => 'MediaUploadException: $message';
}

/// Transport contract for the `/media` HTTP endpoints. Tests fake this.
abstract interface class MediaClient {
  /// Sends the ciphertext as `PUT /media/:id`. Returns true only on 201;
  /// throws [MediaUploadException] with the mapped contract error text.
  Future<bool> upload({
    required String fileId,
    required Uint8List ciphertext,
    required String token,
  });

  /// Fetches the ciphertext as `GET /media/:id`.
  Future<MediaFetchResult> download({
    required String fileId,
    required String token,
  });
}

/// [MediaClient] backed by `dart:io`'s [HttpClient].
class HttpMediaClient implements MediaClient {
  HttpMediaClient({required this.baseUrl})
    : _baseUrl = baseUrl.endsWith('/')
          ? baseUrl.substring(0, baseUrl.length - 1)
          : baseUrl;

  /// Server origin, e.g. `http://10.0.2.2:3000`.
  final String baseUrl;
  final String _baseUrl;
  final HttpClient _http = HttpClient();

  @override
  Future<bool> upload({
    required String fileId,
    required Uint8List ciphertext,
    required String token,
  }) async {
    try {
      final request = await _http.putUrl(Uri.parse('$_baseUrl/media/$fileId'));
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.contentType = ContentType(
        'application',
        'octet-stream',
      );
      request.add(ciphertext);
      final response = await request.close();
      final body = await _collect(response);
      if (response.statusCode == HttpStatus.created) return true;
      throw MediaUploadException(_uploadErrorText(response.statusCode, body));
    } on MediaUploadException {
      rethrow;
    } on IOException {
      throw const MediaUploadException('Upload failed. Please try again.');
    } catch (_) {
      throw const MediaUploadException('Upload failed. Please try again.');
    }
  }

  @override
  Future<MediaFetchResult> download({
    required String fileId,
    required String token,
  }) async {
    try {
      final request = await _http.getUrl(Uri.parse('$_baseUrl/media/$fileId'));
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      final response = await request.close();
      final body = await _collect(response);
      if (response.statusCode == HttpStatus.ok) {
        return MediaFetchResult.ready(Uint8List.fromList(body));
      }
      if (response.statusCode == HttpStatus.notFound) {
        return MediaFetchResult.expired();
      }
      return MediaFetchResult.error();
    } catch (_) {
      return MediaFetchResult.error();
    }
  }

  Future<List<int>> _collect(HttpClientResponse response) async {
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
    }
    return bytes;
  }

  static String _uploadErrorText(int statusCode, List<int> body) {
    if (statusCode == HttpStatus.tooManyRequests) {
      final reason = _readErrorCode(body);
      if (reason == 'quota_exceeded') {
        return 'Server storage is full. Please try again later.';
      }
      return 'Too many uploads. Please wait a moment.';
    }
    return 'Upload failed. Please try again.';
  }

  static String? _readErrorCode(List<int> body) {
    try {
      final decoded = jsonDecode(utf8.decode(body));
      if (decoded is Map && decoded['error'] is String) {
        return decoded['error'] as String;
      }
    } catch (_) {
      return null;
    }
    return null;
  }
}
