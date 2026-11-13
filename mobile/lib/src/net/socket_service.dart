// ── Socket service ────────────────────────────────────────────────────────
//
// Thin, contract-typed wrapper around `socket_io_client`. Owns the single
// Socket.IO connection used by the chat controller and exposes one typed
// helper per event from `backend/src/types.ts`:
//
//   * every `EVENTS.CLIENT` event gets a `send*` method,
//   * every `EVENTS.SERVER` event gets an `on*` registration method that
//     parses the wire payload into the corresponding model,
//   * connection lifecycle events (`connect`, `disconnect`, `connect_error`,
//     `reconnect_attempt`) get their own `on*` methods.
//
// The interface is injectable: tests substitute a fake implementation instead
// of opening a real connection.

import 'package:socket_io_client/socket_io_client.dart' as sio;

import '../models/models.dart';
import 'chat_events.dart';

/// Removes a listener previously registered through a `SocketService.on*`
/// method.
typedef Unsubscribe = void Function();

/// Contract-typed view of the Socket.IO connection.
abstract interface class SocketService {
  /// Default backend URL for desktop tests and local development.
  ///
  /// The Android emulator reaches the host machine via
  /// `http://10.0.2.2:3000` instead.
  static const String defaultUrl = 'http://localhost:3000';

  // ── Connection lifecycle ───────────────────────────────────────────────

  /// Whether the underlying transport is currently connected.
  bool get isConnected;

  /// Opens the connection (no-op when already connected).
  void connect();

  /// Closes the connection.
  void disconnect();

  // ── Outbound: client -> server ─────────────────────────────────────────

  /// `user:join` — join as a guest.
  void sendUserJoin(UserJoinPayload payload);

  /// `message:send` — send an encrypted private message.
  void sendMessageSend(EncryptedMessagePayload payload);

  /// `e2ee:public_key` — share our public key with [E2eePublicKeyPayload.to].
  void sendE2eePublicKey(E2eePublicKeyPayload payload);

  /// `user:register` — create an account.
  void sendRegister(RegisterPayload payload);

  /// `user:login` — authenticate an existing account.
  void sendLogin(LoginPayload payload);

  /// `group:create` — create a group chat.
  void sendGroupCreate(GroupCreatePayload payload);

  /// `group:message:send` — send an encrypted group message.
  void sendGroupMessage(GroupEncryptedPayload payload);

  /// `group:member:add` — add a member to a group (admin only).
  void sendGroupMemberAdd(GroupTargetPayload payload);

  /// `group:member:remove` — remove a member from a group (admin only).
  void sendGroupMemberRemove(GroupTargetPayload payload);

  /// `group:kick:vote` — cast a vote to kick a member.
  void sendGroupKickVote(GroupTargetPayload payload);

  /// `typing:send` — (de)activate our typing indicator in a conversation.
  void sendTypingSend(TypingSendPayload payload);

  /// `receipt:read` — mark a DM read up to a message timestamp.
  void sendReceiptRead(ReceiptReadPayload payload);

  /// `message:react` — toggle an emoji reaction on a message.
  void sendReact(MessageReactPayload payload);

  /// `message:edit` — replace an author-owned message body.
  void sendEdit(MessageEditPayload payload);

  /// `message:delete` — tombstone an author-owned message.
  void sendDelete(MessageDeletePayload payload);

  /// `profile:update` — publish our display name and status.
  void sendProfileUpdate(ProfileUpdatePayload payload);

  // ── Inbound: server -> client ──────────────────────────────────────────

  /// `user:joined` — a user (possibly us) joined; broadcast to everyone.
  Unsubscribe onUserJoined(void Function(UserInfo user) handler);

  /// `user:left` — a user disconnected; broadcast to everyone.
  Unsubscribe onUserLeft(void Function(UserLeftPayload payload) handler);

  /// `active_users` — roster snapshot sent to a freshly joined socket.
  Unsubscribe onActiveUsers(void Function(List<UserInfo> users) handler);

  /// `active_groups` — group snapshot sent to a freshly joined socket.
  Unsubscribe onActiveGroups(void Function(List<GroupInfo> groups) handler);

  /// `private_message` — an encrypted private message (also echoed to us).
  Unsubscribe onPrivateMessage(void Function(PrivateMessage message) handler);

  /// `e2ee:public_key` — relayed public key from another user.
  Unsubscribe onE2eePublicKey(void Function(E2eePublicKeyRelay relay) handler);

