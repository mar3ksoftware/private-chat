// Chat screen: bubble styling, encrypted placeholders, the composer flow
// and group-chat sender labels.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/ui/theme/app_theme.dart';
import 'package:scattered_keyhole/src/ui/widgets/message_bubble.dart';

import 'ui_test_support.dart';

void main() {
  group('MessageBubble', () {
    testWidgets('own messages are indigo and right-aligned, peers zinc and left',
        (tester) async {
      final ownTimestamp = DateTime(2026, 3, 5, 14, 7).millisecondsSinceEpoch;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Scaffold(
            body: ListView(
              children: [
                MessageBubble(
                  text: 'on my way',
                  isOwn: true,
                  timestamp: ownTimestamp,
                ),
                MessageBubble(
                  text: 'see you soon',
                  isOwn: false,
                  timestamp: ownTimestamp,
                  sender: 'alice',
                ),
              ],
            ),
          ),
        ),
      );

      // Bubble surfaces.
      final colors = tester
          .widgetList<Container>(find.byType(Container))
          .map((container) => container.decoration)
          .whereType<BoxDecoration>()
          .map((decoration) => decoration.color)
          .whereType<Color>()
          .toList();
      expect(colors, contains(AppColors.accentDeep));
      expect(colors, contains(AppColors.surfaceAlt));

      // Alignment: own bubble ends at the trailing edge, peer at the leading.
      final ownColumn = tester.widget<Column>(
        find.descendant(
          of: find.byWidgetPredicate((widget) =>
              widget is MessageBubble && widget.isOwn),
          matching: find.byType(Column),
        ),
      );
      expect(ownColumn.crossAxisAlignment, CrossAxisAlignment.end);

      final peerColumn = tester.widget<Column>(
        find.descendant(
          of: find.byWidgetPredicate((widget) =>
              widget is MessageBubble && !widget.isOwn),
          matching: find.byType(Column),
        ),
      );
      expect(peerColumn.crossAxisAlignment, CrossAxisAlignment.start);

      // Timestamp and group sender label.
      expect(find.text('14:07'), findsNWidgets(2));
      expect(find.text('alice'), findsOneWidget);
      expect(find.text('on my way'), findsOneWidget);
    });

    testWidgets('undecryptable messages render the encrypted placeholder',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Scaffold(
            body: ListView(
              children: [
                MessageBubble(
                  text: '[Encrypted]',
                  isOwn: false,
                  timestamp: 0,
                  decryptionFailed: true,
                ),
                MessageBubble(
                  text: '[Decryption failed]',
                  isOwn: true,
                  timestamp: 0,
                  decryptionFailed: true,
                ),
              ],
            ),
          ),
        ),
      );

      expect(find.text('[Encrypted]'), findsOneWidget);
      expect(find.text('[Decryption failed]'), findsOneWidget);
      expect(find.byIcon(Icons.lock_outline), findsNWidgets(2));
    });
  });

  group('ChatScreen', () {
    late FakeSocketService fake;
    late ChatController controller;

    setUp(() {
      fake = FakeSocketService();
      controller = makeController(fake);
    });

    tearDown(() => controller.dispose());

    Future<void> openPrivateConversation(WidgetTester tester) async {
      usePhoneSize(tester);
      await pumpApp(tester, controller);
      signIn(fake);
      setUsers(fake, [aliceInfo, bobInfo]);
      await tester.pumpAndSettle();
      await tester.tap(find.text('alice'));
      await tester.pumpAndSettle();
    }

    testWidgets('incoming messages keep the encrypted placeholder',
        (tester) async {
      await openPrivateConversation(tester);

      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: DateTime(2026, 3, 5, 9, 30).millisecondsSinceEpoch,
      );
      receivePrivate(
        fake,
        from: 'me',
        fromUserId: 'u-me',
        toUsername: 'alice',
        timestamp: DateTime(2026, 3, 5, 9, 31).millisecondsSinceEpoch,
      );
      await tester.pumpAndSettle();

      expect(find.text('[Encrypted]'), findsNWidgets(2));
      expect(find.byIcon(Icons.lock_outline), findsNWidgets(2));
      expect(find.text('09:30'), findsOneWidget);
      expect(find.text('09:31'), findsOneWidget);
      expect(find.text('Start of conversation'), findsNothing);
    });

    testWidgets('composer disables when disconnected and reports failed sends',
        (tester) async {
      await openPrivateConversation(tester);

      final sendButton = find.widgetWithText(ElevatedButton, 'Send');
      final input = find.byType(TextField);

      // Empty draft: send is inert.
      expect(tester.widget<ElevatedButton>(sendButton).onPressed, isNull);

      await tester.enterText(input, 'hello there');
      await tester.pump();
      expect(tester.widget<ElevatedButton>(sendButton).onPressed, isNotNull);

      // No shared key yet: the send times out with a local error line and a
      // transient snackbar from the controller.
      await tester.tap(sendButton);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

      expect(find.text('Message not sent. Please try again.'), findsOneWidget);
      expect(find.text('Secure session not ready. Please try again.'),
          findsOneWidget);
      // The draft survives a failed send.
      expect(find.text('hello there'), findsOneWidget);

      // Disconnect: input and button are disabled with a matching hint.
      fake.fire(ChatEvents.disconnect);
      await tester.pump();
      expect(tester.widget<ElevatedButton>(sendButton).onPressed, isNull);
      expect(tester.widget<TextField>(input).enabled, isFalse);
      expect(find.text('Disconnected…'), findsOneWidget);

      // Let the snackbar dismiss so no timers outlive the test.
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
    });

    testWidgets('group chat shows the sender label above peer messages',
        (tester) async {
      usePhoneSize(tester);
      await pumpApp(tester, controller);
      signIn(fake);
      setUsers(fake, [aliceInfo, bobInfo]);
      setGroups(fake, [groupInfo()]);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Groups (1)'));
      await tester.pump();
      await tester.tap(find.text('Team'));
      await tester.pumpAndSettle();

      expect(find.text('Group'), findsOneWidget);
      expect(find.text('Start of conversation'), findsOneWidget);

      receiveGroupMessage(
        fake,
        groupId: 'g-team',
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: DateTime(2026, 3, 5, 10, 0).millisecondsSinceEpoch,
      );
      await tester.pumpAndSettle();

      expect(find.text('[Encrypted]'), findsOneWidget);
      expect(find.text('alice'), findsOneWidget);
      expect(find.text('10:00'), findsOneWidget);
    });

    testWidgets('logout from the pane header (wide) keeps the shell',
        (tester) async {
      useWideSize(tester);
      await pumpApp(tester, controller);
      signIn(fake);
      setUsers(fake, [aliceInfo, bobInfo]);
      await tester.pumpAndSettle();

      await tester.tap(find.text('alice'));
      await tester.pumpAndSettle();
      expect(find.text('Start of conversation'), findsOneWidget);

      await tester.tap(find.text('Logout'));
      await tester.pumpAndSettle();

      expect(controller.me, isNull);
      expect(find.text('End-to-end encrypted'), findsOneWidget);
      expect(find.byIcon(Icons.arrow_back), findsNothing);
    });
  });
}
