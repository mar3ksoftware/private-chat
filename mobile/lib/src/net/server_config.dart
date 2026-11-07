import 'package:shared_preferences/shared_preferences.dart';

import 'socket_service.dart';

/// Persistence + validation for the backend base URL edited on the auth
/// screen, so a phone build can reach a LAN host (e.g.
/// `http://192.168.1.5:3000`) instead of the hardcoded localhost default.
abstract final class ServerConfig {
  /// Preference key holding the saved base URL.
  static const String prefKey = 'server_url';

  /// Trimmed input with any trailing slashes removed — the stored form of
  /// an address (handlers are matched without a trailing `/`).
  static String normalize(String raw) =>
      raw.trim().replaceFirst(RegExp(r'/+$'), '');

  /// Friendly validation message for [raw], or null when it is acceptable.
  /// The scheme check runs against the normalized value so degenerate
  /// inputs like `http://` (which normalizes to `http:`) are rejected too.
  static String? validationError(String raw) {
    if (raw.trim().isEmpty) return 'Server address is required';
    final url = normalize(raw);
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'Address must start with http:// or https://';
    }
    return null;
  }

  /// Saved URL, falling back to [SocketService.defaultUrl] on first run.
  static Future<String> load() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(prefKey) ?? SocketService.defaultUrl;
  }

  /// Persists a normalized [url]; callers validate via [validationError]
  /// first.
  static Future<void> save(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(prefKey, url);
  }
}
