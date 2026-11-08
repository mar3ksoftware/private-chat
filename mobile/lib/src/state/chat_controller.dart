// ── Chat state controller ─────────────────────────────────────────────────
//
// Dart port of `frontend/src/context/ChatContext.tsx`. A single ChangeNotifier
// that owns the Socket.IO connection (through [SocketService]), the E2EE
// session, and every piece of chat state the UI renders:
//
//   * connection lifecycle + stored-credential re-auth on reconnect,
//   * guest join / register / login flows,
//   * active users and groups with web-identical upsert semantics,
//   * private messages grouped per peer username and group messages per
//     groupId, deduped by their wire identity (see [PrivateMessage.dedupeKey]),
//   * deferred E2EE decryption: ciphertexts are kept until the shared key
//     arrives, then decrypted in place,
//   * friendly, human-readable error text for backend reason codes.

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../crypto/e2ee_session.dart';
import '../models/models.dart';
import '../net/socket_service.dart';

/// Connection lifecycle as observed by the UI.
enum ConnectionStatus { connecting, connected, disconnected }

// ── Stored credentials ────────────────────────────────────────────────────
//
// Kept in memory only — never persisted, exactly like `credentialsRef` in the
// web client.

sealed class _StoredCredentials {
  const _StoredCredentials();
}

final class _GuestCredentials extends _StoredCredentials {
  const _GuestCredentials(this.username);

  final String username;
}

final class _LoginCredentials extends _StoredCredentials {
  const _LoginCredentials(this.username, this.password, this.pin);

  final String username;
  final String password;
  final String? pin;
}

// ── Message bookkeeping ───────────────────────────────────────────────────

/// One message inside a per-peer or per-group bucket, keyed by its wire
/// identity so re-deliveries replace instead of duplicate.
class _Entry<T> {
  const _Entry(this.key, this.value);

  final String key;
  final T value;
}

/// A received private message waiting for its shared key to arrive.
class _PendingPrivate {
  const _PendingPrivate({
    required this.key,
    required this.wire,
    required this.decryptWith,
    required this.isOwn,
  });

  final String key;
  final PrivateMessage wire;

  /// Username whose shared key decrypts this message (the recipient for our
  /// own echoed messages, the sender otherwise).
  final String decryptWith;
  final bool isOwn;
}

/// A received group message waiting for the sender's shared key to arrive.
class _PendingGroup {
  const _PendingGroup({
    required this.key,
    required this.wire,
    required this.myEntry,
    required this.decryptWith,
    required this.isOwn,
  });

  final String key;
  final GroupMessage wire;

  /// The ciphertext addressed to us — the only copy we can decrypt.
  final GroupCiphertext myEntry;
  final String decryptWith;
  final bool isOwn;
}

// ── Controller ────────────────────────────────────────────────────────────

/// Application-level chat state, mirroring the web `ChatContext`.
class ChatController extends ChangeNotifier {
  ChatController({
    required this._socket,
    E2eeSession? e2ee,
    this._errorClearDelay = const Duration(seconds: 5),
    this._sharedKeyTimeoutMs = 3000,
  }) : _e2ee = e2ee ?? E2eeSession() {
    _listen();
    _socket.connect();
  }

  /// Convenience constructor that owns a real [IoSocketService] connected to
  /// [serverUrl]. Use `http://10.0.2.2:3000` from the Android emulator.
  factory ChatController.forServer({
    String serverUrl = SocketService.defaultUrl,
    E2eeSession? e2ee,
    Duration errorClearDelay = const Duration(seconds: 5),
    int sharedKeyTimeoutMs = 3000,
  }) {
    return ChatController(
      socket: IoSocketService(url: serverUrl),
      e2ee: e2ee,
      errorClearDelay: errorClearDelay,
      sharedKeyTimeoutMs: sharedKeyTimeoutMs,
    );
  }

  final SocketService _socket;

  /// Owns the ECDH keypair and per-peer shared keys; replaced on logout.
  E2eeSession _e2ee;

  final Duration _errorClearDelay;
  final int _sharedKeyTimeoutMs;
  final List<Unsubscribe> _subscriptions = <Unsubscribe>[];
  Timer? _errorTimer;
  bool _disposed = false;

