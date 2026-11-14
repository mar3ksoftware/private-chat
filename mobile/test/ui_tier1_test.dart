// Widget coverage for the Tier-1 UI: typing line, reply/edit context bars,
// long-press menu, delete dialog, reaction picker and pills, tombstone and
// `(edited)` labels, read ticks, unread badges, group autocomplete, DM
// header profiles and the profile editor.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/ui/widgets/message_bubble.dart';
import 'package:scattered_keyhole/src/ui/widgets/message_composer.dart';

import 'ui_test_support.dart';

void main() {
  late FakeSocketService fake;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    controller = makeController(fake);
  });

  tearDown(() => controller.dispose());

  Future<void> pumpChatApp(WidgetTester tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    setUsers(fake, const <UserInfo>[meInfo, aliceInfo, bobInfo]);
    await tester.pumpAndSettle();
  }

  Future<void> openPrivateConversation(
    WidgetTester tester, {
    String peer = 'alice',
  }) async {
    await pumpChatApp(tester);
    await tester.tap(find.text(peer));
    await tester.pumpAndSettle();
  }

  /// Wraps a bare bubble in a minimal app so long-presses and sheets work.
  Future<void> pumpBubble(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: ListView(children: [child])),
      ),
    );
  }

  group('typing line (C1 / D)', () {
    testWidgets('shows “{name} is typing…” for the open DM and hides again',
        (tester) async {
      await openPrivateConversation(tester);

      fake.fire(
        ChatEvents.typingChanged,
        const TypingChangedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          active: true,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('typing-line')), findsOneWidget);
      expect(find.text('alice is typing…'), findsOneWidget);

      fake.fire(
        ChatEvents.typingChanged,
        const TypingChangedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          active: false,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('typing-line')), findsNothing);
    });

    testWidgets('uses the sender display name and auto-hides after 6 s',
        (tester) async {
      await openPrivateConversation(tester);
      fake.fire(
        ChatEvents.profileUpdated,
        const ProfileUpdatedPayload(
          username: 'alice',
          displayName: 'Alice A',
          status: 'Busy',
        ),
      );
      fake.fire(
        ChatEvents.typingChanged,
        const TypingChangedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          active: true,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Alice A is typing…'), findsOneWidget);

      // The 6 s window elapses without an active:false — it hides anyway.
      await tester.pump(const Duration(milliseconds: 6100));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('typing-line')), findsNothing);
    });
  });

  group('composer typing callbacks (C1)', () {
    testWidgets('typing emits typing:send; clearing the input stops it',
        (tester) async {
      await openPrivateConversation(tester);
      expect(fake.countOf(ChatEvents.typingSend), 0);

      await tester.enterText(find.byType(TextField), 'hello');
      await tester.pump();
      final first = fake
          .payloadsOf(ChatEvents.typingSend)
          .cast<TypingSendPayload>();
      expect(first, hasLength(1));
      expect(first.single.active, isTrue);
      expect(first.single.to, 'alice');

      await tester.enterText(find.byType(TextField), '');
      await tester.pump();
      final last = fake
          .payloadsOf(ChatEvents.typingSend)
          .last as TypingSendPayload;
      expect(last.active, isFalse);
    });
  });

  group('reply context bar (C4)', () {
    testWidgets('long-press → Reply shows author + excerpt; ✕ clears it',
        (tester) async {
      await openPrivateConversation(tester);
      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: DateTime(2026, 3, 5, 9, 30).millisecondsSinceEpoch,
      );
      await tester.pumpAndSettle();

      await tester.longPress(find.text('[Encrypted]'));
      await tester.pumpAndSettle();
      expect(find.text('Reply'), findsOneWidget);

      await tester.tap(find.text('Reply'));
      await tester.pumpAndSettle();
      final bar = find.byKey(const Key('reply-context-bar'));
      expect(bar, findsOneWidget);
      expect(find.text('alice'), findsWidgets);
      expect(find.text('[Encrypted]'), findsWidgets);

      await tester.tap(find.byTooltip('Cancel'));
      await tester.pumpAndSettle();
      expect(bar, findsNothing);
    });
  });

  group('edit context bar (C6)', () {
    testWidgets('the Edit menu item reports the message to the screen',
        (tester) async {
      MessageView? edited;
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'draft body',
          isOwn: true,
          id: 'edit-msg',
          body: 'draft body',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onEdit: (view) => edited = view,
        ),
      );
      signIn(fake);

      await tester.longPress(find.text('draft body'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Edit'));
      await tester.pumpAndSettle();
      expect(edited, isNotNull);
      expect(edited!.id, 'edit-msg');
      expect(edited!.body, 'draft body');
    });

    testWidgets('the composer prefills from editingBody and the bar cancels',
        (tester) async {
      var cancelled = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MessageComposer(
              enabled: true,
              onSend: (_) async => true,
              editingBody: 'original draft',
              onCancelEdit: () => cancelled = true,
            ),
          ),
        ),
      );
      expect(find.byKey(const Key('edit-context-bar')), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'original draft',
      );

      await tester.tap(find.byTooltip('Cancel'));
      await tester.pump();
      expect(cancelled, isTrue);
    });
  });

  group('long-press menu (C4–C6)', () {
    testWidgets('own messages offer Reply, React, Edit and Delete',
        (tester) async {
      signIn(fake);
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'mine',
          isOwn: true,
          id: 'm-own',
          body: 'mine',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
          onEdit: (_) {},
        ),
      );

      await tester.longPress(find.text('mine'));
      await tester.pumpAndSettle();
      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('React'), findsOneWidget);
      expect(find.text('Edit'), findsOneWidget);
      expect(find.text('Delete'), findsOneWidget);
    });

    testWidgets('peer messages offer Reply and React but never Edit/Delete',
        (tester) async {
      signIn(fake);
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'theirs',
          isOwn: false,
          sender: 'alice',
          id: 'm-peer',
          body: 'theirs',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
          onEdit: (_) {},
        ),
      );

      await tester.longPress(find.text('theirs'));
      await tester.pumpAndSettle();
      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('React'), findsOneWidget);
      expect(find.text('Edit'), findsNothing);
      expect(find.text('Delete'), findsNothing);
    });

    testWidgets('tombstones expose no menu at all', (tester) async {
      signIn(fake);
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'gone',
          isOwn: true,
          id: 'm-gone',
          deleted: true,
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
          onEdit: (_) {},
        ),
      );

      await tester.longPress(find.text('This message was deleted'));
      await tester.pumpAndSettle();
      expect(find.text('Reply'), findsNothing);
      expect(find.text('React'), findsNothing);
      expect(find.text('Edit'), findsNothing);
      expect(find.text('Delete'), findsNothing);
    });
  });

  group('delete confirmation (C6 / D)', () {
    testWidgets('shows the frozen dialog strings; Cancel closes without action',
        (tester) async {
      signIn(fake);
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'delete me',
          isOwn: true,
          id: 'm-del',
          body: 'delete me',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
          onEdit: (_) {},
        ),
      );

      await tester.longPress(find.text('delete me'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(find.text('Delete message for everyone?'), findsOneWidget);
      expect(find.text('Delete'), findsWidgets);
      expect(find.text('Cancel'), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Delete message for everyone?'), findsNothing);
    });
  });

  group('reactions (C5)', () {
    testWidgets('the quick-picker offers the frozen emoji order',
        (tester) async {
      signIn(fake);
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'react to me',
          isOwn: true,
          id: 'm-react',
          body: 'react to me',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
          onEdit: (_) {},
        ),
      );

      await tester.longPress(find.text('react to me'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('React'));
      await tester.pumpAndSettle();

      final order = tester
          .widgetList<Text>(find.byType(Text))
          .map((text) => text.data)
          .where((data) => data != null && reactionEmojis.contains(data))
          .toList();
      expect(order, reactionEmojis);

      // Picking an emoji emits the optimistic reaction.
      await tester.tap(find.text('👍'));
      await tester.pumpAndSettle();
      final payload = fake.payloadsOf(ChatEvents.messageReact).single
          as MessageReactPayload;
      expect(payload.emoji, '👍');
      expect(payload.active, isTrue);
      expect(payload.targetId, 'm-react');
    });

    testWidgets('pills render counts and tapping our own pill removes it',
        (tester) async {
      signIn(fake);
      // Seed the controller's aggregate (the toggle consults it, not the
      // widget's own map): me + bob on 👍, alice on ❤️.
      for (final entry in <(String, String)>[
        ('me', '👍'),
        ('bob', '👍'),
        ('alice', '❤️'),
      ]) {
        fake.fire(
          ChatEvents.messageReacted,
          MessageReactedPayload(
            from: 'u-${entry.$1}',
            fromUsername: entry.$1,
            to: 'me',
            targetId: 'm-pill',
            emoji: entry.$2,
            active: true,
            timestamp: 1,
          ),
        );
      }
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'pilled',
          isOwn: false,
          sender: 'alice',
          id: 'm-pill',
          body: 'pilled',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          reactions: controller.reactionsFor('m-pill'),
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
        ),
      );

      expect(find.text('👍'), findsOneWidget);
      expect(find.text('2'), findsOneWidget); // multi-user count
      expect(find.text('❤️'), findsOneWidget);
      expect(find.text('1'), findsNothing); // single reactors stay bare

      await tester.tap(find.text('👍'));
      await tester.pump();
      final payload = fake.payloadsOf(ChatEvents.messageReact).single
          as MessageReactPayload;
      expect(payload.emoji, '👍');
      expect(payload.active, isFalse);
    });
  });

  group('bubble labels (C6 / D)', () {
    testWidgets('tombstones render the frozen deleted string', (tester) async {
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'something',
          isOwn: false,
          sender: 'alice',
          deleted: true,
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
        ),
      );
      expect(find.text('This message was deleted'), findsOneWidget);
      expect(find.text('something'), findsNothing);
      // The sender and timestamp line survive the tombstone.
      expect(find.text('alice'), findsOneWidget);
      expect(find.text('12:00'), findsOneWidget);
    });

    testWidgets('edited messages append the frozen (edited) label',
        (tester) async {
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'before',
          body: 'after',
          isOwn: true,
          edited: true,
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
        ),
      );
      expect(find.text('after'), findsOneWidget);
      expect(find.text(' (edited)'), findsOneWidget);
    });
  });

  group('read ticks (C2)', () {
    testWidgets('own DM bubbles show ✓ until the receipt covers them',
        (tester) async {
      final timestamp = DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch;
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'sent',
          isOwn: true,
          timestamp: timestamp,
          readState: MessageReadState.sent,
        ),
      );
      expect(find.text('✓'), findsOneWidget);
      expect(find.text('✓✓'), findsNothing);
    });

    testWidgets('a covering receipt flips the tick to accent ✓✓', (tester) async {
      final timestamp = DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch;
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'read',
          isOwn: true,
          timestamp: timestamp,
          readState: MessageReadState.read,
        ),
      );
      expect(find.text('✓✓'), findsOneWidget);
      expect(find.text('✓'), findsNothing);
    });
  });

  group('unread badges (C7 / D)', () {
    testWidgets('closed-conversation counts badge the row; opening clears',
        (tester) async {
      await pumpChatApp(tester);
      expect(find.byKey(const Key('unread-badge')), findsNothing);

      for (var i = 0; i < 3; i++) {
        receivePrivate(
          fake,
          from: 'alice',
          fromUserId: 'u-alice',
          toUsername: 'me',
          timestamp: 100 + i,
        );
      }
      await tester.pumpAndSettle();
      expect(find.text('3'), findsOneWidget);

      await tester.tap(find.text('alice'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('unread-badge')), findsNothing);
    });

    testWidgets('counts above 99 collapse to the frozen 99+ label',
        (tester) async {
      await pumpChatApp(tester);
      for (var i = 0; i < 105; i++) {
        receivePrivate(
          fake,
          from: 'bob',
          fromUserId: 'u-bob',
          toUsername: 'me',
          timestamp: 1000 + i,
        );
      }
      await tester.pumpAndSettle();
      expect(find.text('99+'), findsOneWidget);
    });
  });

  group('group @ autocomplete (C8)', () {
    testWidgets('typing @ lists group members; tapping inserts username + space',
        (tester) async {
      usePhoneSize(tester);
      await pumpApp(tester, controller);
      signIn(fake);
      setUsers(fake, const <UserInfo>[meInfo, aliceInfo, bobInfo]);
      setGroups(fake, <GroupInfo>[groupInfo()]);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Groups (1)'));
      await tester.pump();
      await tester.tap(find.text('Team'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), '@a');
      await tester.pumpAndSettle();
      final popup = find.byKey(const Key('mention-autocomplete'));
      expect(popup, findsOneWidget);
      expect(
        find.descendant(of: popup, matching: find.text('alice')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: popup, matching: find.text('bob')),
        findsNothing, // prefix filter: only candidates starting with 'a'
      );

      await tester.tap(find.byKey(const Key('mention-suggestion-alice')));
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '@alice ',
      );
      expect(popup, findsNothing);
      controller.stopTyping();
      await tester.pump();
    });

    testWidgets('the DM composer never autocompletes mentions', (tester) async {
      await openPrivateConversation(tester);
      await tester.enterText(find.byType(TextField), '@a');
      await tester.pump();
      expect(find.byKey(const Key('mention-autocomplete')), findsNothing);
      controller.stopTyping();
      await tester.pump();
    });
  });

  group('profiles in the UI (C9)', () {
    testWidgets('DM header and list row show displayName + status subtitle',
        (tester) async {
      await pumpChatApp(tester);

      // Before any profile: plain username, no subtitle.
      await tester.tap(find.text('alice'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('chat-header-title'))).data,
        'alice',
      );
      expect(find.byKey(const Key('chat-header-subtitle')), findsNothing);
      await tester.tap(find.byTooltip('Back to conversations'));
      await tester.pumpAndSettle();

      fake.fire(
        ChatEvents.profileUpdated,
        const ProfileUpdatedPayload(
          username: 'alice',
          displayName: 'Alice A',
          status: 'In a meeting',
        ),
      );
      await tester.pumpAndSettle();
      // The conversation list row switches to the display name.
      expect(find.text('Alice A'), findsOneWidget);
      expect(find.text('alice'), findsOneWidget); // username subtitle

      await tester.tap(find.text('Alice A'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('chat-header-title'))).data,
        'Alice A',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('chat-header-subtitle'))).data,
        'In a meeting',
      );
    });

    testWidgets('the profile editor validates inline then saves',
        (tester) async {
      await pumpChatApp(tester);
      await tester.tap(find.byIcon(Icons.manage_accounts_outlined));
      await tester.pumpAndSettle();

      expect(find.text('Display name'), findsOneWidget);
      expect(find.text('Status'), findsOneWidget);

      // Too long: the frozen inline error, nothing sent.
      await tester.enterText(
        find.byKey(const Key('profile-display-name')),
        'a' * 33,
      );
      await tester.tap(find.byTooltip('Save profile'));
      await tester.pump();
      expect(
        find.text('Display name is too long (max 32).'),
        findsOneWidget,
      );
      expect(fake.countOf(ChatEvents.profileUpdate), 0);

      // Valid values: profile:update goes out and the sheet closes.
      await tester.enterText(
        find.byKey(const Key('profile-display-name')),
        'Zed',
      );
      await tester.enterText(find.byKey(const Key('profile-status')), 'Away');
      await tester.tap(find.byTooltip('Save profile'));
      await tester.pumpAndSettle();
      final payload = fake.payloadsOf(ChatEvents.profileUpdate).single
          as ProfileUpdatePayload;
      expect(payload.displayName, 'Zed');
      expect(payload.status, 'Away');
      expect(find.byKey(const Key('profile-display-name')), findsNothing);
      expect(controller.displayNameOf('me'), 'Zed');
    });
  });
}
