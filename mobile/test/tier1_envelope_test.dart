// Envelope v2 (C3) and reply refs (C4): the parse matrix, the send-side
// wrapper and excerpt construction — pure utils, no controller involved.

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/utils/envelope.dart';

void main() {
  group('parseEnvelope (spec C3 parse rules)', () {
    test('`{t:text,b}` without reply parses to text with a null reply', () {
      final parsed = parseEnvelope('{"t":"text","b":"hello there"}');
      expect(parsed.isText, isTrue);
      expect(parsed.text, 'hello there');
      expect(parsed.reply, isNull);
      expect(parsed.isRaw, isFalse);
      expect(parsed.isMedia, isFalse);
    });

    test('`{t:text,b,r}` carries the reply ref {id,u,e}', () {
      final parsed = parseEnvelope(
        '{"t":"text","b":"re: hello","r":'
        '{"id":"11111111-2222-4333-8444-555555555555",'
        '"u":"alice","e":"hello there"}}',
      );
      expect(parsed.isText, isTrue);
      expect(parsed.text, 're: hello');
      expect(parsed.reply, <String, String>{
        'id': '11111111-2222-4333-8444-555555555555',
        'u': 'alice',
        'e': 'hello there',
      });
    });

    test('a malformed reply ref drops the ref but keeps the body', () {
      final parsed = parseEnvelope(
        '{"t":"text","b":"x","r":{"id":123,"u":"alice","e":"y"}}',
      );
      expect(parsed.isText, isTrue);
      expect(parsed.text, 'x');
      expect(parsed.reply, isNull);
    });

    test('legacy raw text (JSON parse failure) renders as-is', () {
      final parsed = parseEnvelope('just plain text');
      expect(parsed.isRaw, isTrue);
      expect(parsed.raw, 'just plain text');
      expect(parsed.text, isNull);
    });

    test('a valid media envelope resolves to the descriptor', () {
      final envelope = '{"t":"media","v":1,'
          '"fileId":"123e4567-e89b-42d3-a456-426614174000",'
          '"key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",'
          '"iv":"AAAAAAAAAAAAAAAA",'
          '"sha256":"ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",'
          '"mime":"image/png","size":12,"name":"photo.png"}';
      final parsed = parseEnvelope(envelope);
      expect(parsed.isMedia, isTrue);
      expect(parsed.media, isNotNull);
      expect(parsed.media!.name, 'photo.png');
      expect(parsed.isText, isFalse);
    });

    test('a valid JSON value that is not an object renders raw', () {
      final parsed = parseEnvelope('"just a string"');
      expect(parsed.isRaw, isTrue);
      expect(parsed.raw, '"just a string"');
    });

    test('an unknown `t` falls back to the raw string', () {
      final parsed = parseEnvelope('{"t":"mystery","b":"ignored"}');
      expect(parsed.isRaw, isTrue);
      expect(parsed.raw, '{"t":"mystery","b":"ignored"}');
      expect(parsed.text, isNull);
    });

    test('a `text` envelope without a string body renders raw', () {
      final parsed = parseEnvelope('{"t":"text","b":42}');
      expect(parsed.isRaw, isTrue);
      expect(parsed.text, isNull);
    });
  });

  group('wrapTextEnvelope (spec C3 send rule)', () {
    test('always wraps plain text as `{t:text, b}`', () {
      final wrapped = wrapTextEnvelope('hi');
      expect(wrapped, '{"t":"text","b":"hi"}');
      final parsed = parseEnvelope(wrapped);
      expect(parsed.isText, isTrue);
      expect(parsed.text, 'hi');
      expect(parsed.reply, isNull);
    });

    test('includes the reply ref only when one is given', () {
      final ref = buildReplyRef(
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        username: 'alice',
        excerpt: 'the original body',
      );
      final wrapped = wrapTextEnvelope('reply body', ref);
      final parsed = parseEnvelope(wrapped);
      expect(parsed.text, 'reply body');
      expect(parsed.reply, ref);
    });
  });

  group('reply refs and excerpts (spec C4)', () {
    test('buildReplyRef keeps id, author username and excerpt', () {
      final ref = buildReplyRef(
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        username: 'bob',
        excerpt: 'short quote',
      );
      expect(ref, <String, String>{
        'id': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        'u': 'bob',
        'e': 'short quote',
      });
    });

    test('excerpts up to 140 chars pass through untouched', () {
      final body = 'x' * 140;
      expect(excerptOf(body), body);
      expect(excerptOf(body).length, 140);
    });

    test('excerpts longer than 140 chars are truncated to 140', () {
      final excerpt = replyExcerptFor('y' * 300);
      expect(excerpt.length, 140);
      expect(excerpt, 'y' * 140);
    });

    test('media targets quote the file name', () {
      expect(
        replyExcerptFor('irrelevant', mediaName: 'holiday.png'),
        'holiday.png',
      );
    });

    test('an unnamed media target quotes "Attachment"', () {
      expect(replyExcerptFor('body', mediaName: ''), 'Attachment');
      expect(replyExcerptFor('body', mediaName: null), 'body');
    });
  });
}
