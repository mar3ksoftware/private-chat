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
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../crypto/e2ee.dart';
import '../crypto/e2ee_session.dart';
import '../crypto/media_crypto.dart';
import '../models/models.dart';
import '../net/media_client.dart';
import '../net/socket_service.dart';
import '../utils/envelope.dart';
import '../utils/mentions.dart';
import '../utils/profile.dart';
import '../utils/uuid.dart';

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

/// An optimistic tier-1 operation awaiting a possible `message_rejected`;
/// the rejection carries no correlation id, so rollbacks are matched
/// newest-first within a short window (mirrors `PendingOp` on the web).
class _PendingOp {
  const _PendingOp(this.at, this.undo);

  final int at;
  final void Function() undo;
}

const int _pendingOpTtlMs = 5000;

/// A no-op placeholder op: unrelated emits (plain sends, typing, receipts)
/// register one so their own rejection pops this instead of a real rollback.
void _noopOp() {}

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
    this._mediaClient,
    this._serverUrl,
    this._errorClearDelay = const Duration(seconds: 5),
    this._sharedKeyTimeoutMs = 3000,
    this.typingRepeatDelay = const Duration(milliseconds: 4000),
    this.typingHideDelay = const Duration(milliseconds: 6000),
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
      mediaClient: HttpMediaClient(baseUrl: serverUrl),
      serverUrl: serverUrl,
      errorClearDelay: errorClearDelay,
      sharedKeyTimeoutMs: sharedKeyTimeoutMs,
    );
  }

  final SocketService _socket;

  /// Transport for `PUT`/`GET /media`; null in tests that fake it.
  final MediaClient? _mediaClient;

  /// Backend origin used by [_mediaClient].
  final String? _serverUrl;

  /// Owns the ECDH keypair and per-peer shared keys; replaced on logout.
  E2eeSession _e2ee;

  final Duration _errorClearDelay;
  final int _sharedKeyTimeoutMs;

  /// Outgoing typing cadence: re-emit `typing:send` at this interval while a
  /// burst is live (web `TYPING_REPEAT_MS`).
  final Duration typingRepeatDelay;

  /// Receiver-side auto-hide: an incoming indicator disappears after this
  /// even if `active:false` never arrives (web `TYPING_HIDE_MS`).
  final Duration typingHideDelay;

  /// Default typing hide window, in milliseconds (spec C1: 6 s).
  static const int typingHideMs = 6000;

  /// Default typing repeat cadence, in milliseconds (spec C1: 4 s).
  static const int typingRepeatMs = 4000;

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

  String? _mediaToken;
  final Map<String, MediaFetchResult> _mediaByFileId = <String, MediaFetchResult>{};
  final Map<String, Future<MediaFetchResult>> _mediaInFlight =
      <String, Future<MediaFetchResult>>{};

  final Map<String, List<_Entry<DecryptedMessage>>> _privateByPeer =
      <String, List<_Entry<DecryptedMessage>>>{};
  final Map<String, List<_Entry<DecryptedGroupMessage>>> _groupByGroup =
      <String, List<_Entry<DecryptedGroupMessage>>>{};
  final Map<String, _PendingPrivate> _pendingPrivate = <String, _PendingPrivate>{};
  final Map<String, _PendingGroup> _pendingGroup = <String, _PendingGroup>{};

  // ── Tier-1 state ──────────────────────────────────────────────────────

  /// Per-conversation unread counters (C7), keyed `dm:{username}` /
  /// `group:{groupId}`. Client-side only — never persisted.
  final Map<String, UnreadEntry> _unread = <String, UnreadEntry>{};

  /// Wire dedupe keys that already incremented unread; a deferred
  /// decryption may reveal a mention afterwards without double-counting.
  final Set<String> _unreadCounted = <String>{};

  /// Reactions per target message id → emoji → usernames (C5).
  final Map<String, Map<String, Set<String>>> _reactions =
      <String, Map<String, Set<String>>>{};

  /// DM peer → highest `receipt:read` upTo received from them (C2).
  final Map<String, int> _readUpTo = <String, int>{};

  /// Conversation typing keys → expiry of the last active flag (C1).
  final Map<String, int> _typing = <String, int>{};

  /// Known profiles keyed by username (C9).
  final Map<String, ProfileEntry> _profiles = <String, ProfileEntry>{};

  /// Outgoing typing burst: the live conversation and its repeat timer.
  ConversationTarget? _typingTarget;
  bool _typingBurstActive = false;
  Timer? _typingRepeatTimer;

  /// Receiver-side auto-hide timers, keyed like [_typing].
  final Map<String, Timer> _typingHideTimers = <String, Timer>{};

  /// Highest `receipt:read` upTo already sent per peer — keeps repeats off
  /// the shared rate-limit bucket (C2).
  final Map<String, int> _lastSentReceipt = <String, int>{};

  /// Optimistic react/edit/delete/profile ops awaiting a possible
  /// `message_rejected`; rollbacks are matched newest-first within the TTL.
  final List<_PendingOp> _pendingOps = <_PendingOp>[];

  /// Whether the app currently has focus (C7's background rule).
  bool _appFocused = true;

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

  /// Backend origin this controller talks to, when known.
  String? get serverUrl => _serverUrl;

  /// Bearer token for the `/media` HTTP endpoints (null until the server
  /// sends `media:token`, cleared on logout).
  String? get mediaToken => _mediaToken;

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

  // ── Tier-1 getters ────────────────────────────────────────────────────

  /// Unread state per conversation key (`dm:{username}` / `group:{groupId}`).
  Map<String, UnreadEntry> get unread => Map<String, UnreadEntry>.unmodifiable(_unread);

  /// Whether the app currently has focus (mirror of the web
  /// `document.hasFocus() && visibilityState === 'visible'`).
  bool get appFocused => _appFocused;

  /// The unread badge label for [target], or null when nothing is unread.
  /// Counts above 99 collapse to `99+` (spec D).
  String? unreadBadgeFor(ConversationTarget target) {
    final count = _unread[_unreadKey(target)]?.count ?? 0;
    if (count == 0) return null;
    return count > 99 ? '99+' : '$count';
  }

  /// Unread entry for [target] (zeroed when never seen).
  UnreadEntry unreadFor(ConversationTarget target) =>
      _unread[_unreadKey(target)] ?? const UnreadEntry();

  /// Whether [target] holds an unread mention of the current user (C7).
  bool hasMentionFor(ConversationTarget target) =>
      _unread[_unreadKey(target)]?.mention == true;

  /// Highest `receipt:read` upTo received from DM [peer] (C2).
  int readUpToFor(String peer) => _readUpTo[peer] ?? 0;

  /// Known profile for [username], when the server has sent one.
  ProfileEntry? profileFor(String username) => _profiles[username];

  /// Display name for [username] with the username as fallback (C9).
  String displayNameOf(String username) {
    final display = _profiles[username]?.displayName;
    return (display == null || display.isEmpty) ? username : display;
  }

  /// Status text for [username]; '' when unset (C9).
  String statusOf(String username) => _profiles[username]?.status ?? '';

  /// Usernames currently typing in the DM [peer] or group [groupId], in
  /// roster order; our own name is never included (C1).
  List<String> typingUsernamesIn({String? peer, String? groupId}) {
    final id = groupId;
    if (id != null) {
      final groupIndex = _groups.indexWhere((g) => g.groupId == id);
      if (groupIndex == -1) return const <String>[];
      final myUsername = _me?.username;
      return <String>[
        for (final member in _groups[groupIndex].members)
          if (member.username != myUsername &&
              _typing.containsKey('group:$id:${member.username}'))
            member.username,
      ];
    }
    final username = peer;
    if (username == null) return const <String>[];
    return _typing.containsKey('dm:$username') ? <String>[username] : const <String>[];
  }

  /// Reactions on message [targetId]: emoji → usernames (C5).
  Map<String, Set<String>> reactionsFor(String targetId) {
    final agg = _reactions[targetId];
    if (agg == null) return const <String, Set<String>>{};
    return Map<String, Set<String>>.unmodifiable(agg);
  }

  static String _unreadKey(ConversationTarget target) =>
      target.isGroup ? 'group:${target.groupId}' : 'dm:${target.username}';

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
    _stopTypingBurst();
    _clearTypingIndicators();
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
    _unread.clear();
    _unreadCounted.clear();
    _reactions.clear();
    _readUpTo.clear();
    _typing.clear();
    _profiles.clear();
    _lastSentReceipt.clear();
    _pendingOps.clear();
    _mediaToken = null;
    _mediaByFileId.clear();
    _mediaInFlight.clear();
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
  /// selection (the UI shows one active conversation at a time). Opening
  /// clears the conversation's unread counter and — while the app is
  /// focused — sends the read receipt (C7/C2).
  void selectPeer(String username) {
    _selectedPeer = username;
    _selectedGroup = null;
    _clearUnread('dm:$username');
    final upTo = _computeUpTo(username);
    if (upTo != null && _appFocused) sendReadReceipt(username, upTo);
    _notify();
  }

  /// Selects the group conversation [groupId] and clears the peer
  /// selection; opening clears the group's unread counter (C7).
  void selectGroup(String groupId) {
    _selectedGroup = groupId;
    _selectedPeer = null;
    _clearUnread('group:$groupId');
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

  /// Encrypts a text [body] for [toUsername] inside the canonical v2
  /// envelope (spec C3: always wrapped, reply ref included when set) and
  /// emits `message:send` with a fresh client UUID.
  ///
  /// Waits briefly for the shared key exchange to complete; returns false and
  /// surfaces a friendly error when it does not.
  Future<bool> sendMessage(
    String toUsername,
    String body, {
    Map<String, dynamic>? reply,
  }) => _sendEncrypted(toUsername, wrapTextEnvelope(body, reply));

  /// Low-level `message:send` for an already-wrapped plaintext (media
  /// descriptors stay unwrapped — the parser branches on `t` first).
  Future<bool> _sendEncrypted(String toUsername, String plaintext) async {
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
      _enqueueOp(_noopOp);
      _socket.sendMessageSend(
        EncryptedMessagePayload(
          id: generateUuidV4(),
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

  /// Text counterpart of [sendMessage]: wraps [body] (with the optional
  /// reply ref) then encrypts per member and emits `group:message:send`.
  Future<bool> sendGroupMessage(
    String groupId,
    String body, {
    Map<String, dynamic>? reply,
  }) => _sendGroupEncrypted(groupId, wrapTextEnvelope(body, reply));

  /// Encrypts [plaintext] for every group member we share a key with and
  /// emits `group:message:send`.
  ///
  /// Our own copy is always included (via the self key) so our echoed message
  /// decrypts locally, mirroring the web client.
  Future<bool> _sendGroupEncrypted(String groupId, String plaintext) async {
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

      _enqueueOp(_noopOp);
      _socket.sendGroupMessage(
        GroupEncryptedPayload(
          id: generateUuidV4(),
          groupId: groupId,
          ciphertexts: ciphertexts,
        ),
      );
      return true;
    } catch (_) {
      _showError('Failed to send message. Please try again.');
      return false;
    }
  }

  // ── Media ──────────────────────────────────────────────────────────────

  static const int _maxMediaBytes = 16 * 1024 * 1024;

  static const Set<String> _mediaMimeAllowlist = <String>{
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
  };

  void _handleMediaToken(MediaTokenPayload payload) {
    _mediaToken = payload.token;
    _notify();
  }

  /// Prepares and uploads a private attachment, then sends the descriptor
  /// envelope through the low-level send path (contract order:
  /// validate → strip → size → encrypt → upload → envelope → send).
  Future<bool> sendMediaMessage(
    String toUsername,
    Uint8List bytes, {
    required String mime,
    String? name,
  }) {
    return _sendMedia(
      bytes: bytes,
      mime: mime,
      name: name,
      send: (envelope) => _sendEncrypted(toUsername, envelope),
    );
  }

  /// Group counterpart of [sendMediaMessage]; the envelope is encrypted per
  /// member by the group send path and the file is uploaded exactly once.
  Future<bool> sendGroupMediaMessage(
    String groupId,
    Uint8List bytes, {
    required String mime,
    String? name,
  }) {
    return _sendMedia(
      bytes: bytes,
      mime: mime,
      name: name,
      send: (envelope) => _sendGroupEncrypted(groupId, envelope),
    );
  }

  Future<bool> _sendMedia({
    required Uint8List bytes,
    required String mime,
    required String? name,
    required Future<bool> Function(String envelope) send,
  }) async {
    if (bytes.length > _maxMediaBytes) {
      _showError('File is too large (16 MB max).');
      return false;
    }
    if (!_mediaMimeAllowlist.contains(mime)) {
      _showError('Unsupported file type.');
      return false;
    }
    final mediaClient = _mediaClient;
    final token = _mediaToken;
    if (mediaClient == null || token == null) {
      _showError('Not connected. Please try again.');
      return false;
    }

    var content = bytes;
    int? width;
    int? height;
    if (mime.startsWith('image/')) {
      final stripped = stripImageMetadata(bytes, mime);
      if (stripped == null) {
        _showError('Could not process that file.');
        return false;
      }
      content = stripped;
      final dimensions = await readImageSize(content);
      if (dimensions == null) {
        _showError('Could not process that file.');
        return false;
      }
      width = dimensions.w;
      height = dimensions.h;
    }

    final fileId = generateMediaId();
    final key = randomBytes32();
    final iv = randomIv12();
    final ciphertext = encryptBytes(content, key, iv);
    final sha256 = sha256Base64(ciphertext);

    try {
      final uploaded = await mediaClient.upload(
        fileId: fileId,
        ciphertext: ciphertext,
        token: token,
      );
      if (!uploaded) {
        _showError('Upload failed. Please try again.');
        return false;
      }
    } on MediaUploadException catch (error) {
      _showError(error.message);
      return false;
    } catch (_) {
      _showError('Upload failed. Please try again.');
      return false;
    }

    final normalizedName = _normalizeMediaName(name);
    final envelopeParts = <String, Object?>{
      't': 'media',
      'v': 1,
      'fileId': fileId,
      'key': base64Encode(key),
      'iv': base64Encode(iv),
      'sha256': sha256,
      'mime': mime,
      'size': content.length,
    };
    if (width != null) envelopeParts['w'] = width;
    if (height != null) envelopeParts['h'] = height;
    if (normalizedName != null) envelopeParts['name'] = normalizedName;
    return send(jsonEncode(envelopeParts));
  }

  /// Basename with control characters removed, truncated to 120 chars;
  /// null when nothing usable remains (the descriptor then omits `name`).
  static String? _normalizeMediaName(String? name) {
    if (name == null) return null;
    var base = name;
    final slash = base.lastIndexOf(RegExp(r'[/\\]'));
    if (slash != -1) base = base.substring(slash + 1);

    final cleaned = StringBuffer();
    for (final rune in base.runes) {
      if (rune < 0x20 || (rune >= 0x7F && rune <= 0x9F)) continue;
      cleaned.writeCharCode(rune);
    }
    var result = cleaned.toString();
    if (result.isEmpty) return null;
    if (result.length > 120) {
      result = result.substring(0, 120);
      final last = result.codeUnitAt(result.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) {
        result = result.substring(0, 119);
      }
    }
    return result;
  }

  /// Fetches, verifies and decrypts one attachment, cached per `fileId` for
  /// the session (ready/expired/integrity results; auth and network failures
  /// stay uncached so a later render can retry). [descriptor] is never
  /// decrypted into bytes before its ciphertext hash matches.
  Future<MediaFetchResult> loadMedia(MediaDescriptor descriptor) {
    final cached = _mediaByFileId[descriptor.fileId];
    if (cached != null) return Future<MediaFetchResult>.value(cached);
    final pending = _mediaInFlight[descriptor.fileId];
    if (pending != null) return pending;

    final future = _fetchMedia(descriptor);
    _mediaInFlight[descriptor.fileId] = future;
    unawaited(
      future.whenComplete(() {
        if (identical(_mediaInFlight[descriptor.fileId], future)) {
          _mediaInFlight.remove(descriptor.fileId);
        }
      }),
    );
    return future;
  }

  Future<MediaFetchResult> _fetchMedia(MediaDescriptor descriptor) async {
    final mediaClient = _mediaClient;
    final token = _mediaToken;
    if (mediaClient == null || token == null) {
      // Bubble-local state only: a missing token never toasts.
      return const MediaFetchResult.error();
    }

    final fetched = await mediaClient.download(
      fileId: descriptor.fileId,
      token: token,
    );
    if (fetched.status == 'expired') {
      _mediaByFileId[descriptor.fileId] = fetched;
      return fetched;
    }
    final ciphertext = fetched.bytes;
    if (fetched.status != 'ready' || ciphertext == null) {
      return const MediaFetchResult.error();
    }

    if (sha256Base64(ciphertext) != descriptor.sha256) {
      return _cacheFailure(descriptor.fileId);
    }
    try {
      final plain = decryptBytes(
        ciphertext,
        base64Decode(descriptor.key),
        base64Decode(descriptor.iv),
      );
      final result = MediaFetchResult.ready(plain);
      _mediaByFileId[descriptor.fileId] = result;
      return result;
    } catch (_) {
      return _cacheFailure(descriptor.fileId);
    }
  }

  MediaFetchResult _cacheFailure(String fileId) {
    const failure = MediaFetchResult.error();
    _mediaByFileId[fileId] = failure;
    return failure;
  }

  // ── Typing (C1) ────────────────────────────────────────────────────────

  /// Starts (or keeps alive) the outgoing typing burst for [target]. While
  /// the burst is live the timer re-emits every [typingRepeatDelay]; a
  /// repeat call for the same conversation is throttled to that cadence.
  void sendTyping(ConversationTarget target) {
    if (_typingBurstActive && _typingTarget == target) return;
    if (_typingBurstActive) {
      // Conversation switched mid-burst: clear the previous indicator first.
      _stopTypingBurst();
    }
    _typingTarget = target;
    _typingBurstActive = true;
    _emitTyping(target, active: true);
    _typingRepeatTimer = Timer.periodic(typingRepeatDelay, (_) {
      final live = _typingTarget;
      if (!_typingBurstActive || live == null) return;
      _emitTyping(live, active: true);
    });
  }

  /// Ends the outgoing burst with an `active:false` (C1).
  void stopTyping() => _stopTypingBurst();

  void _stopTypingBurst() {
    _typingRepeatTimer?.cancel();
    _typingRepeatTimer = null;
    final target = _typingTarget;
    if (_typingBurstActive && target != null) _emitTyping(target, active: false);
    _typingBurstActive = false;
    _typingTarget = null;
  }

  void _emitTyping(ConversationTarget target, {required bool active}) {
    if (!_socket.isConnected) return;
    _enqueueOp(_noopOp);
    _socket.sendTypingSend(
      TypingSendPayload(
        to: target.isDm ? target.username : null,
        groupId: target.isGroup ? target.groupId : null,
        active: active,
      ),
    );
  }

  void _handleTypingChanged(TypingChangedPayload payload) {
    final key = payload.groupId != null
        ? 'group:${payload.groupId}:${payload.fromUsername}'
        : 'dm:${payload.fromUsername}';

    _typingHideTimers[key]?.cancel();
    _typingHideTimers.remove(key);

    if (!payload.active) {
      if (_typing.remove(key) != null) _notify();
      return;
    }
    _typing[key] = DateTime.now().millisecondsSinceEpoch + typingHideMs;
    // Auto-hide even when `active:false` is lost (spec C1: 6 s).
    _typingHideTimers[key] = Timer(typingHideDelay, () {
      _typingHideTimers.remove(key);
      if (_typing.remove(key) != null) _notify();
    });
    _notify();
  }

  /// Drops every incoming indicator and its timer (disconnect/logout).
  void _clearTypingIndicators() {
    for (final timer in _typingHideTimers.values) {
      timer.cancel();
    }
    _typingHideTimers.clear();
    _typing.clear();
  }

  // ── Read receipts (C2) ────────────────────────────────────────────────

  /// Emits `receipt:read` for [peer] when [upTo] advances past the last
  /// receipt we sent (repeats are dropped to spare the rate-limit bucket).
  void sendReadReceipt(String peer, int upTo) {
    if (!_socket.isConnected) return;
    final last = _lastSentReceipt[peer];
    if (last != null && upTo <= last) return;
    _lastSentReceipt[peer] = upTo;
    _enqueueOp(_noopOp);
    _socket.sendReceiptRead(ReceiptReadPayload(to: peer, upTo: upTo));
  }

  /// Highest timestamp among the DM messages [peer] sent us — the `upTo`
  /// bound for our outgoing receipt.
  int? _computeUpTo(String peer) {
    final entries = _privateByPeer[peer];
    if (entries == null) return null;
    int? max;
    for (final entry in entries) {
      final message = entry.value;
      if (message.isOwn || message.fromUsername != peer) continue;
      if (max == null || message.timestamp > max) max = message.timestamp;
    }
    return max;
  }

  void _handleReceiptRead(ReceiptReadRelay payload) {
    final previous = _readUpTo[payload.fromUsername] ?? 0;
    if (payload.upTo <= previous) return;
    _readUpTo[payload.fromUsername] = payload.upTo;
    _notify();
  }

  // ── App focus (C7) ────────────────────────────────────────────────────

  /// Reports the app's focus state. Gaining focus clears the open
  /// conversation's unread counter and re-sends its DM receipt; losing it
  /// makes incoming messages count as unread even while open — and ends the
  /// outgoing typing burst (C1).
  void setAppFocused(bool focused) {
    if (_appFocused == focused) return;
    _appFocused = focused;
    if (!focused) {
      _stopTypingBurst();
      return;
    }
    final peer = _selectedPeer;
    final group = _selectedGroup;
    if (peer != null) {
      _clearUnread('dm:$peer');
      final upTo = _computeUpTo(peer);
      if (upTo != null) sendReadReceipt(peer, upTo);
    } else if (group != null) {
      _clearUnread('group:$group');
    }
    _notify();
  }

  void _clearUnread(String key) {
    final previous = _unread[key];
    if (previous == null || (previous.count == 0 && !previous.mention)) return;
    _unread[key] = const UnreadEntry();
  }

  /// Applies the C7 unread rules for one incoming message. The wire note
  /// runs before decryption (mention unknown yet); a later note with the
  /// decrypted body patches the mention flag without double-counting.
  void _noteIncoming({
    required String key,
    required String dedupe,
    required bool isOpen,
    required bool mention,
  }) {
    final alreadyCounted = _unreadCounted.contains(dedupe);
    if (mention && alreadyCounted) {
      final entry = _unread[key];
      if (entry != null && !entry.mention) {
        _unread[key] = entry.copyWith(mention: true);
        _notify();
      }
      return;
    }
    // A mention of me always counts — even when the conversation is open.
    if (!(mention || !isOpen || !_appFocused)) return;
    if (alreadyCounted) return;
    _unreadCounted.add(dedupe);
    final previous = _unread[key] ?? const UnreadEntry();
    _unread[key] = UnreadEntry(
      count: previous.count + 1,
      mention: previous.mention || mention,
    );
    _notify();
  }

  bool _mentionsMeIn(
    String? body, {
    required bool decryptionFailed,
    required bool allowAll,
  }) {
    final me = _me;
    if (body == null || decryptionFailed || me == null) return false;
    return mentionsMe(body, _knownUsernames(), me.username, allowAll);
  }

  /// Directory snapshot + roster + self, the mention candidate set (C8).
  List<String> _knownUsernames() => <String>{
    ..._directory,
    for (final user in _users) user.username,
    if (_me != null) _me!.username,
  }.toList();

  void _noteIncomingPrivate(
    PrivateMessage wire, {
    String? body,
    bool decryptionFailed = false,
    required bool isOwn,
  }) {
    if (isOwn) return;
    final isOpen = _selectedPeer == wire.fromUsername;
    _noteIncoming(
      key: 'dm:${wire.fromUsername}',
      dedupe: wire.dedupeKey,
      isOpen: isOpen,
      mention: _mentionsMeIn(body, decryptionFailed: decryptionFailed, allowAll: false),
    );
    if (isOpen && _appFocused) {
      final upTo = _computeUpTo(wire.fromUsername);
      sendReadReceipt(wire.fromUsername, math.max(upTo ?? 0, wire.timestamp));
    }
  }

  void _noteIncomingGroup(
    GroupMessage wire, {
    String? body,
    bool decryptionFailed = false,
    required bool isOwn,
  }) {
    if (isOwn) return;
    _noteIncoming(
      key: 'group:${wire.groupId}',
      dedupe: wire.dedupeKey,
      isOpen: _selectedGroup == wire.groupId,
      mention: _mentionsMeIn(body, decryptionFailed: decryptionFailed, allowAll: true),
    );
  }

  // ── Reactions (C5) ─────────────────────────────────────────────────────

  /// Optimistically toggles our reaction on [targetId] and emits
  /// `message:react`; a `message_rejected` rolls the local state back.
  void toggleReaction(ConversationTarget target, String targetId, String emoji) {
    final me = _me;
    if (me == null) return;
    final current = _reactions[targetId]?[emoji] ?? const <String>{};
    final active = !current.contains(me.username);
    _enqueueOp(() => _setReaction(targetId, emoji, me.username, !active));
    _setReaction(targetId, emoji, me.username, active);
    _socket.sendReact(
      MessageReactPayload(
        to: target.isDm ? target.username : null,
        groupId: target.isGroup ? target.groupId : null,
        targetId: targetId,
        emoji: emoji,
        active: active,
      ),
    );
  }

  void _handleMessageReacted(MessageReactedPayload payload) {
    _setReaction(payload.targetId, payload.emoji, payload.fromUsername, payload.active);
  }

  /// Aggregates one reaction change: emoji → set of usernames.
  void _setReaction(String targetId, String emoji, String username, bool active) {
    final existing = _reactions[targetId] ?? const <String, Set<String>>{};
    final merged = <String, Set<String>>{
      for (final entry in existing.entries)
        entry.key: Set<String>.of(entry.value),
    };
    final reactors = merged.putIfAbsent(emoji, () => <String>{});
    if (active) {
      reactors.add(username);
    } else {
      reactors.remove(username);
    }
    if (reactors.isEmpty) merged.remove(emoji);
    _reactions[targetId] = merged;
    _notify();
  }

  // ── Edit / delete (C6) ────────────────────────────────────────────────

  DecryptedMessage? _privateById(String id) {
    if (id.isEmpty) return null;
    for (final bucket in _privateByPeer.values) {
      for (final entry in bucket) {
        if (entry.value.id == id) return entry.value;
      }
    }
    return null;
  }

  DecryptedGroupMessage? _groupById(String id) {
    if (id.isEmpty) return null;
    for (final bucket in _groupByGroup.values) {
      for (final entry in bucket) {
        if (entry.value.id == id) return entry.value;
      }
    }
    return null;
  }

  /// Re-encrypts [body] and emits `message:edit` for an own text message.
  /// The new body applies optimistically; `message_rejected` restores the
  /// original content. Media, tombstones and foreign messages are refused.
  Future<bool> editMessage(
    ConversationTarget target,
    String targetId,
    String body, {
    Map<String, dynamic>? reply,
  }) async {
    String? originalBody;
    Map<String, dynamic>? originalReply;
    bool originalEdited;
    if (target.isGroup) {
      final original = _groupById(targetId);
      if (original == null ||
          !original.isOwn ||
          original.media != null ||
          original.deleted) {
        return false;
      }
      originalBody = original.body;
      originalReply = original.reply;
      originalEdited = original.edited;
    } else {
      final original = _privateById(targetId);
      if (original == null ||
          !original.isOwn ||
          original.media != null ||
          original.deleted) {
        return false;
      }
      originalBody = original.body;
      originalReply = original.reply;
      originalEdited = original.edited;
    }

    final appliedReply = reply ?? originalReply;
    void rollback() {
      _applyEdit(
        targetId,
        body: originalBody ?? '',
        reply: originalReply,
        edited: originalEdited,
      );
    }

    try {
      final envelope = wrapTextEnvelope(body, appliedReply);

      if (target.isDm) {
        final peer = target.username!;
        final ready = await _e2ee.waitForSharedKey(
          peer,
          timeoutMs: _sharedKeyTimeoutMs,
        );
        if (!ready) {
          _showError('Secure session not ready. Please try again.');
          return false;
        }
        final payload = await _e2ee.encrypt(peer, envelope);
        _enqueueOp(rollback);
        _applyEdit(targetId, body: body, reply: appliedReply, edited: true);
        _socket.sendEdit(
          MessageEditPayload(
            to: peer,
            targetId: targetId,
            ciphertext: payload.ciphertext,
            iv: payload.iv,
          ),
        );
        return true;
      }

      final groupId = target.groupId!;
      final me = _me;
      final groupIndex = _groups.indexWhere((g) => g.groupId == groupId);
      if (me == null || groupIndex == -1) return false;
      final recipients = <String>[
        for (final member in _groups[groupIndex].members)
          if (member.username != me.username && _e2ee.hasSharedKey(member.username))
            member.username,
      ];
      if (recipients.isEmpty) {
        _showError('Secure session not ready. Please try again.');
        return false;
      }

      // One ciphertext decrypts with exactly one pairwise key, so each
      // member gets their own copy — the same scheme a group send uses.
      final copies = <EncryptedPayload>[];
      for (final member in recipients) {
        copies.add(await _e2ee.encrypt(member, envelope));
      }
      _enqueueOp(rollback);
      for (var i = 1; i < copies.length; i++) {
        _enqueueOp(_noopOp);
      }
      _applyEdit(targetId, body: body, reply: appliedReply, edited: true);
      for (final copy in copies) {
        _socket.sendEdit(
          MessageEditPayload(
            groupId: groupId,
            targetId: targetId,
            ciphertext: copy.ciphertext,
            iv: copy.iv,
          ),
        );
      }
      return true;
    } catch (_) {
      _showError('Failed to send message. Please try again.');
      return false;
    }
  }

  /// Emits `message:delete` for an own message and tombstones it locally
  /// (C6); `message_rejected` restores the original content.
  void deleteMessage(ConversationTarget target, String targetId) {
    String? originalBody;
    Map<String, dynamic>? originalReply;
    bool originalEdited;
    if (target.isGroup) {
      final original = _groupById(targetId);
      if (original == null || !original.isOwn || original.deleted) return;
      originalBody = original.body;
      originalReply = original.reply;
      originalEdited = original.edited;
    } else {
      final original = _privateById(targetId);
      if (original == null || !original.isOwn || original.deleted) return;
      originalBody = original.body;
      originalReply = original.reply;
      originalEdited = original.edited;
    }

    _enqueueOp(() {
      _applyEdit(
        targetId,
        body: originalBody ?? '',
        reply: originalReply,
        edited: originalEdited,
      );
      _applyDeleted(targetId, false);
    });
    _applyDeleted(targetId, true);
    _socket.sendDelete(
      MessageDeletePayload(
        to: target.isDm ? target.username : null,
        groupId: target.isGroup ? target.groupId : null,
        targetId: targetId,
      ),
    );
  }

  Future<void> _handleMessageEdited(MessageEditedPayload payload) async {
    final targetIsGroup = payload.groupId != null;
    final Object? original = targetIsGroup
        ? _groupById(payload.targetId)
        : _privateById(payload.targetId);
    final isOwnText = switch (original) {
      DecryptedMessage(:final fromUsername, :final media, :final deleted) =>
        fromUsername == payload.fromUsername && media == null && !deleted,
      DecryptedGroupMessage(:final fromUsername, :final media, :final deleted) =>
        fromUsername == payload.fromUsername && media == null && !deleted,
      _ => false,
    };
    // The relay is stateless: only the original author may edit, and only
    // when the original was a text message (spec B author enforcement).
    if (!isOwnText) return;

    try {
      final plaintext = await _e2ee.decrypt(
        payload.fromUsername,
        payload.ciphertext,
        payload.iv,
      );
      if (_disposed) return;
      final parsed = parseEnvelope(plaintext);
      if (parsed.isMedia) return;
      final body = parsed.isText ? parsed.text! : plaintext;
      _applyEdit(
        payload.targetId,
        body: body,
        reply: parsed.isText ? parsed.reply : null,
        edited: true,
      );
    } catch (_) {
      // The shared key vanished mid-flight; keep the original content.
    }
  }

  void _handleMessageDeleted(MessageDeletedPayload payload) {
    final targetIsGroup = payload.groupId != null;
    final Object? original = targetIsGroup
        ? _groupById(payload.targetId)
        : _privateById(payload.targetId);
    final owned = switch (original) {
      DecryptedMessage(:final fromUsername, :final deleted) =>
        fromUsername == payload.fromUsername && !deleted,
      DecryptedGroupMessage(:final fromUsername, :final deleted) =>
        fromUsername == payload.fromUsername && !deleted,
      _ => false,
    };
    if (!owned) return;
    _applyDeleted(payload.targetId, true);
  }

  /// Replaces body/reply/edited on the message with [targetId] (both
  /// stores); returns whether anything matched.
  bool _applyEdit(
    String targetId, {
    required String body,
    required Map<String, dynamic>? reply,
    required bool edited,
  }) {
    var changed = false;
    for (final bucket in _privateByPeer.values) {
      for (var i = 0; i < bucket.length; i++) {
        final entry = bucket[i];
        if (entry.value.id != targetId) continue;
        bucket[i] = _Entry<DecryptedMessage>(
          entry.key,
          entry.value.copyWith(body: body, reply: reply, edited: edited),
        );
        changed = true;
      }
    }
    for (final bucket in _groupByGroup.values) {
      for (var i = 0; i < bucket.length; i++) {
        final entry = bucket[i];
        if (entry.value.id != targetId) continue;
        bucket[i] = _Entry<DecryptedGroupMessage>(
          entry.key,
          entry.value.copyWith(body: body, reply: reply, edited: edited),
        );
        changed = true;
      }
    }
    if (changed) _notify();
    return changed;
  }

  /// Flips the tombstone flag on the message with [targetId].
  bool _applyDeleted(String targetId, bool deleted) {
    var changed = false;
    for (final bucket in _privateByPeer.values) {
      for (var i = 0; i < bucket.length; i++) {
        final entry = bucket[i];
        if (entry.value.id != targetId) continue;
        bucket[i] = _Entry<DecryptedMessage>(entry.key, entry.value.copyWith(deleted: deleted));
        changed = true;
      }
    }
    for (final bucket in _groupByGroup.values) {
      for (var i = 0; i < bucket.length; i++) {
        final entry = bucket[i];
        if (entry.value.id != targetId) continue;
        bucket[i] = _Entry<DecryptedGroupMessage>(
          entry.key,
          entry.value.copyWith(deleted: deleted),
        );
        changed = true;
      }
    }
    if (changed) _notify();
    return changed;
  }

  // ── Profiles (C9) ──────────────────────────────────────────────────────

  /// Validates and emits `profile:update` for the signed-in user, applying
  /// the new values optimistically (rollback on `message_rejected`).
  /// Returns false without sending when either field fails validation —
  /// the editor renders those errors inline.
  bool updateProfile(String rawDisplayName, String rawStatus) {
    final me = _me;
    if (me == null) return false;
    final validation = validateProfile(rawDisplayName, rawStatus);
    if (!validation.isValid) return false;
    final previous = _profiles[me.username] ?? ProfileEntry(
      username: me.username,
      displayName: me.username,
      status: '',
    );
    _enqueueOp(() {
      _setProfile(
        me.username,
        previous.displayName ?? me.username,
        previous.status ?? '',
      );
    });
    _setProfile(me.username, validation.displayName, validation.status);
    _socket.sendProfileUpdate(
      ProfileUpdatePayload(
        displayName: validation.displayName,
        status: validation.status,
      ),
    );
    return true;
  }

  void _handleProfileUpdated(ProfileUpdatedPayload payload) {
    _setProfile(payload.username, payload.displayName, payload.status);
  }

  void _setProfile(String username, String displayName, String status) {
    _profiles[username] = ProfileEntry(
      username: username,
      displayName: displayName,
      status: status,
    );
    _notify();
  }

  /// Seeds profiles from roster snapshots (display name falls back to the
  /// username so `displayNameOf` never has to look at the raw entry).
  void _seedProfiles(Iterable<ProfileEntry> entries) {
    var changed = false;
    for (final entry in entries) {
      _profiles[entry.username] = entry;
      changed = true;
    }
    if (changed) _notify();
  }

  // ── Optimistic ops ─────────────────────────────────────────────────────

  void _enqueueOp(void Function() undo) {
    final now = DateTime.now().millisecondsSinceEpoch;
    _pendingOps.removeWhere((op) => now - op.at > _pendingOpTtlMs);
    _pendingOps.add(_PendingOp(now, undo));
  }

  void _runLatestPendingOp() {
    final now = DateTime.now().millisecondsSinceEpoch;
    _pendingOps.removeWhere((op) => now - op.at > _pendingOpTtlMs);
    if (_pendingOps.isEmpty) return;
    // Newest first: a rejection lands within one round-trip of its emit, so
    // the most recent pending op is almost always the one being rejected.
    _pendingOps.removeLast().undo();
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
      _socket.onMediaToken(_handleMediaToken),
      _socket.onTypingChanged(_handleTypingChanged),
      _socket.onReceiptRead(_handleReceiptRead),
      _socket.onMessageReacted(_handleMessageReacted),
      _socket.onMessageEdited(_handleMessageEdited),
      _socket.onMessageDeleted(_handleMessageDeleted),
      _socket.onProfileUpdated(_handleProfileUpdated),
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
    // Indicators can't survive a dead socket; drop local typing state too.
    _stopTypingBurst();
    _clearTypingIndicators();
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
    _seedProfiles(<ProfileEntry>[
      ProfileEntry(
        username: user.username,
        displayName: user.displayName ?? user.username,
        status: user.status ?? '',
      ),
    ]);

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
    _seedProfiles(<ProfileEntry>[
      for (final user in users)
        ProfileEntry(
          username: user.username,
          displayName: user.displayName ?? user.username,
          status: user.status ?? '',
        ),
    ]);
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
    _seedProfiles(_memberProfiles(groups));
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
    _seedProfiles(_memberProfiles(<GroupInfo>[group]));
    _notify();
  }

  /// Group members only carry a profile when one is set (web mirrors this
  /// filter); unprofiled members must not clobber known profiles.
  static List<ProfileEntry> _memberProfiles(List<GroupInfo> groups) {
    final entries = <ProfileEntry>[];
    for (final group in groups) {
      for (final member in group.members) {
        final displayName = member.displayName;
        if (displayName == null) continue;
        entries.add(
          ProfileEntry(username: member.username, displayName: displayName, status: ''),
        );
      }
    }
    return entries;
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
    _noteIncomingPrivate(message, isOwn: isOwn);
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
      // The decrypted body may reveal a mention the wire note couldn't see.
      _noteIncomingPrivate(
        pending.wire,
        body: _mentionBodyOf(plaintext, decryptionFailed: false),
        decryptionFailed: false,
        isOwn: pending.isOwn,
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
      _noteIncomingPrivate(pending.wire, decryptionFailed: true, isOwn: pending.isOwn);
    }
  }

  void _upsertPrivate(_PendingPrivate pending, DecryptedMessage message) {
    _upsert(_privateByPeer, message.peerUsername, pending.key, message);
  }

  /// The mention-relevant body of a decrypted payload: null for media and
  /// failed decryption (neither can mention anyone).
  String? _mentionBodyOf(String plaintext, {required bool decryptionFailed}) {
    if (decryptionFailed) return null;
    final parsed = parseEnvelope(plaintext);
    if (parsed.isMedia) return null;
    return parsed.isText ? parsed.text : plaintext;
  }

  static DecryptedMessage _privateMessage({
    required PrivateMessage wire,
    required bool isOwn,
    required String plaintext,
    required bool decryptionFailed,
  }) {
    final unwrapped = _unwrapPlaintext(plaintext, decryptionFailed);
    return DecryptedMessage(
      id: wire.id,
      from: wire.from,
      fromUsername: wire.fromUsername,
      to: wire.to,
      toUsername: wire.toUsername,
      plaintext: plaintext,
      body: unwrapped.body,
      reply: unwrapped.reply,
      edited: false,
      deleted: false,
      timestamp: wire.timestamp,
      isOwn: isOwn,
      decryptionFailed: decryptionFailed,
      media: unwrapped.media,
    );
  }

  /// Envelope-unwrapped view of a decrypted payload (spec C3): a media
  /// descriptor, a text body plus optional reply ref, or the raw string
  /// itself for legacy / unknown envelopes.
  static ({String? body, Map<String, dynamic>? reply, MediaDescriptor? media})
  _unwrapPlaintext(String plaintext, bool decryptionFailed) {
    if (decryptionFailed) return (body: null, reply: null, media: null);
    final parsed = parseEnvelope(plaintext);
    if (parsed.isMedia) return (body: null, reply: null, media: parsed.media);
    if (parsed.isText) return (body: parsed.text, reply: parsed.reply, media: null);
    return (body: plaintext, reply: null, media: null);
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
    _noteIncomingGroup(message, isOwn: isOwn);
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
      // The decrypted body may reveal a mention the wire note couldn't see.
      _noteIncomingGroup(
        pending.wire,
        body: _mentionBodyOf(plaintext, decryptionFailed: false),
        decryptionFailed: false,
        isOwn: pending.isOwn,
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
      _noteIncomingGroup(pending.wire, decryptionFailed: true, isOwn: pending.isOwn);
    }
  }

  static DecryptedGroupMessage _groupMessage({
    required GroupMessage wire,
    required bool isOwn,
    required String plaintext,
    required bool decryptionFailed,
  }) {
    final unwrapped = _unwrapPlaintext(plaintext, decryptionFailed);
    return DecryptedGroupMessage(
      id: wire.id,
      groupId: wire.groupId,
      from: wire.from,
      fromUsername: wire.fromUsername,
      plaintext: plaintext,
      body: unwrapped.body,
      reply: unwrapped.reply,
      edited: false,
      deleted: false,
      timestamp: wire.timestamp,
      isOwn: isOwn,
      decryptionFailed: decryptionFailed,
      media: unwrapped.media,
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
    // The rejection carries no correlation id: undo the newest fresh op.
    _runLatestPendingOp();
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
    _typingRepeatTimer?.cancel();
    _typingRepeatTimer = null;
    for (final timer in _typingHideTimers.values) {
      timer.cancel();
    }
    _typingHideTimers.clear();
    for (final unsubscribe in _subscriptions) {
      unsubscribe();
    }
    _subscriptions.clear();
    _socket.disconnect();
    super.dispose();
  }
}