  // ── State ──────────────────────────────────────────────────────────────

  ConnectionStatus _connectionStatus = ConnectionStatus.connecting;
  ActiveUser? _me;
  List<UserInfo> _users = <UserInfo>[];
  List<GroupInfo> _groups = <GroupInfo>[];
  List<String> _directory = <String>[];
  final Map<String, KickTally> _kickTallies = <String, KickTally>{};
  String? _selectedPeer;
  String? _selectedGroup;
  bool _isLoading = false;
  String? _error;

  _StoredCredentials? _credentials;
  String? _pendingGuest;

  final Map<String, List<_Entry<DecryptedMessage>>> _privateByPeer =
      <String, List<_Entry<DecryptedMessage>>>{};
  final Map<String, List<_Entry<DecryptedGroupMessage>>> _groupByGroup =
      <String, List<_Entry<DecryptedGroupMessage>>>{};
  final Map<String, _PendingPrivate> _pendingPrivate = <String, _PendingPrivate>{};
  final Map<String, _PendingGroup> _pendingGroup = <String, _PendingGroup>{};

  // ── Getters ────────────────────────────────────────────────────────────

  ConnectionStatus get connectionStatus => _connectionStatus;

  /// The locally authenticated identity, or null when logged out.
  ActiveUser? get me => _me;

  List<UserInfo> get users => List<UserInfo>.unmodifiable(_users);

  List<GroupInfo> get groups => List<GroupInfo>.unmodifiable(_groups);

  /// Every known username from the `users:directory` snapshot.
  List<String> get directory => List<String>.unmodifiable(_directory);

  /// The current vote-kick tally for [groupId], if one is open or terminal.
  KickTally? kickTallyFor(String groupId) => _kickTallies[groupId];

  /// Username of the selected private conversation, if any.
  String? get selectedPeer => _selectedPeer;

  /// Id of the selected group conversation, if any.
  String? get selectedGroup => _selectedGroup;

  /// True while a join/register/login attempt is in flight.
  bool get isLoading => _isLoading;

  /// Transient, user-facing error text (cleared automatically).
  String? get error => _error;

  E2eeSession get e2ee => _e2ee;

  /// Peer usernames that have at least one private message.
  List<String> get conversationPeers => List<String>.unmodifiable(_privateByPeer.keys);

  /// Group ids that have at least one group message.
  List<String> get groupConversationIds => List<String>.unmodifiable(_groupByGroup.keys);

  /// Private conversation with [peerUsername], oldest first.
  List<DecryptedMessage> messagesForPeer(String peerUsername) {
    final entries = _privateByPeer[peerUsername];
    if (entries == null) return const <DecryptedMessage>[];
    return List<DecryptedMessage>.unmodifiable(entries.map((entry) => entry.value));
  }

  /// Group conversation with [groupId], oldest first.
  List<DecryptedGroupMessage> groupMessagesFor(String groupId) {
    final entries = _groupByGroup[groupId];
    if (entries == null) return const <DecryptedGroupMessage>[];
    return List<DecryptedGroupMessage>.unmodifiable(entries.map((entry) => entry.value));
  }

  // ── Connection ─────────────────────────────────────────────────────────

  /// Opens the socket. Called once at startup; reconnects are automatic.
  void connect() {
    _socket.connect();
  }

  void _ensureConnected() {
    if (!_socket.isConnected) _socket.connect();
  }

  // ── Auth flows ─────────────────────────────────────────────────────────

  /// Joins as a guest via `user:join`.
  void joinAsGuest(String username) {
    _credentials = _GuestCredentials(username);
    _pendingGuest = username;
    _isLoading = true;
    _ensureConnected();
    _socket.sendUserJoin(UserJoinPayload(username: username));
    _notify();
  }

  /// Authenticates via `user:login`. [pin] is omitted when null/empty.
  void login(String username, String password, {String? pin}) {
    final normalized = _normalizePin(pin);
    _credentials = _LoginCredentials(username, password, normalized);
    _isLoading = true;
    _ensureConnected();
    _socket.sendLogin(
      LoginPayload(username: username, password: password, pin: normalized),
    );
    _notify();
  }

