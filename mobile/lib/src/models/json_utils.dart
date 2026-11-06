/// Small, defensive helpers for reading JSON produced by the backend.
///
/// Socket.io payloads arrive as `dynamic` values, so every model parser goes
/// through these helpers instead of casting directly. Missing or malformed
/// fields fall back to safe defaults rather than throwing, which keeps a single
/// bad payload from breaking an entire event stream.
Map<String, dynamic> asJsonMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, entry) => MapEntry(key.toString(), entry));
  }
  return const <String, dynamic>{};
}

String readString(Object? value, [String fallback = '']) {
  if (value is String) return value;
  if (value == null) return fallback;
  return value.toString();
}

String? readNullableString(Object? value) {
  if (value == null) return null;
  final text = readString(value);
  return text.isEmpty ? null : text;
}

int readInt(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

bool readBool(Object? value, {bool fallback = false}) {
  if (value is bool) return value;
  if (value is String) {
    if (value == 'true') return true;
    if (value == 'false') return false;
  }
  if (value is num) return value != 0;
  return fallback;
}

List<Object?> readList(Object? value) {
  if (value is List) return value;
  return const <Object?>[];
}