  /// `delivery_failed` — a private message could not be delivered.
  Unsubscribe onDeliveryFailed(void Function(DeliveryFailedPayload payload) handler);

  /// `message_rejected` — the server rejected an outbound payload.
  Unsubscribe onMessageRejected(void Function(MessageRejectedPayload payload) handler);

  /// `error` — free-form server error (e.g. guest username taken).
  Unsubscribe onError(void Function(ErrorPayload payload) handler);

  /// `register_success` — account created; we are now logged in.
  Unsubscribe onRegisterSuccess(void Function(AuthResult result) handler);

  /// `register_error` — account creation failed.
  Unsubscribe onRegisterError(void Function(AuthResult result) handler);

  /// `login_success` — authentication succeeded.
  Unsubscribe onLoginSuccess(void Function(AuthResult result) handler);

  /// `login_error` — authentication failed.
  Unsubscribe onLoginError(void Function(AuthResult result) handler);

  /// `group:created` — a group we belong to was created/updated.
  Unsubscribe onGroupCreated(void Function(GroupInfo group) handler);

  /// `group:created_error` — group creation failed.
  Unsubscribe onGroupCreatedError(void Function(GroupErrorPayload payload) handler);

  /// `group:message` — an encrypted group message (also echoed to us).
  Unsubscribe onGroupMessage(void Function(GroupMessage message) handler);

  /// `group:message_delivery_failed` — a group message was rejected.
  Unsubscribe onGroupMessageDeliveryFailed(void Function(GroupErrorPayload payload) handler);

  /// `users:directory` — every known username, sent as a snapshot on join.
  Unsubscribe onUsersDirectory(void Function(List<String> usernames) handler);

  /// `group:member:removed` — we were removed from a group.
  Unsubscribe onGroupMemberRemoved(void Function(GroupMemberRemovedPayload payload) handler);

  /// `group:kick:tally` — the current vote-kick tally for a group.
  Unsubscribe onGroupKickTally(void Function(KickTally tally) handler);

  /// `media:token` — bearer token for the `/media` HTTP endpoints.
  Unsubscribe onMediaToken(void Function(MediaTokenPayload payload) handler);

  /// `typing:changed` — someone started/stopped typing in a conversation.
  Unsubscribe onTypingChanged(void Function(TypingChangedPayload payload) handler);

  /// `receipt:read` — a peer marked their side of a DM read.
  Unsubscribe onReceiptRead(void Function(ReceiptReadRelay payload) handler);

  /// `message:reacted` — a reaction was added/removed on a message.
  Unsubscribe onMessageReacted(void Function(MessageReactedPayload payload) handler);

  /// `message:edited` — an author replaced a message body.
  Unsubscribe onMessageEdited(void Function(MessageEditedPayload payload) handler);

  /// `message:deleted` — an author tombstoned a message.
  Unsubscribe onMessageDeleted(void Function(MessageDeletedPayload payload) handler);

  /// `profile:updated` — a user changed their display name/status.
  Unsubscribe onProfileUpdated(void Function(ProfileUpdatedPayload payload) handler);

  // ── Connection lifecycle listeners ─────────────────────────────────────

  /// Socket.IO `connect` — also fires on every successful reconnect.
  Unsubscribe onConnect(void Function() handler);

  /// Socket.IO `disconnect`.
  Unsubscribe onDisconnect(void Function() handler);

  /// Socket.IO `connect_error`.
  Unsubscribe onConnectError(void Function() handler);

  /// Manager `reconnect_attempt` — emitted before each retry.
  Unsubscribe onReconnectAttempt(void Function() handler);
}

/// Real [SocketService] backed by `socket_io_client`.
class IoSocketService implements SocketService {
  IoSocketService({required String url}) : _socket = _buildSocket(url);

  final sio.Socket _socket;

  static sio.Socket _buildSocket(String url) {
    final options = sio.OptionBuilder()
      // Each SocketService must own a dedicated connection: `sio.io()`
      // multiplexes by URL and would otherwise hand every controller the
      // same shared socket (breaking multi-client use in one process).
      ..enableForceNew()
      ..setPath('/socket.io/')
      ..setTransports(const <String>['websocket', 'polling'])
      ..disableAutoConnect();
    return sio.io(url, options.build());
  }

  // ── Connection lifecycle ───────────────────────────────────────────────

  @override
  bool get isConnected => _socket.connected;

  @override
  void connect() {
    _socket.connect();
  }

  @override
  void disconnect() {
    _socket.disconnect();
  }