  /// Creates an account via `user:register`. [pin] is optional.
  void register(String username, String password, {String? pin}) {
    final normalized = _normalizePin(pin);
    _credentials = _LoginCredentials(username, password, normalized);
    _isLoading = true;
    _ensureConnected();
    _socket.sendRegister(
      RegisterPayload(username: username, password: password, pin: normalized),
    );
    _notify();
  }

  /// Clears credentials, drops the E2EE session and all chat state, and
  /// disconnects the socket.
  void logout() {
    _credentials = null;
    _pendingGuest = null;
    _errorTimer?.cancel();
    _errorTimer = null;
    _socket.disconnect();
    _e2ee = E2eeSession();
    _users.clear();
    _groups.clear();
    _directory.clear();
    _kickTallies.clear();
    _privateByPeer.clear();
    _groupByGroup.clear();
    _pendingPrivate.clear();
    _pendingGroup.clear();
    _me = null;
    _selectedPeer = null;
    _selectedGroup = null;
    _error = null;
    _isLoading = false;
    _notify();
  }

  static String? _normalizePin(String? pin) =>
      (pin == null || pin.isEmpty) ? null : pin;

  // ── Conversations ──────────────────────────────────────────────────────

  /// Selects the private conversation with [username] and clears the group
  /// selection (the UI shows one active conversation at a time).
  void selectPeer(String username) {
    _selectedPeer = username;
    _selectedGroup = null;
    _notify();
  }

  /// Selects the group conversation [groupId] and clears the peer selection.
  void selectGroup(String groupId) {
    _selectedGroup = groupId;
    _selectedPeer = null;
    _notify();
  }

  /// Clears both selections.
  void clearSelection() {
    _selectedPeer = null;
    _selectedGroup = null;
    _notify();
  }

  /// Sends `group:create`.
  void createGroup(String name, List<String> members) {
    _socket.sendGroupCreate(GroupCreatePayload(name: name, members: members));
  }

  /// Sends `group:member:add` — the server enforces the admin rules.
  void addMember(String groupId, String username) {
    _socket.sendGroupMemberAdd(
      GroupTargetPayload(groupId: groupId, username: username),
    );
  }

  /// Sends `group:member:remove` — the server enforces the admin rules.
  void removeMember(String groupId, String username) {
    _socket.sendGroupMemberRemove(
      GroupTargetPayload(groupId: groupId, username: username),
    );
  }

  /// Sends `group:kick:vote` to vote [username] out of [groupId].
  void kickVote(String groupId, String username) {
    _socket.sendGroupKickVote(
      GroupTargetPayload(groupId: groupId, username: username),
    );
  }

  /// Encrypts [plaintext] for [toUsername] and emits `message:send`.
  ///
  /// Waits briefly for the shared key exchange to complete; returns false and
  /// surfaces a friendly error when it does not.
  Future<bool> sendMessage(String toUsername, String plaintext) async {
    final me = _me;
    if (me == null || toUsername == me.username) return false;
    try {
      final ready = await _e2ee.waitForSharedKey(
        toUsername,
        timeoutMs: _sharedKeyTimeoutMs,
      );
      if (!ready) {
        _showError('Secure session not ready. Please try again.');
        return false;
      }
      final payload = await _e2ee.encrypt(toUsername, plaintext);
      _socket.sendMessageSend(
        EncryptedMessagePayload(
          to: toUsername,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
        ),
      );
      return true;
    } catch (_) {
      _showError('Failed to send message. Please try again.');
      return false;
    }
  }

