// Mention parsing (C8) and profile validation (C9): exact-match rules,
// boundaries, `@all` scoping and the frozen validation strings (spec D).

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/utils/mentions.dart';
import 'package:scattered_keyhole/src/utils/profile.dart';

void main() {
  group('splitMentions / mentionsMe (spec C8)', () {
    const directory = <String>['alice', 'bob', 'alicia'];

    test('an exact @username addressing me becomes a mention segment', () {
      final segments = splitMentions('hey @me look', directory, 'me', false);
      expect(
        segments.map((segment) => (segment.kind, segment.text)),
        <(String, String)>[
          ('text', 'hey '),
          ('mention', '@me'),
          ('text', ' look'),
        ],
      );
      expect(mentionsMe('hey @me look', directory, 'me', false), isTrue);
    });

    test('a longer known username does not bleed across the boundary', () {
      // `@me` inside `@member` must not match (boundary after the token).
      expect(mentionsMe('@member stuff', directory, 'me', false), isFalse);
      // ...and `@alice` must not partially match inside `@alicia`.
      expect(mentionsMe('ping @alicia', directory, 'alice', false), isFalse);
      expect(mentionsMe('ping @alice', directory, 'alice', false), isTrue);
    });

    test('a username glued to non-boundary characters is not a mention', () {
      expect(mentionsMe('x@me', directory, 'me', false), isFalse);
      expect(mentionsMe('a@me', directory, 'me', false), isFalse);
      expect(mentionsMe('@mex', directory, 'me', false), isFalse);
    });

    test('unknown usernames and mentions of others stay plain text', () {
      expect(mentionsMe('@nobody hello', directory, 'me', false), isFalse);
      final segments = splitMentions('cc @alice', directory, 'me', false);
      expect(segments.any((segment) => segment.isMention), isFalse);
      expect(segments.single.text, 'cc @alice');
    });

    test('@all only counts in groups (allowAll), never in DMs', () {
      expect(mentionsMe('@all heads up', directory, 'me', true), isTrue);
      expect(mentionsMe('@all heads up', directory, 'me', false), isFalse);
      final segments = splitMentions('@all hi', directory, 'me', true);
      expect(segments.any((segment) => segment.isMention), isTrue);
      // Same token in a DM stays unhighlighted.
      final dmSegments = splitMentions('@all hi', directory, 'me', false);
      expect(dmSegments.any((segment) => segment.isMention), isFalse);
    });

    test('mention segments carry the token and its body offset', () {
      final segments = splitMentions('yo @me!', directory, 'me', false);
      final mention = segments.firstWhere((segment) => segment.isMention);
      expect(mention.text, '@me');
      expect(mention.start, 3);
    });

    test('an empty directory still highlights @me (self is always known)', () {
      expect(mentionsMe('to @me', const <String>[], 'me', false), isTrue);
      expect(mentionsMe('to @me', const <String>[], '', false), isFalse);
    });
  });

  group('mentionTokenBefore (composer autocomplete, C8)', () {
    test('returns the token right after @ at the cursor', () {
      expect(mentionTokenBefore('hi @al', 6), 'al');
      expect(mentionTokenBefore('hi @alice now', 9), 'alice');
      // A bare `@` with nothing typed yet yields no token.
      expect(mentionTokenBefore('@', 1), isNull);
    });

    test('returns null without an @-anchored token', () {
      expect(mentionTokenBefore('plain text', 6), isNull);
      expect(mentionTokenBefore('hi al', 5), isNull);
      expect(mentionTokenBefore('', 0), isNull);
      // The char before @ must be a boundary too.
      expect(mentionTokenBefore('x@me', 4), isNull);
    });
  });

  group('validateProfile (spec C9 / D strings)', () {
    // A Cc-category control character, built at runtime so the source file
    // stays plain ASCII.
    final bell = String.fromCharCode(7);

    test('a valid profile trims both fields and passes', () {
      final result = validateProfile('  Alice  ', '  Busy coding  ');
      expect(result.isValid, isTrue);
      expect(result.nameError, isNull);
      expect(result.statusError, isNull);
      expect(result.displayName, 'Alice');
      expect(result.status, 'Busy coding');
    });

    test('33-char display names use the exact frozen error', () {
      final result = validateProfile('a' * 33, '');
      expect(result.isValid, isFalse);
      expect(result.nameError, 'Display name is too long (max 32).');
    });

    test('an empty display name is rejected with the same frozen error', () {
      final result = validateProfile('   ', '');
      expect(result.isValid, isFalse);
      expect(result.nameError, 'Display name is too long (max 32).');
    });

    test('32-char display names are accepted', () {
      expect(validateProfile('a' * 32, '').isValid, isTrue);
    });

    test('81-char statuses use the exact frozen error', () {
      final result = validateProfile('alice', 's' * 81);
      expect(result.isValid, isFalse);
      expect(result.statusError, 'Status is too long (max 80).');
    });

    test('80-char and empty statuses are accepted', () {
      expect(validateProfile('alice', 's' * 80).isValid, isTrue);
      expect(validateProfile('alice', '').isValid, isTrue);
      expect(validateProfile('alice', '   ').status, isEmpty);
    });

    test('control characters are rejected in both fields', () {
      expect(
        validateProfile('al${bell}ice', '').nameError,
        'Display name is too long (max 32).',
      );
      expect(
        validateProfile('alice', 'hi$bell there').statusError,
        'Status is too long (max 80).',
      );
    });
  });
}
