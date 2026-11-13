// Tier-1 controller behavior (spec C1–C9): reactions with rollback, edit
// guards and tombstones, unread rules, typing bursts, read receipts and
// profile updates — exercised through the shared fake SocketService.

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/crypto/e2ee_session.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/utils/envelope.dart';

import 'ui_test_support.dart';

Future<void> waitFor(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Timed out waiting for condition');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

void main() {
  late FakeSocketService fake;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    controller = makeController(fake);
    signIn(fake);
    setUsers(fake, const <UserInfo>[meInfo, aliceInfo, bobInfo]);
  });

  tearDown(() => controller.dispose());

  /// Derives a shared key between the controller and [peer]'s session, the
  /// way the key exchange does over the wire (controller signs in as `me`).
  Future<void> establishKeyWith(E2eeSession peer, String peerUsername) async {
    final peerPublicKey = await peer.getPublicKey();
    fake.fire(
      ChatEvents.e2eePublicKey,
      E2eePublicKeyRelay(
        from: 'u-$peerUsername',
        fromUsername: peerUsername,
        publicKey: peerPublicKey,
      ),
    );
    await waitFor(() => controller.e2ee.hasSharedKey(peerUsername));
    final myPublicKey = await controller.e2ee.getPublicKey();
    await peer.deriveSharedSecret('me', myPublicKey);
  }

  /// Sends [body] to alice and delivers the server's echo so the message
  /// lands in our own-message bucket with a known id.
  Future<String> sendOwnMessage(
    String body, {
    String id = 'own-1',
    int timestamp = 1000,
  }) async {
    if (!controller.e2ee.hasSharedKey('alice')) {
      await establishKeyWith(E2eeSession(), 'alice');
    }
    expect(await controller.sendMessage('alice', body), isTrue);
    final payload =
        fake.payloadsOf(ChatEvents.messageSend).last as EncryptedMessagePayload;
    fake.fire(
      ChatEvents.privateMessage,
      PrivateMessage(
        id: id,
        from: 'u-me',
        fromUsername: 'me',
        to: 'u-alice',
        toUsername: 'alice',
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        timestamp: timestamp,
      ),
    );
    await waitFor(
      () => controller
          .messagesForPeer('alice')
          .any((message) => message.id == id && message.body == body),
    );
    return id;
  }

  /// Delivers a message authored by alice, encrypted for us. Pass [session]
  /// to keep using an established session for later payload encryption.
  Future<String> receiveAliceMessage(
    String body, {
    String id = 'in-1',
    E2eeSession? session,
  }) async {
    final aliceSession = session ?? E2eeSession();
    await establishKeyWith(aliceSession, 'alice');
    final payload = await aliceSession.encrypt(
      'me',
      wrapTextEnvelope(body),
    );
    fake.fire(
      ChatEvents.privateMessage,
      PrivateMessage(
        id: id,
        from: 'u-alice',
        fromUsername: 'alice',
        to: 'u-me',
        toUsername: 'me',
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        timestamp: 700,
      ),
    );
    await waitFor(
      () => controller
          .messagesForPeer('alice')
          .any((message) => message.id == id && message.body == body),
    );
    return id;
  }

  group('reactions (C5)', () {
    test('optimistic toggle adds locally and emits message:react active',
        () {
      controller.toggleReaction(
        const ConversationTarget.dm('alice'),
        'msg-1',
        '👍',
      );
      final payload = fake.payloadsOf(ChatEvents.messageReact).single
          as MessageReactPayload;
      expect(payload.to, 'alice');
      expect(payload.groupId, isNull);
      expect(payload.targetId, 'msg-1');
      expect(payload.emoji, '👍');
      expect(payload.active, isTrue);
      expect(controller.reactionsFor('msg-1')['👍'], <String>{'me'});
    });

    test('toggling again removes ours and emits active:false', () {
      const target = ConversationTarget.dm('alice');
      controller.toggleReaction(target, 'msg-1', '👍');
      controller.toggleReaction(target, 'msg-1', '👍');
      final payloads = fake
          .payloadsOf(ChatEvents.messageReact)
          .cast<MessageReactPayload>();
      expect(payloads, hasLength(2));
      expect(payloads.last.active, isFalse);
      expect(controller.reactionsFor('msg-1')['👍'], isNull);
    });

    test('relayed reactions aggregate per emoji across users', () {
      fake.fire(
        ChatEvents.messageReacted,
        const MessageReactedPayload(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'me',
          targetId: 'msg-1',
          emoji: '❤️',
          active: true,
          timestamp: 1,
        ),
      );
      fake.fire(
        ChatEvents.messageReacted,
        const MessageReactedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          targetId: 'msg-1',
          emoji: '❤️',
          active: true,
          timestamp: 2,
        ),
      );
      expect(
        controller.reactionsFor('msg-1')['❤️'],
        <String>{'bob', 'alice'},
      );
      // A removal drops only that user.
      fake.fire(
        ChatEvents.messageReacted,
        const MessageReactedPayload(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'me',
          targetId: 'msg-1',
          emoji: '❤️',
          active: false,
          timestamp: 3,
        ),
      );
      expect(controller.reactionsFor('msg-1')['❤️'], <String>{'alice'});
    });

    test('message_rejected rolls the optimistic reaction back', () {
      controller.toggleReaction(
        const ConversationTarget.dm('alice'),
        'msg-1',
        '😂',
      );
      expect(controller.reactionsFor('msg-1')['😂'], <String>{'me'});
      fake.fire(
        ChatEvents.messageRejected,
        const MessageRejectedPayload(reason: 'Rate limit exceeded'),
      );
      expect(controller.reactionsFor('msg-1'), isEmpty);
    });
  });

  group('unread counters (C7)', () {
    const aliceDm = ConversationTarget.dm('alice');

    test('an incoming message in a closed conversation counts', () {
      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: 100,
      );
      expect(controller.unreadBadgeFor(aliceDm), '1');
      expect(controller.unreadFor(aliceDm).count, 1);
      expect(controller.hasMentionFor(aliceDm), isFalse);
    });

    test('the open conversation while focused does not count', () {
      controller.selectPeer('alice');
      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: 101,
      );
      expect(controller.unreadBadgeFor(aliceDm), isNull);
      expect(controller.unreadFor(aliceDm).count, 0);
    });

    test('the open conversation while backgrounded counts', () {
      controller.selectPeer('alice');
      controller.setAppFocused(false);
      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: 102,
      );
      expect(controller.unreadBadgeFor(aliceDm), '1');
      // Regaining focus clears the open conversation again.
      controller.setAppFocused(true);
      expect(controller.unreadBadgeFor(aliceDm), isNull);
    });

    test('opening the conversation clears its counter', () {
      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: 103,
      );
      expect(controller.unreadBadgeFor(aliceDm), '1');
      controller.selectPeer('alice');
      expect(controller.unreadBadgeFor(aliceDm), isNull);
    });

    test('group conversations count and clear too', () {
      const team = ConversationTarget.group('g-team');
      receiveGroupMessage(
        fake,
        groupId: 'g-team',
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: 200,
      );
      expect(controller.unreadBadgeFor(team), '1');
      controller.selectGroup('g-team');
      expect(controller.unreadBadgeFor(team), isNull);
    });

    test('counts above 99 collapse to the frozen 99+ label', () {
      for (var i = 0; i < 105; i++) {
        receivePrivate(
          fake,
          from: 'alice',
          fromUserId: 'u-alice',
          toUsername: 'me',
          timestamp: 1000 + i,
        );
      }
      expect(controller.unreadFor(aliceDm).count, 105);
      expect(controller.unreadBadgeFor(aliceDm), '99+');
      // Small counts render the plain number.
      receivePrivate(
        fake,
        from: 'bob',
        fromUserId: 'u-bob',
        toUsername: 'me',
        timestamp: 2000,
      );
      expect(controller.unreadBadgeFor(const ConversationTarget.dm('bob')), '1');
    });

    test('a mention of me always increments and flags the conversation', () async {
      final aliceSession = E2eeSession();
      await establishKeyWith(aliceSession, 'alice');
      controller.selectPeer('alice'); // open + focused…
      final payload = await aliceSession.encrypt(
        'me',
        wrapTextEnvelope('@me ping'),
      );
      fake.fire(
        ChatEvents.privateMessage,
        PrivateMessage(
          id: 'mention-1',
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'u-me',
          toUsername: 'me',
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: 300,
        ),
      );
      await waitFor(() => controller.hasMentionFor(aliceDm));
      expect(controller.unreadFor(aliceDm).count, 1);
      expect(controller.unreadBadgeFor(aliceDm), '1');
    });
  });

  group('typing indicators (C1)', () {
    test('the frozen cadence constants are 4 s repeat / 6 s hide', () {
      expect(ChatController.typingRepeatMs, 4000);
      expect(ChatController.typingHideMs, 6000);
    });

    test('outgoing burst: one active emit, throttled repeats, clean stop', () async {
      final localFake = FakeSocketService();
      final fast = ChatController(
        socket: localFake,
        e2ee: E2eeSession(),
        errorClearDelay: const Duration(days: 1),
        sharedKeyTimeoutMs: 50,
        typingRepeatDelay: const Duration(milliseconds: 40),
        typingHideDelay: const Duration(milliseconds: 60),
      );
      addTearDown(fast.dispose);
      signIn(localFake);

      const target = ConversationTarget.dm('alice');
      fast.sendTyping(target);
      fast.sendTyping(target); // repeat within the cadence: throttled
      expect(localFake.countOf(ChatEvents.typingSend), 1);

      await Future<void>.delayed(const Duration(milliseconds: 120));
      final repeats = localFake.countOf(ChatEvents.typingSend);
      expect(repeats, greaterThanOrEqualTo(2));
      final lastBeforeStop = localFake
          .payloadsOf(ChatEvents.typingSend)
          .last as TypingSendPayload;
      expect(lastBeforeStop.active, isTrue);
      expect(lastBeforeStop.to, 'alice');

      fast.stopTyping();
      final afterStop = localFake.countOf(ChatEvents.typingSend);
      final stopPayload = localFake
          .payloadsOf(ChatEvents.typingSend)
          .last as TypingSendPayload;
      expect(stopPayload.active, isFalse);
      fast.stopTyping(); // already idle — no extra emit
      expect(localFake.countOf(ChatEvents.typingSend), afterStop);
    });

    test('incoming active:true shows the name; active:false hides it', () {
      expect(controller.typingUsernamesIn(peer: 'alice'), isEmpty);
      fake.fire(
        ChatEvents.typingChanged,
        const TypingChangedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          active: true,
        ),
      );
      expect(controller.typingUsernamesIn(peer: 'alice'), <String>['alice']);
      fake.fire(
        ChatEvents.typingChanged,
        const TypingChangedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          active: false,
        ),
      );
      expect(controller.typingUsernamesIn(peer: 'alice'), isEmpty);
    });

    test('an indicator auto-hides after the window without active:false',
        () async {
      final localFake = FakeSocketService();
      final fast = ChatController(
        socket: localFake,
        e2ee: E2eeSession(),
        errorClearDelay: const Duration(days: 1),
        sharedKeyTimeoutMs: 50,
        typingRepeatDelay: const Duration(milliseconds: 40),
        typingHideDelay: const Duration(milliseconds: 60),
      );
      addTearDown(fast.dispose);
      signIn(localFake);

      localFake.fire(
        ChatEvents.typingChanged,
        const TypingChangedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          active: true,
        ),
      );
      expect(fast.typingUsernamesIn(peer: 'alice'), <String>['alice']);
      await Future<void>.delayed(const Duration(milliseconds: 120));
      expect(fast.typingUsernamesIn(peer: 'alice'), isEmpty);
    });
  });

  group('read receipts (C2)', () {
    test('outgoing receipts advance but never repeat or regress', () {
      controller.sendReadReceipt('alice', 500);
      controller.sendReadReceipt('alice', 500); // duplicate: suppressed
      controller.sendReadReceipt('alice', 400); // regression: suppressed
      controller.sendReadReceipt('alice', 600); // advance: emitted
      final payloads = fake
          .payloadsOf(ChatEvents.receiptRead)
          .cast<ReceiptReadPayload>();
      expect(payloads, hasLength(2));
      expect(payloads.first.upTo, 500);
      expect(payloads.last.upTo, 600);
      expect(payloads.last.to, 'alice');
    });

    test('an inbound receipt updates readUpToFor; lower values ignored', () {
      fake.fire(
        ChatEvents.receiptReadIn,
        const ReceiptReadRelay(from: 'u-alice', fromUsername: 'alice', upTo: 700),
      );
      expect(controller.readUpToFor('alice'), 700);
      fake.fire(
        ChatEvents.receiptReadIn,
        const ReceiptReadRelay(from: 'u-alice', fromUsername: 'alice', upTo: 650),
      );
      expect(controller.readUpToFor('alice'), 700);
    });

    test('opening a DM while focused sends a receipt up to the newest peer message', () {
      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: 900,
      );
      controller.selectPeer('alice');
      final payloads = fake
          .payloadsOf(ChatEvents.receiptRead)
          .cast<ReceiptReadPayload>();
      expect(payloads, hasLength(1));
      expect(payloads.single.to, 'alice');
      expect(payloads.single.upTo, 900);
    });

    test('an incoming message while the DM is open re-receipts', () {
      controller.selectPeer('alice');
      receivePrivate(
        fake,
        from: 'alice',
        fromUserId: 'u-alice',
        toUsername: 'me',
        timestamp: 950,
      );
      final payloads = fake
          .payloadsOf(ChatEvents.receiptRead)
          .cast<ReceiptReadPayload>();
      expect(payloads, isNotEmpty);
      expect(payloads.last.upTo, 950);
    });
  });

  group('edit and delete (C6)', () {
    test('editing our own message applies locally and emits message:edit', () async {
      final aliceSession = E2eeSession();
      await establishKeyWith(aliceSession, 'alice');
      final id = await sendOwnMessage('original body', id: 'edit-1');

      final sent = await controller.editMessage(
        const ConversationTarget.dm('alice'),
        id,
        'new body',
      );
      expect(sent, isTrue);
      final payload = fake.payloadsOf(ChatEvents.messageEdit).single
          as MessageEditPayload;
      expect(payload.targetId, id);
      expect(payload.to, 'alice');

      final message = controller.messagesForPeer('alice').single;
      expect(message.body, 'new body');
      expect(message.edited, isTrue);

      // The edit travels as a fresh envelope ciphertext.
      final plaintext = await aliceSession.decrypt(
        'me',
        payload.ciphertext,
        payload.iv,
      );
      expect(parseEnvelope(plaintext).text, 'new body');
    });

    test('editing a foreign message is refused without emitting', () async {
      final id = await receiveAliceMessage('alice says', id: 'foreign-1');
      final sent = await controller.editMessage(
        const ConversationTarget.dm('alice'),
        id,
        'not mine',
      );
      expect(sent, isFalse);
      expect(fake.payloadsOf(ChatEvents.messageEdit), isEmpty);
      expect(
        controller.messagesForPeer('alice').single.body,
        'alice says',
      );
    });

    test('editing a tombstone is refused', () async {
      final id = await sendOwnMessage('will be deleted', id: 'edit-2');
      controller.deleteMessage(const ConversationTarget.dm('alice'), id);
      expect(
        await controller.editMessage(
          const ConversationTarget.dm('alice'),
          id,
          'too late',
        ),
        isFalse,
      );
      expect(fake.payloadsOf(ChatEvents.messageEdit), isEmpty);
    });

    test('a relayed edit from the author replaces the body in place', () async {
      final aliceSession = E2eeSession();
      final id = await receiveAliceMessage(
        'before edit',
        id: 'relay-edit',
        session: aliceSession,
      );
      final payload = await aliceSession.encrypt(
        'me',
        wrapTextEnvelope('after edit'),
      );
      fake.fire(
        ChatEvents.messageEdited,
        MessageEditedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          targetId: id,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: 40,
        ),
      );
      await waitFor(
        () => controller.messagesForPeer('alice').single.body == 'after edit',
      );
      expect(controller.messagesForPeer('alice').single.edited, isTrue);
    });

    test('a relayed edit claiming a different author is ignored', () async {
      final aliceSession = E2eeSession();
      final id = await receiveAliceMessage(
        'untouched body',
        id: 'relay-2',
        session: aliceSession,
      );
      final payload = await aliceSession.encrypt(
        'me',
        wrapTextEnvelope('forged body'),
      );
      fake.fire(
        ChatEvents.messageEdited,
        MessageEditedPayload(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'me',
          targetId: id,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: 41,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));
      final message = controller.messagesForPeer('alice').single;
      expect(message.body, 'untouched body');
      expect(message.edited, isFalse);
    });

    test('deleting our own message tombstones it and emits message:delete', () async {
      final id = await sendOwnMessage('delete me', id: 'del-1');
      controller.deleteMessage(const ConversationTarget.dm('alice'), id);
      final payload = fake.payloadsOf(ChatEvents.messageDelete).single
          as MessageDeletePayload;
      expect(payload.targetId, id);
      expect(payload.to, 'alice');
      expect(controller.messagesForPeer('alice').single.deleted, isTrue);
    });

    test('deleting a foreign message is refused', () async {
      final id = await receiveAliceMessage('keep me', id: 'del-2');
      controller.deleteMessage(const ConversationTarget.dm('alice'), id);
      expect(fake.payloadsOf(ChatEvents.messageDelete), isEmpty);
      expect(controller.messagesForPeer('alice').single.deleted, isFalse);
    });

    test('a relayed delete only tombstones when the author matches', () async {
      await receiveAliceMessage('still here', id: 'del-3');
      fake.fire(
        ChatEvents.messageDeleted,
        const MessageDeletedPayload(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'me',
          targetId: 'del-3',
          timestamp: 50,
        ),
      );
      expect(controller.messagesForPeer('alice').single.deleted, isFalse);

      fake.fire(
        ChatEvents.messageDeleted,
        const MessageDeletedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          targetId: 'del-3',
          timestamp: 51,
        ),
      );
      expect(controller.messagesForPeer('alice').single.deleted, isTrue);
    });

    test('group edit fans out one ciphertext per keyed member and applies', () async {
      final aliceSession = E2eeSession();
      await establishKeyWith(aliceSession, 'alice');
      setGroups(fake, <GroupInfo>[groupInfo()]);

      expect(await controller.sendGroupMessage('g-team', 'group original'), isTrue);
      final sent = fake.payloadsOf(ChatEvents.groupMessageSend).last
          as GroupEncryptedPayload;
      fake.fire(
        ChatEvents.groupMessage,
        GroupMessage(
          id: 'g-msg-1',
          groupId: 'g-team',
          from: 'u-me',
          fromUsername: 'me',
          ciphertexts: sent.ciphertexts,
          timestamp: 42,
        ),
      );
      await waitFor(
        () => controller
            .groupMessagesFor('g-team')
            .any((message) => message.body == 'group original'),
      );

      final ok = await controller.editMessage(
        const ConversationTarget.group('g-team'),
        'g-msg-1',
        'group edited',
      );
      expect(ok, isTrue);
      // Only alice shares a key (bob never completed the exchange), so one
      // ciphertext — plus no self copy — goes out.
      final edits = fake
          .payloadsOf(ChatEvents.messageEdit)
          .cast<MessageEditPayload>();
      expect(edits, hasLength(1));
      expect(edits.single.groupId, 'g-team');
      expect(edits.single.targetId, 'g-msg-1');
      final message = controller.groupMessagesFor('g-team').single;
      expect(message.body, 'group edited');
      expect(message.edited, isTrue);
    });
  });

  group('profiles (C9)', () {
    test('a valid update emits profile:update and applies optimistically', () {
      expect(controller.updateProfile('  Cool Name  ', 'At the desk'), isTrue);
      final payload = fake.payloadsOf(ChatEvents.profileUpdate).single
          as ProfileUpdatePayload;
      expect(payload.displayName, 'Cool Name');
      expect(payload.status, 'At the desk');
      expect(controller.displayNameOf('me'), 'Cool Name');
      expect(controller.statusOf('me'), 'At the desk');
    });

    test('an invalid update returns false and emits nothing', () {
      expect(controller.updateProfile('a' * 33, ''), isFalse);
      expect(fake.payloadsOf(ChatEvents.profileUpdate), isEmpty);
      expect(controller.displayNameOf('me'), 'me');
      expect(
        controller.updateProfile('alice', 's' * 81),
        isFalse,
      );
      expect(fake.payloadsOf(ChatEvents.profileUpdate), isEmpty);
    });

    test('profile:updated for another user refreshes the cached profile', () {
      expect(controller.displayNameOf('alice'), 'alice');
      expect(controller.statusOf('alice'), '');
      fake.fire(
        ChatEvents.profileUpdated,
        const ProfileUpdatedPayload(
          username: 'alice',
          displayName: 'Alice A',
          status: 'In a meeting',
        ),
      );
      expect(controller.displayNameOf('alice'), 'Alice A');
      expect(controller.statusOf('alice'), 'In a meeting');
      // Our own entry is untouched by someone else's update.
      expect(controller.displayNameOf('me'), 'me');
    });

    test('message_rejected rolls an optimistic profile back', () {
      expect(controller.updateProfile('Wanted Name', 'Wanted status'), isTrue);
      fake.fire(
        ChatEvents.messageRejected,
        const MessageRejectedPayload(reason: 'bad profile'),
      );
      expect(controller.displayNameOf('me'), 'me');
      expect(controller.statusOf('me'), '');
    });

    test('profiles seeded from active_users fall back to the username', () {
      fake.fire(
        ChatEvents.activeUsers,
        const <UserInfo>[
          UserInfo(userId: 'u-nova', username: 'nova', socketId: 's', joinedAt: 1),
        ],
      );
      expect(controller.displayNameOf('nova'), 'nova');
      expect(controller.statusOf('nova'), '');
    });
  });
}