  /// Encrypts [plaintext] for every group member we share a key with and
  /// emits `group:message:send`.
  ///
  /// Our own copy is always included (via the self key) so our echoed message
  /// decrypts locally, mirroring the web client.
  Future<bool> sendGroupMessage(String groupId, String plaintext) async {
    final me = _me;
    final groupIndex = _groups.indexWhere((g) => g.groupId == groupId);
    if (me == null || groupIndex == -1) return false;
    final group = _groups[groupIndex];

    try {
      // Ensure we can decrypt our own echoed group message.
      await _e2ee.ensureSelfKey(me.username);

      final ciphertexts = <GroupCiphertext>[];
      for (final member in group.members) {
        if (!_e2ee.hasSharedKey(member.username)) continue;
        try {
          final payload = await _e2ee.encrypt(member.username, plaintext);
          ciphertexts.add(
            GroupCiphertext(
              to: member.username,
              ciphertext: payload.ciphertext,
              iv: payload.iv,
            ),
          );
        } catch (_) {
          if (member.username == me.username) {
            _showError('Failed to encrypt group message. Please try again.');
            return false;
          }
        }
      }

      if (ciphertexts.isEmpty) {
        _showError('Secure session not ready. Please try again.');
        return false;
      }

      _socket.sendGroupMessage(
        GroupEncryptedPayload(groupId: groupId, ciphertexts: ciphertexts),
      );
      return true;
    } catch (_) {
      _showError('Failed to send message. Please try again.');
      return false;
    }
  }

  // ── Errors ─────────────────────────────────────────────────────────────

  /// Shows [message] and clears it automatically after the error delay.
  void showError(String message) => _showError(message);

  /// Clears the current error immediately.
  void clearError() {
    _errorTimer?.cancel();
    _errorTimer = null;
    _error = null;
    _notify();
  }

  void _showError(String message) {
    if (message.isEmpty) return;
    _error = message;
    _errorTimer?.cancel();
    _errorTimer = Timer(_errorClearDelay, () {
      _errorTimer = null;
      _error = null;
      _notify();
    });
    _notify();
  }

  // ── Listener wiring ────────────────────────────────────────────────────

  void _listen() {
    _subscriptions.addAll(<Unsubscribe>[
      _socket.onConnect(_handleConnect),
      _socket.onDisconnect(_handleDisconnect),
      _socket.onConnectError(_handleConnectError),
      _socket.onReconnectAttempt(_handleReconnectAttempt),
      _socket.onLoginSuccess(_handleAuthSuccess),
      _socket.onLoginError(_handleAuthFailure),
      _socket.onRegisterSuccess(_handleAuthSuccess),
      _socket.onRegisterError(_handleAuthFailure),
      _socket.onUserJoined(_handleUserJoined),
      _socket.onUserLeft(_handleUserLeft),
      _socket.onActiveUsers(_handleActiveUsers),
      _socket.onActiveGroups(_handleActiveGroups),
      _socket.onE2eePublicKey(_handleE2eePublicKey),
      _socket.onPrivateMessage(_handlePrivateMessage),
      _socket.onGroupCreated(_handleGroupCreated),
      _socket.onGroupCreatedError(_handleGroupError),
      _socket.onGroupMessage(_handleGroupMessage),
      _socket.onGroupMessageDeliveryFailed(_handleGroupError),
      _socket.onUsersDirectory(_handleUsersDirectory),
      _socket.onGroupMemberRemoved(_handleGroupMemberRemoved),
      _socket.onGroupKickTally(_handleKickTally),
      _socket.onDeliveryFailed(_handleDeliveryFailed),
      _socket.onMessageRejected(_handleMessageRejected),
      _socket.onError(_handleErrorEvent),
    ]);
  }

  // ── Connection lifecycle handlers ──────────────────────────────────────

  void _handleConnect() {
    _connectionStatus = ConnectionStatus.connected;
    final credentials = _credentials;
    if (credentials != null && _me != null) {
      // Re-authenticate so the server can reattach the existing session
      // (mirrors the `connect` handler in ChatContext.tsx).
      switch (credentials) {
        case _GuestCredentials(:final username):
          _pendingGuest = username;
          _socket.sendUserJoin(UserJoinPayload(username: username));
        case _LoginCredentials(:final username, :final password, :final pin):
          _socket.sendLogin(
            LoginPayload(username: username, password: password, pin: pin),
          );
      }
    }
    _notify();
  }

  void _handleDisconnect() {
    _connectionStatus = ConnectionStatus.disconnected;
    _notify();
  }

  void _handleConnectError() {
    _connectionStatus = ConnectionStatus.disconnected;
    _notify();
  }

