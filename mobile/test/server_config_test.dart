// Server-address setting: `ServerConfig` round trip (default → validation →
// persistence) and the auth-screen flow — bad input is rejected inline while
// a valid save persists the address and makes the app rebuild its
// `ChatController` against the new host.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/main.dart';
import 'package:scattered_keyhole/src/net/server_config.dart';
import 'package:scattered_keyhole/src/net/socket_service.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'ui_test_support.dart';

const String _lanUrl = 'http://192.168.1.5:3000';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('ServerConfig', () {
    test('falls back to the default address when nothing is saved', () async {
      expect(await ServerConfig.load(), SocketService.defaultUrl);
    });

    test('rejects empty and off-scheme input', () {
      expect(ServerConfig.validationError(''), 'Server address is required');
      expect(
        ServerConfig.validationError('   '),
        'Server address is required',
      );
      expect(
        ServerConfig.validationError('192.168.1.5:3000'),
        'Address must start with http:// or https://',
      );
      expect(
        ServerConfig.validationError('ftp://host:3000'),
        'Address must start with http:// or https://',
      );
      // Degenerate input that normalizes down to the bare scheme.
      expect(ServerConfig.validationError('http://'), isNotNull);
    });

    test('persists a valid address trimmed of whitespace and trailing /',
        () async {
      const raw = '  $_lanUrl/  ';
      expect(ServerConfig.validationError(raw), isNull);

      await ServerConfig.save(ServerConfig.normalize(raw));

      expect(await ServerConfig.load(), _lanUrl);
    });
  });

  group('auth screen server row', () {
    late List<String> builtUrls;
    late List<FakeSocketService> builtSockets;

    ChatController factory(String serverUrl) {
      builtUrls.add(serverUrl);
      final fake = FakeSocketService();
      builtSockets.add(fake);
      return makeController(fake);
    }

    /// Pumps the app the way a phone launch does: no server URL given, so it
    /// resolves the persisted one (splash frame) before building a controller.
    Future<void> pumpAppUnderTest(WidgetTester tester) async {
      usePhoneSize(tester);
      await tester.pumpWidget(ScatteredKeyholeApp(controllerFactory: factory));
      await tester.pumpAndSettle();
    }

    /// Scrolls the row into view (it sits below the fold) and taps it.
    Future<void> tapVisible(WidgetTester tester, Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    /// Unmounts the app, which disposes the controller it owns.
    Future<void> closeApp(WidgetTester tester) =>
        tester.pumpWidget(const SizedBox());

    setUp(() {
      builtUrls = <String>[];
      builtSockets = <FakeSocketService>[];
    });

    testWidgets('starts on the default address when nothing is persisted',
        (tester) async {
      await pumpAppUnderTest(tester);

      expect(builtUrls, [SocketService.defaultUrl]);
      expect(find.byKey(const Key('server-address-toggle')), findsOneWidget);
      expect(find.text(SocketService.defaultUrl), findsOneWidget);
      // The editor stays collapsed so the sign-in flow is undisturbed.
      expect(find.byKey(const Key('server-address-editor')), findsNothing);

      await closeApp(tester);
    });

    testWidgets('invalid input is rejected inline and changes nothing',
        (tester) async {
      await pumpAppUnderTest(tester);

      await tapVisible(tester, find.byKey(const Key('server-address-toggle')));
      final input = find.byKey(const Key('server-address-input'));
      expect(
        tester.widget<TextField>(input).controller!.text,
        SocketService.defaultUrl,
      );

      // Empty input.
      await tester.enterText(input, '   ');
      await tapVisible(tester, find.byKey(const Key('server-address-save')));
      expect(find.text('Server address is required'), findsOneWidget);

      // Missing/foreign scheme.
      await tester.enterText(input, '192.168.1.5:3000');
      await tapVisible(tester, find.byKey(const Key('server-address-save')));
      expect(
        find.text('Address must start with http:// or https://'),
        findsOneWidget,
      );

      // The editor stays open, nothing was persisted and the controller that
      // is already in use was not swapped out.
      expect(find.byKey(const Key('server-address-editor')), findsOneWidget);
      expect(builtUrls, [SocketService.defaultUrl]);
      expect(await ServerConfig.load(), SocketService.defaultUrl);
      expect(builtSockets.single.disconnectCalled, isFalse);

      await closeApp(tester);
    });

    testWidgets('a valid save persists the address and recreates the '
        'controller against it', (tester) async {
      await pumpAppUnderTest(tester);
      expect(builtUrls, [SocketService.defaultUrl]);

      await tapVisible(tester, find.byKey(const Key('server-address-toggle')));
      // Trailing slash is stripped on the way in.
      await tester.enterText(
        find.byKey(const Key('server-address-input')),
        '$_lanUrl/',
      );
      await tapVisible(tester, find.byKey(const Key('server-address-save')));

      // Persisted normalized address…
      expect(await ServerConfig.load(), _lanUrl);
      // …and a brand-new controller was built against it.
      expect(builtUrls, [SocketService.defaultUrl, _lanUrl]);
      // The superseded controller was disposed (it disconnected its socket).
      expect(builtSockets.first.disconnectCalled, isTrue);
      expect(builtSockets.last.disconnectCalled, isFalse);
      // The row collapsed and now advertises the new address.
      expect(find.byKey(const Key('server-address-editor')), findsNothing);
      expect(find.byKey(const Key('server-address-toggle')), findsOneWidget);
      expect(find.text(_lanUrl), findsOneWidget);

      await closeApp(tester);
    });
  });
}
