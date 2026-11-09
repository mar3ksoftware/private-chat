// Tests for ChatController: message/user upsert semantics, friendly error
// mapping, E2EE send-flow wiring (with real E2eeSession instances), and
// reconnect re-authentication.
//
// The controller is exercised through a fake SocketService, so no server or
// real socket connection is needed; E2EE crypto runs for real.

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:private_chat_mobile/src/crypto/e2ee_session.dart';
import 'package:private_chat_mobile/src/crypto/media_crypto.dart';
import 'package:private_chat_mobile/src/models/models.dart';
import 'package:private_chat_mobile/src/net/chat_events.dart';
import 'package:private_chat_mobile/src/net/media_client.dart';
import 'package:private_chat_mobile/src/net/socket_service.dart';
import 'package:private_chat_mobile/src/state/chat_controller.dart';

import 'ui_test_support.dart' show FakeMediaClient;

/// In-memory [SocketService] that records emits and lets tests fire inbound
/// events directly at the registered listeners.
class FakeSocketService implements SocketService {
  final List<(String, Object?)> emitted = <(String, Object?)>[];
  @override
  bool isConnected = false;
  bool connectCalled = false;
  bool disconnectCalled = false;

  final Map<String, List<void Function(Object?)>> _listeners =
      <String, List<void Function(Object?)>>{};

  /// Payloads recorded for [event], in emission order.
  List<Object?> payloadsOf(String event) {
    return <Object?>[
      for (final (name, payload) in emitted)
        if (name == event) payload,
    ];
  }

  /// How many times [event] was emitted.
  int countOf(String event) {
    var count = 0;
    for (final (name, _) in emitted) {
      if (name == event) count++;
    }
    return count;
  }

  /// Simulates an inbound event (or a lifecycle event) arriving.
  void fire(String event, [Object? payload]) {
    if (event == ChatEvents.connect) isConnected = true;
    if (event == ChatEvents.disconnect || event == ChatEvents.connectError) {
      isConnected = false;
    }
    final handlers = _listeners[event];
    if (handlers == null) return;
    for (final handler in List<void Function(Object?)>.of(handlers)) {
      handler(payload);
    }
  }

  Unsubscribe _register(String event, void Function(Object?) callback) {
    final list = _listeners.putIfAbsent(event, () => <void Function(Object?)>[]);
    list.add(callback);
    return () {
      list.remove(callback);
    };
  }

  void _record(String event, Object? payload) {
    emitted.add((event, payload));
  }

  // ── Connection lifecycle ───────────────────────────────────────────────

  @override
  void connect() {
    connectCalled = true;
    isConnected = true;
  }

  @override
  void disconnect() {
    disconnectCalled = true;
    isConnected = false;
  }

  // ── Outbound ───────────────────────────────────────────────────────────

  @override
  void sendUserJoin(UserJoinPayload payload) => _record(ChatEvents.userJoin, payload);

  @override
  void sendMessageSend(EncryptedMessagePayload payload) =>
      _record(ChatEvents.messageSend, payload);

  @override
  void sendE2eePublicKey(E2eePublicKeyPayload payload) =>
      _record(ChatEvents.e2eePublicKey, payload);

  @override
  void sendRegister(RegisterPayload payload) => _record(ChatEvents.userRegister, payload);

  @override
  void sendLogin(LoginPayload payload) => _record(ChatEvents.userLogin, payload);

  @override
  void sendGroupCreate(GroupCreatePayload payload) =>
      _record(ChatEvents.groupCreate, payload);

  @override
  void sendGroupMessage(GroupEncryptedPayload payload) =>
      _record(ChatEvents.groupMessageSend, payload);

  @override
  void sendGroupMemberAdd(GroupTargetPayload payload) =>
      _record(ChatEvents.groupMemberAdd, payload);

  @override
  void sendGroupMemberRemove(GroupTargetPayload payload) =>
      _record(ChatEvents.groupMemberRemove, payload);

  @override
  void sendGroupKickVote(GroupTargetPayload payload) =>
      _record(ChatEvents.groupKickVote, payload);

  // ── Inbound ────────────────────────────────────────────────────────────

  @override
  Unsubscribe onUserJoined(void Function(UserInfo user) handler) {
    return _register(ChatEvents.userJoined, (payload) => handler(payload! as UserInfo));
  }

  @override
  Unsubscribe onUserLeft(void Function(UserLeftPayload payload) handler) {
    return _register(ChatEvents.userLeft, (data) => handler(data! as UserLeftPayload));
  }

  @override
  Unsubscribe onActiveUsers(void Function(List<UserInfo> users) handler) {
    return _register(ChatEvents.activeUsers, (payload) {
      handler(payload! as List<UserInfo>);
    });
  }

  @override
  Unsubscribe onActiveGroups(void Function(List<GroupInfo> groups) handler) {
    return _register(ChatEvents.activeGroups, (payload) {
      handler(payload! as List<GroupInfo>);
    });
  }

  @override
  Unsubscribe onPrivateMessage(void Function(PrivateMessage message) handler) {
    return _register(ChatEvents.privateMessage, (payload) {
      handler(payload! as PrivateMessage);
    });
  }

  @override
  Unsubscribe onE2eePublicKey(void Function(E2eePublicKeyRelay relay) handler) {
    return _register(ChatEvents.e2eePublicKey, (payload) {
      handler(payload! as E2eePublicKeyRelay);
    });
  }

  @override
  Unsubscribe onDeliveryFailed(void Function(DeliveryFailedPayload payload) handler) {
    return _register(ChatEvents.deliveryFailed, (data) {
      handler(data! as DeliveryFailedPayload);
    });
  }