  // ── Outbound ───────────────────────────────────────────────────────────

  @override
  void sendUserJoin(UserJoinPayload payload) {
    _socket.emit(ChatEvents.userJoin, payload.toJson());
  }

  @override
  void sendMessageSend(EncryptedMessagePayload payload) {
    _socket.emit(ChatEvents.messageSend, payload.toJson());
  }

  @override
  void sendE2eePublicKey(E2eePublicKeyPayload payload) {
    _socket.emit(ChatEvents.e2eePublicKey, payload.toJson());
  }

  @override
  void sendRegister(RegisterPayload payload) {
    _socket.emit(ChatEvents.userRegister, payload.toJson());
  }

  @override
  void sendLogin(LoginPayload payload) {
    _socket.emit(ChatEvents.userLogin, payload.toJson());
  }

  @override
  void sendGroupCreate(GroupCreatePayload payload) {
    _socket.emit(ChatEvents.groupCreate, payload.toJson());
  }

  @override
  void sendGroupMessage(GroupEncryptedPayload payload) {
    _socket.emit(ChatEvents.groupMessageSend, payload.toJson());
  }

  @override
  void sendGroupMemberAdd(GroupTargetPayload payload) {
    _socket.emit(ChatEvents.groupMemberAdd, payload.toJson());
  }

  @override
  void sendGroupMemberRemove(GroupTargetPayload payload) {
    _socket.emit(ChatEvents.groupMemberRemove, payload.toJson());
  }

  @override
  void sendGroupKickVote(GroupTargetPayload payload) {
    _socket.emit(ChatEvents.groupKickVote, payload.toJson());
  }

  @override
  void sendTypingSend(TypingSendPayload payload) {
    _socket.emit(ChatEvents.typingSend, payload.toJson());
  }

  @override
  void sendReceiptRead(ReceiptReadPayload payload) {
    _socket.emit(ChatEvents.receiptRead, payload.toJson());
  }

  @override
  void sendReact(MessageReactPayload payload) {
    _socket.emit(ChatEvents.messageReact, payload.toJson());
  }

  @override
  void sendEdit(MessageEditPayload payload) {
    _socket.emit(ChatEvents.messageEdit, payload.toJson());
  }

  @override
  void sendDelete(MessageDeletePayload payload) {
    _socket.emit(ChatEvents.messageDelete, payload.toJson());
  }

  @override
  void sendProfileUpdate(ProfileUpdatePayload payload) {
    _socket.emit(ChatEvents.profileUpdate, payload.toJson());
  }

  // ── Inbound ────────────────────────────────────────────────────────────

