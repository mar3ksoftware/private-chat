// ── Mention parsing (C8) ──
// `@username` only counts when the name is an exact match against the known
// directory and sits on a word boundary; `@all` is group-only.

/// A split piece of a message body: plain text or a mention addressing me.
class BodySegment {
  final String kind; // 'text' | 'mention'
  final String text;
  final int start;

  const BodySegment(this.kind, this.text, this.start);

  bool get isMention => kind == 'mention';
}

final RegExp _usernameChar = RegExp('[a-zA-Z0-9_-]');

String _escapeRegExp(String value) =>
    value.replaceAllMapped(RegExp(r'[.*+?^${}()|[\]\\]'), (m) => '\\${m[0]}');

// Boundary: preceded by start-of-string or a non-alphanumeric char, followed
// by a non-username char (usernames are [a-zA-Z0-9_-]).
RegExp? _buildMentionRegExp(List<String> candidates) {
  final unique = <String>{};
  for (final name in candidates) {
    if (name.isNotEmpty) unique.add(name);
  }
  if (unique.isEmpty) return null;
  final sorted = unique.toList()..sort((a, b) => b.length.compareTo(a.length));
  final alternation = sorted.map(_escapeRegExp).join('|');
  return RegExp('(?<![A-Za-z0-9])@($alternation)(?![a-zA-Z0-9_-])');
}

List<String> _candidatesFor(
  List<String> knownUsernames,
  String myUsername,
  bool allowAll,
) {
  final names = <String>{...knownUsernames};
  if (myUsername.isNotEmpty) names.add(myUsername);
  if (allowAll) names.add('all');
  return names.toList();
}

/// Splits the body into plain text and the mention tokens that address the
/// current user (or `@all` in a group). Other valid mentions stay plain text —
/// only mentions of me are highlighted.
List<BodySegment> splitMentions(
  String body,
  List<String> knownUsernames,
  String myUsername,
  bool allowAll,
) {
  final regex = _buildMentionRegExp(
    _candidatesFor(knownUsernames, myUsername, allowAll),
  );
  if (regex == null) return [BodySegment('text', body, 0)];

  final segments = <BodySegment>[];
  var lastIndex = 0;
  for (final match in regex.allMatches(body)) {
    final token = match.group(1) ?? '';
    final isMine = token == myUsername || (allowAll && token == 'all');
    if (!isMine) continue;
    final start = match.start;
    if (start > lastIndex) {
      segments.add(BodySegment('text', body.substring(lastIndex, start), lastIndex));
    }
    segments.add(BodySegment('mention', '@$token', start));
    lastIndex = match.end;
  }
  if (lastIndex < body.length) {
    segments.add(BodySegment('text', body.substring(lastIndex), lastIndex));
  }
  return segments.isNotEmpty ? segments : [BodySegment('text', body, 0)];
}

/// Whether the body mentions the current user (or `@all` in a group).
bool mentionsMe(
  String body,
  List<String> knownUsernames,
  String myUsername,
  bool allowAll,
) => splitMentions(body, knownUsernames, myUsername, allowAll)
      .any((segment) => segment.isMention);

/// The `@username` token ending immediately before [cursor], if any — used by
/// the composer to drive the group mention autocomplete.
String? mentionTokenBefore(String body, int cursor) {
  if (cursor < 1 || cursor > body.length) return null;
  var i = cursor;
  while (i > 0 && _usernameChar.hasMatch(body[i - 1])) {
    i--;
  }
  if (i == cursor) return null;
  // The token must start right after `@`.
  if (i == 0 || body[i - 1] != '@') return null;
  if (i - 2 >= 0 && _usernameChar.hasMatch(body[i - 2])) return null;
  return body.substring(i, cursor);
}