  void _handleReconnectAttempt() {
    _connectionStatus = ConnectionStatus.connecting;
    _notify();
  }

  // ── Auth handlers ──────────────────────────────────────────────────────

  void _handleAuthSuccess(AuthResult result) {
    if (result is! AuthSuccess) return;
    _pendingGuest = null;
    _me = ActiveUser(
      userId: result.userId,
      username: result.username,
      isGuest: false,
    );
    _isLoading = false;
    _notify();
  }

  void _handleAuthFailure(AuthResult result) {
    if (result is! AuthFailure) return;
    _isLoading = false;
    _showError(friendlyReason(result.reason.isEmpty ? 'internal_error' : result.reason));
  }

  // ── Roster handlers ────────────────────────────────────────────────────

  void _handleUserJoined(UserInfo user) {
    final pending = _pendingGuest;
    if (pending != null && user.username == pending) {
      _pendingGuest = null;
      _me = ActiveUser(
        userId: user.userId,
        username: user.username,
        isGuest: true,
      );
      _isLoading = false;
    }
    if (!_directory.contains(user.username)) _directory.add(user.username);
    _upsertUser(user);

    final me = _me;
    if (me != null && user.username == me.username) return;

    // A rejoining peer may have a fresh keypair; drop any stale shared key so
    // sends wait for the new exchange instead of using an unusable key.
    _e2ee.forgetSharedKey(user.username);
    final myUsername = me?.username;
    if (myUsername != null && myUsername.isNotEmpty) {
      // Keep our self key available for group self-decryption.
      unawaited(_ignoreErrors(_e2ee.ensureSelfKey(myUsername)));
    }
    _sendPublicKeyTo(user.username);
  }

  void _handleUserLeft(UserLeftPayload payload) {
    _users.removeWhere((user) => user.userId == payload.userId);
    _notify();
  }

  void _handleActiveUsers(List<UserInfo> users) {
    _users = List<UserInfo>.of(users);
    _notify();
    // Include ourselves: the server relays the key back to our own room,
    // which gives us the self shared key used to decrypt our own group
    // echoes (mirrors ChatContext.tsx).
    for (final user in users) {
      _sendPublicKeyTo(user.username);
    }
  }

  void _handleActiveGroups(List<GroupInfo> groups) {
    _groups = List<GroupInfo>.of(groups);
    // The server re-sends the active tallies right after this snapshot.
    _kickTallies.clear();
    _notify();
  }

  void _handleUsersDirectory(List<String> names) {
    _directory = List<String>.of(names);
    _notify();
  }

  void _handleGroupCreated(GroupInfo group) {
    // Full group state — re-sent on create and every membership change; replace on same id.
    final index = _groups.indexWhere((g) => g.groupId == group.groupId);
    if (index == -1) {
      _groups.add(group);
    } else {
      _groups[index] = group;
    }
    _notify();
  }

  void _handleGroupMemberRemoved(GroupMemberRemovedPayload payload) {
    if (payload.username != _me?.username) {
      // Only the removed user is targeted; everyone else updates through the
      // re-sent `group:created`.
      _notify();
      return;
    }
    final index = _groups.indexWhere((g) => g.groupId == payload.groupId);
    final name = index == -1 ? null : _groups[index].name;
    if (index != -1) _groups.removeAt(index);
    _kickTallies.remove(payload.groupId);
    if (_selectedGroup == payload.groupId) _selectedGroup = null;
    _showError(
      payload.reason == 'kicked'
          ? 'You were voted out of ${name ?? 'the group'}.'
          : 'You were removed from ${name ?? 'the group'}.',
    );
  }

  void _handleKickTally(KickTally tally) {
    _kickTallies[tally.groupId] = tally;
    _notify();
  }

  void _upsertUser(UserInfo user) {
    // `user:joined` is re-emitted on reconnect, so upsert instead of append.
    final index = _users.indexWhere((u) => u.userId == user.userId);
    if (index == -1) {
      _users.add(user);
    } else {
      _users[index] = user;
    }
    _notify();
  }

  // ── E2EE handlers ──────────────────────────────────────────────────────