  @override
  Unsubscribe onUserJoined(void Function(UserInfo user) handler) {
    return _on(ChatEvents.userJoined, (payload) {
      handler(UserInfo.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onUserLeft(void Function(UserLeftPayload payload) handler) {
    return _on(ChatEvents.userLeft, (data) {
      handler(UserLeftPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onActiveUsers(void Function(List<UserInfo> users) handler) {
    return _on(ChatEvents.activeUsers, (payload) {
      handler(_readList(payload, UserInfo.fromJson));
    });
  }

  @override
  Unsubscribe onActiveGroups(void Function(List<GroupInfo> groups) handler) {
    return _on(ChatEvents.activeGroups, (payload) {
      handler(_readList(payload, GroupInfo.fromJson));
    });
  }

  @override
  Unsubscribe onPrivateMessage(void Function(PrivateMessage message) handler) {
    return _on(ChatEvents.privateMessage, (payload) {
      handler(PrivateMessage.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onE2eePublicKey(void Function(E2eePublicKeyRelay relay) handler) {
    return _on(ChatEvents.e2eePublicKey, (payload) {
      handler(E2eePublicKeyRelay.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onDeliveryFailed(void Function(DeliveryFailedPayload payload) handler) {
    return _on(ChatEvents.deliveryFailed, (data) {
      handler(DeliveryFailedPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onMessageRejected(void Function(MessageRejectedPayload payload) handler) {
    return _on(ChatEvents.messageRejected, (data) {
      handler(MessageRejectedPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onError(void Function(ErrorPayload payload) handler) {
    return _on(ChatEvents.error, (data) {
      handler(ErrorPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onRegisterSuccess(void Function(AuthResult result) handler) {
    return _on(ChatEvents.registerSuccess, (payload) {
      handler(AuthResult.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onRegisterError(void Function(AuthResult result) handler) {
    return _on(ChatEvents.registerError, (payload) {
      handler(AuthResult.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onLoginSuccess(void Function(AuthResult result) handler) {
    return _on(ChatEvents.loginSuccess, (payload) {
      handler(AuthResult.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onLoginError(void Function(AuthResult result) handler) {
    return _on(ChatEvents.loginError, (payload) {
      handler(AuthResult.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onGroupCreated(void Function(GroupInfo group) handler) {
    return _on(ChatEvents.groupCreated, (payload) {
      handler(GroupInfo.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onGroupCreatedError(void Function(GroupErrorPayload payload) handler) {
    return _on(ChatEvents.groupCreatedError, (data) {
      handler(GroupErrorPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onGroupMessage(void Function(GroupMessage message) handler) {
    return _on(ChatEvents.groupMessage, (payload) {
      handler(GroupMessage.fromJson(asJsonMap(payload)));
    });
  }

  @override
  Unsubscribe onGroupMessageDeliveryFailed(void Function(GroupErrorPayload payload) handler) {
    return _on(ChatEvents.groupMessageDeliveryFailed, (data) {
      handler(GroupErrorPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onUsersDirectory(void Function(List<String> usernames) handler) {
    return _on(ChatEvents.usersDirectory, (payload) {
      handler(<String>[
        for (final entry in readList(payload)) readString(entry),
      ]);
    });
  }

  @override
  Unsubscribe onGroupMemberRemoved(void Function(GroupMemberRemovedPayload payload) handler) {
    return _on(ChatEvents.groupMemberRemoved, (data) {
      handler(GroupMemberRemovedPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onGroupKickTally(void Function(KickTally tally) handler) {
    return _on(ChatEvents.groupKickTally, (data) {
      handler(KickTally.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onMediaToken(void Function(MediaTokenPayload payload) handler) {
    return _on(ChatEvents.mediaToken, (data) {
      handler(MediaTokenPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onTypingChanged(void Function(TypingChangedPayload payload) handler) {
    return _on(ChatEvents.typingChanged, (data) {
      handler(TypingChangedPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onReceiptRead(void Function(ReceiptReadRelay payload) handler) {
    return _on(ChatEvents.receiptReadIn, (data) {
      handler(ReceiptReadRelay.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onMessageReacted(void Function(MessageReactedPayload payload) handler) {
    return _on(ChatEvents.messageReacted, (data) {
      handler(MessageReactedPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onMessageEdited(void Function(MessageEditedPayload payload) handler) {
    return _on(ChatEvents.messageEdited, (data) {
      handler(MessageEditedPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onMessageDeleted(void Function(MessageDeletedPayload payload) handler) {
    return _on(ChatEvents.messageDeleted, (data) {
      handler(MessageDeletedPayload.fromJson(asJsonMap(data)));
    });
  }

  @override
  Unsubscribe onProfileUpdated(void Function(ProfileUpdatedPayload payload) handler) {
    return _on(ChatEvents.profileUpdated, (data) {
      handler(ProfileUpdatedPayload.fromJson(asJsonMap(data)));
    });
  }

  // ── Connection lifecycle listeners ─────────────────────────────────────

  @override
  Unsubscribe onConnect(void Function() handler) {
    return _onLifecycle(ChatEvents.connect, handler);
  }

  @override
  Unsubscribe onDisconnect(void Function() handler) {
    return _onLifecycle(ChatEvents.disconnect, handler);
  }

  @override
  Unsubscribe onConnectError(void Function() handler) {
    return _onLifecycle(ChatEvents.connectError, handler);
  }

  @override
  Unsubscribe onReconnectAttempt(void Function() handler) {
    // `reconnect_attempt` is emitted by the Manager, not the Socket.
    final off = _socket.io.on(ChatEvents.reconnectAttempt, (_) => handler());
    return () => off();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /// Subscribes [handler] to [event], parsing the raw payload first.
  Unsubscribe _on(String event, void Function(Object? payload) handler) {
    final off = _socket.on(event, (dynamic data) => handler(data));
    return () => off();
  }

  /// Subscribes a payload-less lifecycle [handler] to [event].
  Unsubscribe _onLifecycle(String event, void Function() handler) {
    final off = _socket.on(event, (_) => handler());
    return () => off();
  }

  static List<T> _readList<T>(Object? payload, T Function(Map<String, dynamic>) parse) {
    return readList(payload).map((entry) => parse(asJsonMap(entry))).toList(growable: false);
  }
}