  @override
  Unsubscribe onMessageRejected(void Function(MessageRejectedPayload payload) handler) {
    return _register(ChatEvents.messageRejected, (data) {
      handler(data! as MessageRejectedPayload);
    });
  }

  @override
  Unsubscribe onError(void Function(ErrorPayload payload) handler) {
    return _register(ChatEvents.error, (data) => handler(data! as ErrorPayload));
  }

  @override
  Unsubscribe onRegisterSuccess(void Function(AuthResult result) handler) {
    return _register(ChatEvents.registerSuccess, (payload) {
      handler(payload! as AuthResult);
    });
  }

  @override
  Unsubscribe onRegisterError(void Function(AuthResult result) handler) {
    return _register(ChatEvents.registerError, (payload) {
      handler(payload! as AuthResult);
    });
  }

  @override
  Unsubscribe onLoginSuccess(void Function(AuthResult result) handler) {
    return _register(ChatEvents.loginSuccess, (payload) {
      handler(payload! as AuthResult);
    });
  }

  @override
  Unsubscribe onLoginError(void Function(AuthResult result) handler) {
    return _register(ChatEvents.loginError, (payload) {
      handler(payload! as AuthResult);
    });
  }

  @override
  Unsubscribe onGroupCreated(void Function(GroupInfo group) handler) {
    return _register(ChatEvents.groupCreated, (payload) {
      handler(payload! as GroupInfo);
    });
  }

  @override
  Unsubscribe onGroupCreatedError(void Function(GroupErrorPayload payload) handler) {
    return _register(ChatEvents.groupCreatedError, (data) {
      handler(data! as GroupErrorPayload);
    });
  }

  @override
  Unsubscribe onGroupMessage(void Function(GroupMessage message) handler) {
    return _register(ChatEvents.groupMessage, (payload) {
      handler(payload! as GroupMessage);
    });
  }

  @override
  Unsubscribe onGroupMessageDeliveryFailed(void Function(GroupErrorPayload payload) handler) {
    return _register(ChatEvents.groupMessageDeliveryFailed, (data) {
      handler(data! as GroupErrorPayload);
    });
  }

  @override
  Unsubscribe onUsersDirectory(void Function(List<String> usernames) handler) {
    return _register(ChatEvents.usersDirectory, (payload) {
      handler(payload! as List<String>);
    });
  }

  @override
  Unsubscribe onGroupMemberRemoved(void Function(GroupMemberRemovedPayload payload) handler) {
    return _register(ChatEvents.groupMemberRemoved, (data) {
      handler(data! as GroupMemberRemovedPayload);
    });
  }

  @override
  Unsubscribe onGroupKickTally(void Function(KickTally tally) handler) {
    return _register(ChatEvents.groupKickTally, (data) {
      handler(data! as KickTally);
    });
  }

  @override
  Unsubscribe onMediaToken(void Function(MediaTokenPayload payload) handler) {
    return _register(ChatEvents.mediaToken, (data) {
      handler(data! as MediaTokenPayload);
    });
  }

  // ── Connection lifecycle listeners ─────────────────────────────────────

  @override
  Unsubscribe onConnect(void Function() handler) {
    return _register(ChatEvents.connect, (_) => handler());
  }

  @override
  Unsubscribe onDisconnect(void Function() handler) {
    return _register(ChatEvents.disconnect, (_) => handler());
  }

  @override
  Unsubscribe onConnectError(void Function() handler) {
    return _register(ChatEvents.connectError, (_) => handler());
  }

  @override
  Unsubscribe onReconnectAttempt(void Function() handler) {
    return _register(ChatEvents.reconnectAttempt, (_) => handler());
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────

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

const UserInfo aliceInfo = UserInfo(
  userId: 'u-alice',
  username: 'alice',
  socketId: 's-alice',
  joinedAt: 1,
);

const UserInfo bobInfo = UserInfo(
  userId: 'u-bob',
  username: 'bob',
  socketId: 's-bob',
  joinedAt: 2,
);

void main() {
  late FakeSocketService fake;
  late FakeMediaClient media;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    media = FakeMediaClient();
    controller = ChatController(
      socket: fake,
      e2ee: E2eeSession(),
      mediaClient: media,
      // Keep errors on screen for the whole test; dispose() cancels the timer.
      errorClearDelay: const Duration(days: 1),
      sharedKeyTimeoutMs: 100,
    );
  });

  tearDown(() {
    controller.dispose();
  });

  /// Logs the controller in as [username] without going through the socket.
  void signInAs(String userId, String username) {
    fake.fire(
      ChatEvents.loginSuccess,
      AuthSuccess(kind: 'login_success', userId: userId, username: username),
    );
  }

