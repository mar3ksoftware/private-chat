// Shared harness for the UI widget tests: an in-memory SocketService, a
// controller factory, and small helpers to drive auth/roster state and set
// the logical screen size (phone vs tablet).
//
// Not suffixed with `_test.dart` so `flutter test` does not run it directly.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:private_chat_mobile/main.dart';
import 'package:private_chat_mobile/src/crypto/e2ee_session.dart';
import 'package:private_chat_mobile/src/models/models.dart';
import 'package:private_chat_mobile/src/net/chat_events.dart';
import 'package:private_chat_mobile/src/net/socket_service.dart';
import 'package:private_chat_mobile/src/state/chat_controller.dart';

/// In-memory [SocketService] that records emits and lets tests fire inbound
/// events directly at the registered listeners. Mirrors the fake used by
/// `chat_controller_test.dart`.
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
    // The real socket reports its connection asynchronously; do the same so
    // the controller lands in `connected` right after construction.
    fire(ChatEvents.connect);
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

// ── Test fixtures ────────────────────────────────────────────────────────

const UserInfo meInfo = UserInfo(
  userId: 'u-me',
  username: 'me',
  socketId: 's-me',
  joinedAt: 1,
);

const UserInfo aliceInfo = UserInfo(
  userId: 'u-alice',
  username: 'alice',
  socketId: 's-alice',
  joinedAt: 2,
);

const UserInfo bobInfo = UserInfo(
  userId: 'u-bob',
  username: 'bob',
  socketId: 's-bob',
  joinedAt: 3,
);

const UserInfo novaInfo = UserInfo(
  userId: 'u-nova',
  username: 'nova',
  socketId: 's-nova',
  joinedAt: 5,
);

GroupInfo groupInfo({
  String id = 'g-team',
  String name = 'Team',
  List<String> members = const <String>['alice', 'bob', 'me'],
}) {
  return GroupInfo(
    groupId: id,
    name: name,
    members: [
      for (final username in members)
        GroupMember(
          userId: 'u-$username',
          username: username,
          isAdmin: username == 'alice',
        ),
    ],
    createdBy: 'alice',
    createdAt: 1000,
  );
}

/// Controller wired to [fake] with short timeouts so widget tests stay fast.
ChatController makeController(FakeSocketService fake) {
  return ChatController(
    socket: fake,
    e2ee: E2eeSession(),
    errorClearDelay: const Duration(days: 1),
    sharedKeyTimeoutMs: 50,
  );
}

/// Pumps the full app around [controller].
Future<void> pumpApp(WidgetTester tester, ChatController controller) async {
  await tester.pumpWidget(PrivateChatApp(controller: controller));
  await tester.pump();
}

/// Phone-sized logical screen (390×844).
void usePhoneSize(WidgetTester tester) {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
}

/// Tablet-sized logical screen (1000×700) — above the wide breakpoint.
void useWideSize(WidgetTester tester) {
  tester.view.physicalSize = const Size(1000 * 3, 700 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
}

/// Signs the controller in without touching the forms.
void signIn(FakeSocketService fake, {String username = 'me', String userId = 'u-me'}) {
  fake.fire(
    ChatEvents.loginSuccess,
    AuthSuccess(kind: 'login_success', userId: userId, username: username),
  );
}

/// Publishes the roster (and the directory snapshot that backs the
/// group-create picker).
void setUsers(FakeSocketService fake, List<UserInfo> users) {
  fake.fire(ChatEvents.activeUsers, users);
  fake.fire(ChatEvents.usersDirectory, <String>[
    for (final user in users) user.username,
  ]);
}

void setGroups(FakeSocketService fake, List<GroupInfo> groups) {
  fake.fire(ChatEvents.activeGroups, groups);
}

/// Delivers an inbound private message; without a shared key the controller
/// keeps it as an `[Encrypted]` placeholder.
void receivePrivate(
  FakeSocketService fake, {
  required String from,
  required String fromUserId,
  required String toUsername,
  required int timestamp,
  String ciphertext = 'cipher',
  String iv = 'iv',
}) {
  fake.fire(
    ChatEvents.privateMessage,
    PrivateMessage(
      from: fromUserId,
      fromUsername: from,
      to: 'u-$toUsername',
      toUsername: toUsername,
      ciphertext: ciphertext,
      iv: iv,
      timestamp: timestamp,
    ),
  );
}

/// Delivers an inbound group message addressed to us.
void receiveGroupMessage(
  FakeSocketService fake, {
  required String groupId,
  required String from,
  required String fromUserId,
  required String toUsername,
  required int timestamp,
}) {
  fake.fire(
    ChatEvents.groupMessage,
    GroupMessage(
      groupId: groupId,
      from: fromUserId,
      fromUsername: from,
      ciphertexts: [
        GroupCiphertext(to: toUsername, ciphertext: 'cipher', iv: 'iv'),
      ],
      timestamp: timestamp,
    ),
  );
}
