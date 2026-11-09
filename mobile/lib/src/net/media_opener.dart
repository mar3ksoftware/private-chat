// ── External media opener ──────────────────────────────────────────────────
//
// Videos play through the OS player (the one-dependency budget excludes a
// bundled video player): bytes are written to the temp dir and handed to
// Android's FileProvider channel, or to `xdg-open`/`open`/`cmd start` on
// desktop. Any failure surfaces as false so the caller can toast.

import 'dart:io';

import 'package:flutter/services.dart';

abstract final class MediaOpener {
  static const MethodChannel _channel = MethodChannel('private_chat/media');

  /// Writes [bytes] under `<systemTemp>/media/` and opens them externally
  /// with [mime]. Returns false when the file cannot be written or opened.
  static Future<bool> open({
    required Uint8List bytes,
    required String mime,
    required String? name,
  }) async {
    try {
      final directory = Directory('${Directory.systemTemp.path}/media');
      directory.createSync(recursive: true);
      final file = File('${directory.path}/${_fileName(name, mime)}');
      file.writeAsBytesSync(bytes, flush: true);

      if (Platform.isAndroid) {
        final opened = await _channel.invokeMethod<bool>(
          'openFile',
          <String, Object?>{'path': file.path, 'mime': mime},
        );
        return opened ?? false;
      }
      if (Platform.isLinux) {
        final result = await Process.run('xdg-open', <String>[file.path]);
        return result.exitCode == 0;
      }
      if (Platform.isMacOS) {
        final result = await Process.run('open', <String>[file.path]);
        return result.exitCode == 0;
      }
      if (Platform.isWindows) {
        final result = await Process.run(
          'cmd',
          <String>['/c', 'start', '', file.path],
        );
        return result.exitCode == 0;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Sanitized basename with an extension that matches [mime].
  static String _fileName(String? name, String mime) {
    var base = name ?? '';
    final slash = base.lastIndexOf(RegExp(r'[/\\]'));
    if (slash != -1) base = base.substring(slash + 1);
    final cleaned = StringBuffer();
    for (final code in base.codeUnits) {
      if (code < 0x20 || (code >= 0x7F && code <= 0x9F)) continue;
      cleaned.writeCharCode(code);
    }
    var safe = cleaned.toString().replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    if (safe.startsWith('.')) safe = safe.substring(1);
    if (!safe.contains('.')) {
      safe = 'media.${_extensionFor(mime)}';
    }
    if (safe.isEmpty || safe == '.${_extensionFor(mime)}') {
      safe = 'media.${_extensionFor(mime)}';
    }
    return safe;
  }

  static String _extensionFor(String mime) {
    return switch (mime) {
      'image/jpeg' => 'jpg',
      'image/png' => 'png',
      'image/webp' => 'webp',
      'video/mp4' => 'mp4',
      'video/webm' => 'webm',
      'video/quicktime' => 'mov',
      _ => 'bin',
    };
  }
}