  /// Establishes a real shared key between the controller and [peer] session
  /// in both directions, as the key exchange would over the wire.
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
    await peer.deriveSharedSecret('alice', myPublicKey);
  }

  group('connection status and lifecycle', () {
    test('constructor connects the socket', () {
      expect(fake.connectCalled, isTrue);
      expect(controller.connectionStatus, ConnectionStatus.connecting);
    });

    test('status follows connect/disconnect/reconnect events', () {
      fake.fire(ChatEvents.connect);
      expect(controller.connectionStatus, ConnectionStatus.connected);
      fake.fire(ChatEvents.disconnect);
      expect(controller.connectionStatus, ConnectionStatus.disconnected);
      fake.fire(ChatEvents.reconnectAttempt);
      expect(controller.connectionStatus, ConnectionStatus.connecting);
      fake.fire(ChatEvents.connectError);
      expect(controller.connectionStatus, ConnectionStatus.disconnected);
    });
  });

  group('private message storage', () {
    test('re-delivered wire messages are deduped by identity', () {
      signInAs('u-alice', 'alice');
      const wire = PrivateMessage(
        from: 'u-bob',
        fromUsername: 'bob',
        to: 'u-alice',
        toUsername: 'alice',
        ciphertext: 'c1',
        iv: 'iv1',
        timestamp: 1000,
      );
      fake.fire(ChatEvents.privateMessage, wire);
      fake.fire(ChatEvents.privateMessage, wire);
      expect(controller.messagesForPeer('bob'), hasLength(1));
      expect(controller.conversationPeers, <String>['bob']);

      const other = PrivateMessage(
        from: 'u-bob',
        fromUsername: 'bob',
        to: 'u-alice',
        toUsername: 'alice',
        ciphertext: 'c2',
        iv: 'iv2',
        timestamp: 1001,
      );
      fake.fire(ChatEvents.privateMessage, other);
      expect(controller.messagesForPeer('bob'), hasLength(2));
    });

    test('own echoed messages are attributed to the recipient peer', () {
      signInAs('u-alice', 'alice');
      const echo = PrivateMessage(
        from: 'u-alice',
        fromUsername: 'alice',
        to: 'u-bob',
        toUsername: 'bob',
        ciphertext: 'c',
        iv: 'i',
        timestamp: 5,
      );
      fake.fire(ChatEvents.privateMessage, echo);
      final message = controller.messagesForPeer('bob').single;
      expect(message.isOwn, isTrue);
      expect(message.peerUsername, 'bob');
      expect(message.decryptionFailed, isTrue);
    });

    test('ciphertext waits for the shared key, then decrypts in place', () async {
      signInAs('u-alice', 'alice');
      final bob = E2eeSession();
      final bobPublicKey = await bob.getPublicKey();
      final alicePublicKey = await controller.e2ee.getPublicKey();
      await bob.deriveSharedSecret('alice', alicePublicKey);
      final encrypted = await bob.encrypt('alice', 'late arrival');

      fake.fire(
        ChatEvents.privateMessage,
        PrivateMessage(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'u-alice',
          toUsername: 'alice',
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          timestamp: 42,
        ),
      );
      expect(controller.messagesForPeer('bob').single.plaintext, '[Encrypted]');
      expect(controller.messagesForPeer('bob').single.decryptionFailed, isTrue);

      fake.fire(
        ChatEvents.e2eePublicKey,
        E2eePublicKeyRelay(
          from: 'u-bob',
          fromUsername: 'bob',
          publicKey: bobPublicKey,
        ),
      );
      await waitFor(() => !controller.messagesForPeer('bob').single.decryptionFailed);
      expect(controller.messagesForPeer('bob').single.plaintext, 'late arrival');
      expect(controller.messagesForPeer('bob'), hasLength(1));
    });
  });

  group('group message storage', () {
    test('group messages are stored per group and deduped', () {
      signInAs('u-alice', 'alice');
      const wire = GroupMessage(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
        ciphertexts: <GroupCiphertext>[
          GroupCiphertext(to: 'alice', ciphertext: 'c', iv: 'i'),
        ],
        timestamp: 10,
      );
      fake.fire(ChatEvents.groupMessage, wire);
      fake.fire(ChatEvents.groupMessage, wire);
      expect(controller.groupMessagesFor('g1'), hasLength(1));
      final message = controller.groupMessagesFor('g1').single;
      expect(message.isOwn, isFalse);
      expect(message.decryptionFailed, isTrue);
      expect(message.plaintext, '[Encrypted]');
      expect(controller.groupConversationIds, <String>['g1']);
    });

    test('a group message without our ciphertext stays a placeholder', () {
      signInAs('u-alice', 'alice');
      const wire = GroupMessage(
        groupId: 'g2',
        from: 'u-bob',
        fromUsername: 'bob',
        ciphertexts: <GroupCiphertext>[
          GroupCiphertext(to: 'bob', ciphertext: 'c', iv: 'i'),
        ],
        timestamp: 11,
      );
      fake.fire(ChatEvents.groupMessage, wire);
      final message = controller.groupMessagesFor('g2').single;
      expect(message.plaintext, '[Encrypted]');
      expect(message.decryptionFailed, isTrue);
    });

    test('group ciphertext decrypts when the sender key arrives', () async {
      signInAs('u-alice', 'alice');
      final bob = E2eeSession();
      final alicePublicKey = await controller.e2ee.getPublicKey();
      await bob.deriveSharedSecret('alice', alicePublicKey);
      final encrypted = await bob.encrypt('alice', 'group late');

      fake.fire(
        ChatEvents.groupMessage,
        GroupMessage(
          groupId: 'g1',
          from: 'u-bob',
          fromUsername: 'bob',
          ciphertexts: <GroupCiphertext>[
            GroupCiphertext(
              to: 'alice',
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
            ),
          ],
          timestamp: 3,
        ),
      );
      expect(controller.groupMessagesFor('g1').single.plaintext, '[Encrypted]');

      final bobPublicKey = await bob.getPublicKey();
      fake.fire(
        ChatEvents.e2eePublicKey,
        E2eePublicKeyRelay(
          from: 'u-bob',
          fromUsername: 'bob',
          publicKey: bobPublicKey,
        ),
      );
      await waitFor(() => controller.groupMessagesFor('g1').single.plaintext == 'group late');
      expect(controller.groupMessagesFor('g1').single.decryptionFailed, isFalse);
    });
  });

  group('user roster upsert', () {
    test('active_users replaces the roster; user:joined and user:left upsert', () {
      signInAs('u-alice', 'alice');
      fake.fire(ChatEvents.activeUsers, <UserInfo>[aliceInfo, bobInfo]);
      expect(controller.users, hasLength(2));

      const rejoined = UserInfo(
        userId: 'u-bob',
        username: 'bob',
        socketId: 's-bob-2',
        joinedAt: 20,
      );
      fake.fire(ChatEvents.userJoined, rejoined);
      expect(controller.users, hasLength(2));
      expect(controller.users.first, aliceInfo);
      expect(controller.users[1], rejoined);

      fake.fire(
        ChatEvents.userLeft,
        const UserLeftPayload(userId: 'u-bob', username: 'bob'),
      );
      expect(controller.users, <UserInfo>[aliceInfo]);
    });

    test('our own user:joined does not trigger a key exchange', () async {
      signInAs('u-alice', 'alice');
      fake.fire(ChatEvents.userJoined, aliceInfo);
      expect(fake.countOf(ChatEvents.e2eePublicKey), 0);
      expect(controller.me?.isGuest, isFalse);
    });

    test('peer user:joined forgets the stale key and re-sends ours', () async {
      signInAs('u-alice', 'alice');
      final bob = E2eeSession();
      await establishKeyWith(bob, 'bob');
      expect(controller.e2ee.hasSharedKey('bob'), isTrue);

      fake.fire(ChatEvents.userJoined, bobInfo);
      expect(controller.e2ee.hasSharedKey('bob'), isFalse);
      await waitFor(
        () => fake
            .payloadsOf(ChatEvents.e2eePublicKey)
            .whereType<E2eePublicKeyPayload>()
            .any((payload) => payload.to == 'bob'),
      );
      // Our own key is derived locally so group echoes decrypt.
      await waitFor(() => controller.e2ee.hasSharedKey('alice'));
    });
  });

  group('friendly error mapping', () {
    test('machine-readable reason codes map to friendly text', () {
      controller.login('alice', 'password123');
      expect(controller.isLoading, isTrue);

      fake.fire(
        ChatEvents.loginError,
        const AuthFailure(kind: 'login_error', reason: 'invalid_credentials'),
      );
      expect(controller.error, 'Incorrect username or password.');
      expect(controller.isLoading, isFalse);

      fake.fire(
        ChatEvents.registerError,
        const AuthFailure(kind: 'register_error', reason: 'username_taken'),
      );
      expect(controller.error, 'That username is already taken.');

      fake.fire(
        ChatEvents.loginError,
        const AuthFailure(kind: 'login_error', reason: 'pin_required'),
      );
      expect(controller.error, 'This account requires a PIN.');

      fake.fire(
        ChatEvents.loginError,
        const AuthFailure(kind: 'login_error', reason: 'rate_limited'),
      );
      expect(
        controller.error,
        'Too many attempts. Please wait a moment and try again.',
      );

      // Unknown reasons pass through untouched.
      fake.fire(
        ChatEvents.loginError,
        const AuthFailure(kind: 'login_error', reason: 'mystery_reason'),
      );
      expect(controller.error, 'mystery_reason');
    });

    test('delivery and rejection errors are friendly too', () {
      fake.fire(
        ChatEvents.deliveryFailed,
        const DeliveryFailedPayload(reason: 'user_not_found', to: 'bob'),
      );
      expect(controller.error, 'Message to bob failed: That user is not online.');

      fake.fire(
        ChatEvents.messageRejected,
        const MessageRejectedPayload(reason: 'Rate limit exceeded'),
      );
      expect(
        controller.error,
        'Too many attempts. Please wait a moment and try again.',
      );

      fake.fire(
        ChatEvents.error,
        const ErrorPayload(message: 'username taken'),
      );
      expect(controller.error, 'That username is already taken.');

      fake.fire(
        ChatEvents.groupCreatedError,
        const GroupErrorPayload(message: 'Group not found'),
      );
      expect(controller.error, 'That group no longer exists.');

      fake.fire(
        ChatEvents.groupMessageDeliveryFailed,
        const GroupErrorPayload(message: 'Not a group member'),
      );
      expect(controller.error, 'You are not a member of that group.');

      controller.clearError();
      expect(controller.error, isNull);
    });
  });

  group('e2ee send flow', () {
    test('active_users publishes our public key to every user', () async {
      signInAs('u-alice', 'alice');
      fake.fire(ChatEvents.activeUsers, <UserInfo>[aliceInfo, bobInfo]);
      expect(controller.users, hasLength(2));

      await waitFor(() => fake.countOf(ChatEvents.e2eePublicKey) >= 2);
      final targets = fake
          .payloadsOf(ChatEvents.e2eePublicKey)
          .whereType<E2eePublicKeyPayload>()
          .map((payload) => payload.to)
          .toList()
        ..sort();
      expect(targets, <String>['alice', 'bob']);
    });

    test('sendMessage emits ciphertext the peer session can decrypt', () async {
      signInAs('u-alice', 'alice');
      final bob = E2eeSession();
      await establishKeyWith(bob, 'bob');

      final sent = await controller.sendMessage('bob', 'hello bob');
      expect(sent, isTrue);
      expect(controller.error, isNull);

      final payload =
          fake.payloadsOf(ChatEvents.messageSend).single as EncryptedMessagePayload;
      expect(payload.to, 'bob');
      expect(
        await bob.decrypt('alice', payload.ciphertext, payload.iv),
        'hello bob',
      );
    });

    test('sendMessage without a shared key fails with a friendly error', () async {
      signInAs('u-alice', 'alice');
      final sent = await controller.sendMessage('carol', 'anyone there?');
      expect(sent, isFalse);
      expect(controller.error, 'Secure session not ready. Please try again.');
      expect(fake.countOf(ChatEvents.messageSend), 0);
    });

    test('our own echoed message decrypts with the recipient key', () async {
      signInAs('u-alice', 'alice');
      final bob = E2eeSession();
      await establishKeyWith(bob, 'bob');

      expect(await controller.sendMessage('bob', 'echo test'), isTrue);
      final payload =
          fake.payloadsOf(ChatEvents.messageSend).single as EncryptedMessagePayload;

      fake.fire(
        ChatEvents.privateMessage,
        PrivateMessage(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'u-bob',
          toUsername: 'bob',
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: 7,
        ),
      );
      await waitFor(() {
        final messages = controller.messagesForPeer('bob');
        return messages.isNotEmpty && messages.first.plaintext == 'echo test';
      });
      final message = controller.messagesForPeer('bob').single;
      expect(message.isOwn, isTrue);
      expect(message.decryptionFailed, isFalse);
    });

    test('sendGroupMessage encrypts for self and members; echo decrypts', () async {
      signInAs('u-alice', 'alice');
      const group = GroupInfo(
        groupId: 'g1',
        name: 'Team',
        members: <GroupMember>[
          GroupMember(userId: 'u-alice', username: 'alice', isAdmin: true),
          GroupMember(userId: 'u-bob', username: 'bob', isAdmin: false),
        ],
        createdBy: 'u-alice',
        createdAt: 1,
      );
      fake.fire(ChatEvents.activeGroups, <GroupInfo>[group]);

      final bob = E2eeSession();
      await establishKeyWith(bob, 'bob');

      final sent = await controller.sendGroupMessage('g1', 'hello team');
      expect(sent, isTrue);

      final payload =
          fake.payloadsOf(ChatEvents.groupMessageSend).single as GroupEncryptedPayload;
      expect(payload.ciphertexts.map((entry) => entry.to), containsAll(<String>[
        'alice',
        'bob',
      ]));
      // The self copy guarantees our echoed message decrypts locally.
      expect(controller.e2ee.hasSharedKey('alice'), isTrue);

      final bobCopy = payload.ciphertexts.firstWhere((entry) => entry.to == 'bob');
      expect(
        await bob.decrypt('alice', bobCopy.ciphertext, bobCopy.iv),
        'hello team',
      );

      // The server echoes the sender's message back to us.
      fake.fire(
        ChatEvents.groupMessage,
        GroupMessage(
          groupId: 'g1',
          from: 'u-alice',
          fromUsername: 'alice',
          ciphertexts: payload.ciphertexts,
          timestamp: 99,
        ),
      );
      await waitFor(() {
        final messages = controller.groupMessagesFor('g1');
        return messages.isNotEmpty && messages.first.plaintext == 'hello team';
      });
      final echo = controller.groupMessagesFor('g1').single;
      expect(echo.isOwn, isTrue);
      expect(echo.decryptionFailed, isFalse);
    });

    test('sendGroupMessage with no shared keys fails with a friendly error', () async {
      signInAs('u-alice', 'alice');
      // alice is not a member here, so no self ciphertext can be produced.
      const group = GroupInfo(
        groupId: 'g2',
        name: 'Others',
        members: <GroupMember>[
          GroupMember(userId: 'u-bob', username: 'bob', isAdmin: true),
        ],
        createdBy: 'u-bob',
        createdAt: 1,
      );
      fake.fire(ChatEvents.activeGroups, <GroupInfo>[group]);

      final sent = await controller.sendGroupMessage('g2', 'hello?');
      expect(sent, isFalse);
      expect(controller.error, 'Secure session not ready. Please try again.');
      expect(fake.countOf(ChatEvents.groupMessageSend), 0);
    });
  });

  group('reconnect re-auth', () {
    test('reconnect re-emits user:login with stored credentials', () {
      controller.login('alice', 'password123', pin: '4321');
      expect(fake.payloadsOf(ChatEvents.userLogin), hasLength(1));
      signInAs('u-alice', 'alice');
      fake.emitted.clear();

      fake.fire(ChatEvents.disconnect);
      expect(controller.connectionStatus, ConnectionStatus.disconnected);
      fake.fire(ChatEvents.reconnectAttempt);
      expect(controller.connectionStatus, ConnectionStatus.connecting);
      fake.fire(ChatEvents.connect);
      expect(controller.connectionStatus, ConnectionStatus.connected);

      final payload = fake.payloadsOf(ChatEvents.userLogin).single as LoginPayload;
      expect(payload.username, 'alice');
      expect(payload.password, 'password123');
      expect(payload.pin, '4321');
    });

    test('reconnect re-emits user:join for a guest session', () {
      controller.joinAsGuest('guesty');
      expect(fake.payloadsOf(ChatEvents.userJoin), hasLength(1));
      fake.fire(
        ChatEvents.userJoined,
        const UserInfo(
          userId: 'u-guesty',
          username: 'guesty',
          socketId: 's1',
          joinedAt: 1,
        ),
      );
      expect(controller.me?.isGuest, isTrue);
      fake.emitted.clear();

      fake.fire(ChatEvents.disconnect);
      fake.fire(ChatEvents.connect);

      final payload = fake.payloadsOf(ChatEvents.userJoin).single as UserJoinPayload;
      expect(payload.username, 'guesty');

      // The pending guest flag was re-armed, so our re-join re-establishes me.
      fake.fire(
        ChatEvents.userJoined,
        const UserInfo(
          userId: 'u-guesty',
          username: 'guesty',
          socketId: 's2',
          joinedAt: 2,
        ),
      );
      expect(controller.me?.userId, 'u-guesty');
      expect(controller.me?.isGuest, isTrue);
    });

    test('connect without stored credentials does not re-authenticate', () {
      // Identity without credentials (e.g. state restored without a password)
      // must not trigger an auth emit.
      signInAs('u-alice', 'alice');
      fake.emitted.clear();
      fake.fire(ChatEvents.disconnect);
      fake.fire(ChatEvents.connect);
      expect(fake.emitted, isEmpty);
    });

    test('login before connect buffers nothing extra on the first connect', () {
      fake.isConnected = false;
      controller.login('alice', 'password123');
      expect(fake.connectCalled, isTrue);
      expect(fake.payloadsOf(ChatEvents.userLogin), hasLength(1));

      // First connect arrives with no established identity: no re-auth.
      fake.emitted.clear();
      fake.fire(ChatEvents.connect);
      expect(fake.emitted, isEmpty);
      expect(controller.connectionStatus, ConnectionStatus.connected);
    });
  });

  group('selection and logout', () {
    test('selecting a conversation clears the other selection', () {
      controller.selectPeer('bob');
      expect(controller.selectedPeer, 'bob');
      expect(controller.selectedGroup, isNull);

      controller.selectGroup('g1');
      expect(controller.selectedGroup, 'g1');
      expect(controller.selectedPeer, isNull);

      controller.clearSelection();
      expect(controller.selectedPeer, isNull);
      expect(controller.selectedGroup, isNull);
    });

    test('logout clears state, drops keys and disconnects', () {
      signInAs('u-alice', 'alice');
      fake.fire(ChatEvents.activeUsers, <UserInfo>[aliceInfo, bobInfo]);
      fake.fire(
        ChatEvents.privateMessage,
        const PrivateMessage(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'u-alice',
          toUsername: 'alice',
          ciphertext: 'c',
          iv: 'i',
          timestamp: 1,
        ),
      );
      expect(controller.users, isNotEmpty);
      expect(controller.messagesForPeer('bob'), isNotEmpty);

      controller.logout();

      expect(controller.me, isNull);
      expect(controller.users, isEmpty);
      expect(controller.groups, isEmpty);
      expect(controller.messagesForPeer('bob'), isEmpty);
      expect(controller.error, isNull);
      expect(controller.isLoading, isFalse);
      expect(fake.disconnectCalled, isTrue);
      // A fresh E2eeSession replaced the old one.
      expect(controller.e2ee.hasSharedKey('bob'), isFalse);
    });
  });

  group('directory and kick votes', () {
    const team = GroupInfo(
      groupId: 'g-team',
      name: 'Team',
      members: <GroupMember>[
        GroupMember(userId: 'u-alice', username: 'alice', isAdmin: true),
        GroupMember(userId: 'u-bob', username: 'bob', isAdmin: false),
        GroupMember(userId: 'u-me', username: 'me', isAdmin: false),
      ],
      createdBy: 'u-alice',
      createdAt: 1000,
    );

    KickTally tally({List<String> votes = const <String>['alice']}) {
      return KickTally(
        groupId: 'g-team',
        username: 'bob',
        votes: votes,
        required: 2,
        status: 'active',
        expiresAt: 1700000000000,
      );
    }

    test('users:directory replaces the snapshot', () {
      fake.fire(ChatEvents.usersDirectory, <String>['alice', 'bob']);
      expect(controller.directory, <String>['alice', 'bob']);

      fake.fire(ChatEvents.usersDirectory, <String>['carol']);
      expect(controller.directory, <String>['carol']);
    });

    test('user:joined appends to the directory only when missing', () {
      fake.fire(ChatEvents.usersDirectory, <String>['alice']);
      fake.fire(ChatEvents.userJoined, bobInfo);
      expect(controller.directory, <String>['alice', 'bob']);

      // A rejoining peer must not create a second entry.
      fake.fire(ChatEvents.userJoined, bobInfo);
      expect(controller.directory, <String>['alice', 'bob']);
    });

    test('active_groups clears tallies and a later tally repopulates', () {
      fake.fire(ChatEvents.groupKickTally, tally());
      expect(controller.kickTallyFor('g-team'), isNotNull);

      fake.fire(ChatEvents.activeGroups, <GroupInfo>[]);
      expect(controller.kickTallyFor('g-team'), isNull);

      fake.fire(
        ChatEvents.groupKickTally,
        tally(votes: <String>['alice', 'bob']),
      );
      expect(controller.kickTallyFor('g-team')?.votes, <String>[
        'alice',
        'bob',
      ]);
    });

    test('group:member:removed for me drops the group, selection and tally', () {
      signInAs('u-me', 'me');
      fake.fire(ChatEvents.activeGroups, <GroupInfo>[team]);
      fake.fire(ChatEvents.groupKickTally, tally());
      controller.selectGroup('g-team');

      fake.fire(
        ChatEvents.groupMemberRemoved,
        const GroupMemberRemovedPayload(
          groupId: 'g-team',
          username: 'me',
          reason: 'removed',
        ),
      );
      expect(controller.groups, isEmpty);
      expect(controller.selectedGroup, isNull);
      expect(controller.kickTallyFor('g-team'), isNull);
      expect(controller.error, 'You were removed from Team.');

      // A group we no longer know falls back to the generic name.
      fake.fire(
        ChatEvents.groupMemberRemoved,
        const GroupMemberRemovedPayload(
          groupId: 'g-unknown',
          username: 'me',
          reason: 'kicked',
        ),
      );
      expect(controller.error, 'You were voted out of the group.');
    });

    test('group:member:removed for someone else keeps my group and stays quiet', () {
      signInAs('u-me', 'me');
      fake.fire(ChatEvents.activeGroups, <GroupInfo>[team]);
      controller.selectGroup('g-team');

      fake.fire(
        ChatEvents.groupMemberRemoved,
        const GroupMemberRemovedPayload(
          groupId: 'g-team',
          username: 'alice',
          reason: 'kicked',
        ),
      );
      expect(controller.groups, <GroupInfo>[team]);
      expect(controller.selectedGroup, 'g-team');
      expect(controller.error, isNull);
    });

    test('group:kick:tally upserts per group id', () {
      const other = KickTally(
        groupId: 'g-other',
        username: 'carol',
        votes: <String>[],
        required: 2,
        status: 'active',
        expiresAt: 1700000000000,
      );
      fake.fire(ChatEvents.groupKickTally, tally());
      fake.fire(ChatEvents.groupKickTally, other);
      expect(controller.kickTallyFor('g-team')?.votes, <String>['alice']);
      expect(controller.kickTallyFor('g-other'), other);

      fake.fire(
        ChatEvents.groupKickTally,
        tally(votes: <String>['alice', 'bob']),
      );
      expect(controller.kickTallyFor('g-team')?.votes, <String>[
        'alice',
        'bob',
      ]);
      expect(controller.kickTallyFor('g-other'), other);
    });

    test('membership methods emit the exact wire events', () {
      controller.addMember('g-team', 'alice');
      controller.removeMember('g-team', 'bob');
      controller.kickVote('g-team', 'carol');

      expect(
        fake.payloadsOf(ChatEvents.groupMemberAdd).single,
        const GroupTargetPayload(groupId: 'g-team', username: 'alice'),
      );
      expect(
        fake.payloadsOf(ChatEvents.groupMemberRemove).single,
        const GroupTargetPayload(groupId: 'g-team', username: 'bob'),
      );
      expect(
        fake.payloadsOf(ChatEvents.groupKickVote).single,
        const GroupTargetPayload(groupId: 'g-team', username: 'carol'),
      );

      expect(ChatEvents.groupMemberAdd, 'group:member:add');
      expect(ChatEvents.groupMemberRemove, 'group:member:remove');
      expect(ChatEvents.groupKickVote, 'group:kick:vote');
      expect(ChatEvents.usersDirectory, 'users:directory');
      expect(ChatEvents.groupMemberRemoved, 'group:member:removed');
      expect(ChatEvents.groupKickTally, 'group:kick:tally');
    });

    test('logout clears the directory and the kick tallies', () {
      fake.fire(ChatEvents.usersDirectory, <String>['alice', 'bob']);
      fake.fire(ChatEvents.groupKickTally, tally());
      expect(controller.directory, isNotEmpty);
      expect(controller.kickTallyFor('g-team'), isNotNull);

      controller.logout();

      expect(controller.directory, isEmpty);
      expect(controller.kickTallyFor('g-team'), isNull);
    });
  });

  group('media', () {
    test('media:token stores the bearer token and a later emit replaces it', () {
      expect(controller.mediaToken, isNull);

      fake.fire(ChatEvents.mediaToken, const MediaTokenPayload(token: 'token-one'));
      expect(controller.mediaToken, 'token-one');

      fake.fire(ChatEvents.mediaToken, const MediaTokenPayload(token: 'token-two'));
      expect(controller.mediaToken, 'token-two');
    });

    test('sendMediaMessage uploads the ciphertext and sends a parseable envelope', () async {
      signInAs('u-alice', 'alice');
      final bob = E2eeSession();
      await establishKeyWith(bob, 'bob');
      fake.fire(ChatEvents.mediaToken, const MediaTokenPayload(token: 'tok-happy'));

      final bytes = Uint8List.fromList(
        List<int>.generate(64, (index) => index),
      );
      final sent = await controller.sendMediaMessage(
        'bob',
        bytes,
        mime: 'video/mp4',
        name: 'clip.mp4',
      );
      expect(sent, isTrue);
      expect(controller.error, isNull);

      expect(media.uploads, hasLength(1));
      final upload = media.uploads.single;
      expect(upload.token, 'tok-happy');

      final payload =
          fake.payloadsOf(ChatEvents.messageSend).single as EncryptedMessagePayload;
      expect(payload.to, 'bob');
      final envelopeJson =
          await bob.decrypt('alice', payload.ciphertext, payload.iv);
      final descriptor = MediaDescriptor.tryParse(envelopeJson);
      expect(descriptor, isNotNull);
      expect(base64Decode(descriptor!.key), hasLength(32));
      expect(base64Decode(descriptor.iv), hasLength(12));
      expect(descriptor.sha256, sha256Base64(upload.ciphertext));
      expect(descriptor.fileId, upload.fileId);
      expect(descriptor.mime, 'video/mp4');
      expect(descriptor.size, bytes.length);
      expect(descriptor.name, 'clip.mp4');
    });

    test('sendMediaMessage without a media token fails before uploading', () async {
      signInAs('u-alice', 'alice');
      final sent = await controller.sendMediaMessage(
        'bob',
        Uint8List.fromList(const <int>[1, 2, 3]),
        mime: 'video/mp4',
        name: 'clip.mp4',
      );
      expect(sent, isFalse);
      expect(controller.error, 'Not connected. Please try again.');
      expect(media.uploads, isEmpty);
      expect(fake.countOf(ChatEvents.messageSend), 0);
    });

    test('a failed upload shows the error and sends no chat message', () async {
      signInAs('u-alice', 'alice');
      fake.fire(ChatEvents.mediaToken, const MediaTokenPayload(token: 'tok-fail'));
      media.uploadOk = false;

      final sent = await controller.sendMediaMessage(
        'bob',
        Uint8List.fromList(const <int>[1, 2, 3]),
        mime: 'video/mp4',
      );
      expect(sent, isFalse);
      expect(controller.error, 'Upload failed. Please try again.');
      expect(media.uploads, hasLength(1));
      expect(fake.countOf(ChatEvents.messageSend), 0);
    });

    test('oversized files and disallowed mimes use the contract error text', () async {
      final oversized = Uint8List(maxMediaBytes + 1);
      expect(
        await controller.sendMediaMessage('bob', oversized, mime: 'video/mp4'),
        isFalse,
      );
      expect(controller.error, 'File is too large (16 MB max).');
      expect(media.uploads, isEmpty);

      expect(
        await controller.sendMediaMessage(
          'bob',
          Uint8List.fromList(const <int>[1, 2, 3]),
          mime: 'text/plain',
        ),
        isFalse,
      );
      expect(controller.error, 'Unsupported file type.');
      expect(media.uploads, isEmpty);
      expect(fake.countOf(ChatEvents.messageSend), 0);
    });

    test('a decrypted envelope becomes message.media; raw text stays null', () async {
      signInAs('u-alice', 'alice');
      final bob = E2eeSession();
      await establishKeyWith(bob, 'bob');

      final descriptor = MediaDescriptor(
        fileId: generateMediaId(),
        key: base64Encode(randomBytes32()),
        iv: base64Encode(randomIv12()),
        sha256: base64Encode(List<int>.filled(32, 4)),
        mime: 'image/png',
        size: 128,
        w: 32,
        h: 32,
        name: 'pic.png',
      );
      final encryptedEnvelope = await bob.encrypt(
        'alice',
        jsonEncode(descriptor.toJson()),
      );
      fake.fire(
        ChatEvents.privateMessage,
        PrivateMessage(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'u-alice',
          toUsername: 'alice',
          ciphertext: encryptedEnvelope.ciphertext,
          iv: encryptedEnvelope.iv,
          timestamp: 500,
        ),
      );
      await waitFor(() {
        final messages = controller.messagesForPeer('bob');
        return messages.isNotEmpty && !messages.first.decryptionFailed;
      });
      final mediaMessage = controller.messagesForPeer('bob').single;
      expect(mediaMessage.media, isNotNull);
      expect(mediaMessage.media!.fileId, descriptor.fileId);
      expect(mediaMessage.media!.name, 'pic.png');

      final encryptedText = await bob.encrypt('alice', 'plain old text');
      fake.fire(
        ChatEvents.privateMessage,
        PrivateMessage(
          from: 'u-bob',
          fromUsername: 'bob',
          to: 'u-alice',
          toUsername: 'alice',
          ciphertext: encryptedText.ciphertext,
          iv: encryptedText.iv,
          timestamp: 501,
        ),
      );
      await waitFor(() {
        final messages = controller.messagesForPeer('bob');
        return messages.length == 2 && !messages.last.decryptionFailed;
      });
      expect(controller.messagesForPeer('bob').last.plaintext, 'plain old text');
      expect(controller.messagesForPeer('bob').last.media, isNull);
    });

    test('loadMedia verifies, decrypts and caches results per fileId', () async {
      fake.fire(ChatEvents.mediaToken, const MediaTokenPayload(token: 'tok-load'));

      final key = randomBytes32();
      final iv = randomIv12();
      final plain = Uint8List.fromList(const <int>[10, 20, 30, 40, 50]);
      final ciphertext = encryptBytes(plain, key, iv);

      MediaDescriptor descriptorFor(String fileId) => MediaDescriptor(
        fileId: fileId,
        key: base64Encode(key),
        iv: base64Encode(iv),
        sha256: sha256Base64(ciphertext),
        mime: 'video/mp4',
        size: plain.length,
      );

      final ready = descriptorFor(generateMediaId());
      media.downloadResult = MediaFetchResult.ready(ciphertext);
      final first = await controller.loadMedia(ready);
      expect(first.status, 'ready');
      expect(first.bytes, orderedEquals(plain));

      // The session cache serves the second request without a refetch.
      final cached = await controller.loadMedia(ready);
      expect(cached.status, 'ready');
      expect(cached.bytes, orderedEquals(plain));
      expect(media.downloads, hasLength(1));

      // A 404-shaped result is cached as expired too.
      final gone = descriptorFor(generateMediaId());
      media.downloadResult = const MediaFetchResult.expired();
      expect((await controller.loadMedia(gone)).status, 'expired');
      expect((await controller.loadMedia(gone)).status, 'expired');
      expect(media.downloads, hasLength(2));

      // Tampered bytes fail the sha check before any decrypt attempt.
      final tampered = descriptorFor(generateMediaId());
      final badBytes = Uint8List.fromList(ciphertext);
      badBytes[0] = badBytes[0] ^ 0xFF;
      media.downloadResult = MediaFetchResult.ready(badBytes);
      expect((await controller.loadMedia(tampered)).status, 'error');
      expect((await controller.loadMedia(tampered)).status, 'error');
      expect(media.downloads, hasLength(3));
    });
  });
}