  void _sendPublicKeyTo(String to) {
    unawaited(_emitPublicKey(to));
  }

  Future<void> _emitPublicKey(String to) async {
    try {
      final publicKey = await _e2ee.getPublicKey();
      if (_disposed) return;
      _socket.sendE2eePublicKey(
        E2eePublicKeyPayload(to: to, publicKey: publicKey),
      );
    } catch (_) {
      // Key generation failure surfaces later as a send error.
    }
  }

  Future<void> _handleE2eePublicKey(E2eePublicKeyRelay relay) async {
    try {
      await _e2ee.deriveSharedSecret(relay.fromUsername, relay.publicKey);
    } catch (_) {
      return;
    }
    // The key we were waiting for may have just arrived.
    _retryPendingDecryptions();
  }

  // ── Private message handling ───────────────────────────────────────────

  void _handlePrivateMessage(PrivateMessage message) {
    final me = _me;
    final isOwn = me != null && message.from == me.userId;
    // Our own echoed message is encrypted with the recipient's shared key,
    // not with our self key.
    final decryptWith = isOwn ? message.toUsername : message.fromUsername;
    final pending = _PendingPrivate(
      key: message.dedupeKey,
      wire: message,
      decryptWith: decryptWith,
      isOwn: isOwn,
    );
    _pendingPrivate[pending.key] = pending;

    if (!_e2ee.hasSharedKey(decryptWith)) {
      // Keep the ciphertext and decrypt once the key exchange completes.
      _upsertPrivate(
        pending,
        _privateMessage(
          wire: message,
          isOwn: isOwn,
          plaintext: '[Encrypted]',
          decryptionFailed: true,
        ),
      );
      return;
    }
    unawaited(_resolvePrivate(pending));
  }

  Future<void> _resolvePrivate(_PendingPrivate pending) async {
    if (_disposed) return;
    if (!_e2ee.hasSharedKey(pending.decryptWith)) return;
    try {
      final plaintext = await _e2ee.decrypt(
        pending.decryptWith,
        pending.wire.ciphertext,
        pending.wire.iv,
      );
      if (_disposed) return;
      _pendingPrivate.remove(pending.key);
      _upsertPrivate(
        pending,
        _privateMessage(
          wire: pending.wire,
          isOwn: pending.isOwn,
          plaintext: plaintext,
          decryptionFailed: false,
        ),
      );
    } catch (error) {
      if (_disposed) return;
      // The shared key vanished mid-flight (peer rejoin); keep waiting.
      if (error is StateError) return;
      _pendingPrivate.remove(pending.key);
      _upsertPrivate(
        pending,
        _privateMessage(
          wire: pending.wire,
          isOwn: pending.isOwn,
          plaintext: '[Decryption failed]',
          decryptionFailed: true,
        ),
      );
    }
  }

  void _upsertPrivate(_PendingPrivate pending, DecryptedMessage message) {
    _upsert(_privateByPeer, message.peerUsername, pending.key, message);
  }

  static DecryptedMessage _privateMessage({
    required PrivateMessage wire,
    required bool isOwn,
    required String plaintext,
    required bool decryptionFailed,
  }) {
    return DecryptedMessage(
      from: wire.from,
      fromUsername: wire.fromUsername,
      to: wire.to,
      toUsername: wire.toUsername,
      plaintext: plaintext,
      timestamp: wire.timestamp,
      isOwn: isOwn,
      decryptionFailed: decryptionFailed,
    );
  }

  // ── Group message handling ─────────────────────────────────────────────

  void _handleGroupMessage(GroupMessage message) {
    final me = _me;
    if (me == null) return;

    GroupCiphertext? myEntry;
    for (final entry in message.ciphertexts) {
      if (entry.to == me.username) {
        myEntry = entry;
        break;
      }
    }

    final key = message.dedupeKey;
    final isOwn = message.from == me.userId;
    if (myEntry == null) {
      // No ciphertext addressed to us; show a placeholder like the web
      // client (there is nothing to decrypt later).
      _upsert(
        _groupByGroup,
        message.groupId,
        key,
        _groupMessage(
          wire: message,
          isOwn: isOwn,
          plaintext: '[Encrypted]',
          decryptionFailed: true,
        ),
      );
      return;
    }

    final pending = _PendingGroup(
      key: key,
      wire: message,
      myEntry: myEntry,
      decryptWith: message.fromUsername,
      isOwn: isOwn,
    );
    _pendingGroup[pending.key] = pending;

    if (!_e2ee.hasSharedKey(pending.decryptWith)) {
      _upsert(
        _groupByGroup,
        message.groupId,
        pending.key,
        _groupMessage(
          wire: message,
          isOwn: isOwn,
          plaintext: '[Encrypted]',
          decryptionFailed: true,
        ),
      );
      return;
    }
    unawaited(_resolveGroup(pending));
  }

  Future<void> _resolveGroup(_PendingGroup pending) async {
    if (_disposed) return;
    if (!_e2ee.hasSharedKey(pending.decryptWith)) return;
    try {
      final plaintext = await _e2ee.decrypt(
        pending.decryptWith,
        pending.myEntry.ciphertext,
        pending.myEntry.iv,
      );
      if (_disposed) return;
      _pendingGroup.remove(pending.key);
      _upsert(
        _groupByGroup,
        pending.wire.groupId,
        pending.key,
        _groupMessage(
          wire: pending.wire,
          isOwn: pending.isOwn,
          plaintext: plaintext,
          decryptionFailed: false,
        ),
      );
    } catch (error) {
      if (_disposed) return;
      if (error is StateError) return;
      _pendingGroup.remove(pending.key);
      _upsert(
        _groupByGroup,
        pending.wire.groupId,
        pending.key,
        _groupMessage(
          wire: pending.wire,
          isOwn: pending.isOwn,
          plaintext: '[Decryption failed]',
          decryptionFailed: true,
        ),
      );
    }
  }

  static DecryptedGroupMessage _groupMessage({
    required GroupMessage wire,
    required bool isOwn,
    required String plaintext,
    required bool decryptionFailed,
  }) {
    return DecryptedGroupMessage(
      groupId: wire.groupId,
      from: wire.from,
      fromUsername: wire.fromUsername,
      plaintext: plaintext,
      timestamp: wire.timestamp,
      isOwn: isOwn,
      decryptionFailed: decryptionFailed,
    );
  }

  /// Re-runs decryption for every message still waiting on a shared key.
  void _retryPendingDecryptions() {
    if (_disposed) return;
    for (final pending in List<_PendingPrivate>.of(_pendingPrivate.values)) {
      unawaited(_resolvePrivate(pending));
    }
    for (final pending in List<_PendingGroup>.of(_pendingGroup.values)) {
      unawaited(_resolveGroup(pending));
    }
  }

  // ── Error handlers ─────────────────────────────────────────────────────

  void _handleDeliveryFailed(DeliveryFailedPayload payload) {
    _showError('Message to ${payload.to} failed: ${friendlyReason(payload.reason)}');
  }

  void _handleMessageRejected(MessageRejectedPayload payload) {
    _showError(friendlyErrorText(payload.reason));
  }

  void _handleErrorEvent(ErrorPayload payload) {
    _showError(friendlyErrorText(payload.message));
  }

  void _handleGroupError(GroupErrorPayload payload) {
    _showError(friendlyErrorText(payload.message));
  }

  // ── Internals ──────────────────────────────────────────────────────────

  void _upsert<T>(
    Map<String, List<_Entry<T>>> store,
    String bucket,
    String key,
    T value,
  ) {
    final list = store.putIfAbsent(bucket, () => <_Entry<T>>[]);
    final entry = _Entry<T>(key, value);
    final index = list.indexWhere((existing) => existing.key == key);
    if (index == -1) {
      list.add(entry);
    } else {
      list[index] = entry;
    }
    _notify();
  }

  Future<void> _ignoreErrors(Future<void> future) => future.catchError((Object _) {});

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _errorTimer?.cancel();
    _errorTimer = null;
    for (final unsubscribe in _subscriptions) {
      unsubscribe();
    }
    _subscriptions.clear();
    _socket.disconnect();
    super.dispose();
  }
}
