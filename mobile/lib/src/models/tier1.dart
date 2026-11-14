import 'json_utils.dart';

// ── Tier-1 relay payloads (wire contract from backend/src/types.ts) ──

/// Outbound `typing:send` payload.
class TypingSendPayload {
  const TypingSendPayload({this.to, this.groupId, required this.active});

  final String? to;
  final String? groupId;
  final bool active;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (to != null) 'to': to,
    if (groupId != null) 'groupId': groupId,
    'active': active,
  };
}

/// Outbound `receipt:read` payload; `upTo` is a message timestamp.
class ReceiptReadPayload {
  const ReceiptReadPayload({required this.to, required this.upTo});

  final String to;
  final int upTo;

  Map<String, dynamic> toJson() => <String, dynamic>{'to': to, 'upTo': upTo};
}

/// Outbound `message:react` payload.
class MessageReactPayload {
  const MessageReactPayload({
    this.to,
    this.groupId,
    required this.targetId,
    required this.emoji,
    required this.active,
  });

  final String? to;
  final String? groupId;
  final String targetId;
  final String emoji;
  final bool active;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (to != null) 'to': to,
    if (groupId != null) 'groupId': groupId,
    'targetId': targetId,
    'emoji': emoji,
    'active': active,
  };
}

/// Outbound `message:edit` payload; carries re-encrypted ciphertext.
class MessageEditPayload {
  const MessageEditPayload({
    this.to,
    this.groupId,
    required this.targetId,
    required this.ciphertext,
    required this.iv,
  });

  final String? to;
  final String? groupId;
  final String targetId;
  final String ciphertext;
  final String iv;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (to != null) 'to': to,
    if (groupId != null) 'groupId': groupId,
    'targetId': targetId,
    'ciphertext': ciphertext,
    'iv': iv,
  };
}

/// Outbound `message:delete` payload.
class MessageDeletePayload {
  const MessageDeletePayload({
    this.to,
    this.groupId,
    required this.targetId,
  });

  final String? to;
  final String? groupId;
  final String targetId;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (to != null) 'to': to,
    if (groupId != null) 'groupId': groupId,
    'targetId': targetId,
  };
}

/// Outbound `profile:update` payload.
class ProfileUpdatePayload {
  const ProfileUpdatePayload({required this.displayName, required this.status});

  final String displayName;
  final String status;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'displayName': displayName,
    'status': status,
  };
}

/// Inbound `typing:changed` relay.
class TypingChangedPayload {
  const TypingChangedPayload({
    required this.from,
    required this.fromUsername,
    this.to,
    this.groupId,
    required this.active,
  });

  factory TypingChangedPayload.fromJson(Map<String, dynamic> json) {
    return TypingChangedPayload(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      to: json['to'] is String ? json['to'] as String : null,
      groupId: json['groupId'] is String ? json['groupId'] as String : null,
      active: readBool(json['active']),
    );
  }

  final String from;
  final String fromUsername;
  final String? to;
  final String? groupId;
  final bool active;
}

/// Inbound `receipt:read` relay.
class ReceiptReadRelay {
  const ReceiptReadRelay({
    required this.from,
    required this.fromUsername,
    required this.upTo,
  });

  factory ReceiptReadRelay.fromJson(Map<String, dynamic> json) {
    return ReceiptReadRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      upTo: readInt(json['upTo']),
    );
  }

  final String from;
  final String fromUsername;
  final int upTo;
}

/// Inbound `message:reacted` relay.
class MessageReactedPayload {
  const MessageReactedPayload({
    required this.from,
    required this.fromUsername,
    this.to,
    this.groupId,
    required this.targetId,
    required this.emoji,
    required this.active,
    required this.timestamp,
  });

  factory MessageReactedPayload.fromJson(Map<String, dynamic> json) {
    return MessageReactedPayload(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      to: json['to'] is String ? json['to'] as String : null,
      groupId: json['groupId'] is String ? json['groupId'] as String : null,
      targetId: readString(json['targetId']),
      emoji: readString(json['emoji']),
      active: readBool(json['active']),
      timestamp: readInt(json['timestamp']),
    );
  }

  final String from;
  final String fromUsername;
  final String? to;
  final String? groupId;
  final String targetId;
  final String emoji;
  final bool active;
  final int timestamp;
}

/// Inbound `message:edited` relay.
class MessageEditedPayload {
  const MessageEditedPayload({
    required this.from,
    required this.fromUsername,
    this.to,
    this.groupId,
    required this.targetId,
    required this.ciphertext,
    required this.iv,
    required this.timestamp,
  });

  factory MessageEditedPayload.fromJson(Map<String, dynamic> json) {
    return MessageEditedPayload(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      to: json['to'] is String ? json['to'] as String : null,
      groupId: json['groupId'] is String ? json['groupId'] as String : null,
      targetId: readString(json['targetId']),
      ciphertext: readString(json['ciphertext']),
      iv: readString(json['iv']),
      timestamp: readInt(json['timestamp']),
    );
  }

  final String from;
  final String fromUsername;
  final String? to;
  final String? groupId;
  final String targetId;
  final String ciphertext;
  final String iv;
  final int timestamp;
}

/// Inbound `message:deleted` relay.
class MessageDeletedPayload {
  const MessageDeletedPayload({
    required this.from,
    required this.fromUsername,
    this.to,
    this.groupId,
    required this.targetId,
    required this.timestamp,
  });

  factory MessageDeletedPayload.fromJson(Map<String, dynamic> json) {
    return MessageDeletedPayload(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      to: json['to'] is String ? json['to'] as String : null,
      groupId: json['groupId'] is String ? json['groupId'] as String : null,
      targetId: readString(json['targetId']),
      timestamp: readInt(json['timestamp']),
    );
  }

  final String from;
  final String fromUsername;
  final String? to;
  final String? groupId;
  final String targetId;
  final int timestamp;
}

/// Inbound `profile:updated` relay.
class ProfileUpdatedPayload {
  const ProfileUpdatedPayload({
    required this.username,
    required this.displayName,
    required this.status,
  });

  factory ProfileUpdatedPayload.fromJson(Map<String, dynamic> json) {
    return ProfileUpdatedPayload(
      username: readString(json['username']),
      displayName: readString(json['displayName']),
      status: readString(json['status']),
    );
  }

  final String username;
  final String displayName;
  final String status;
}

/// The conversation a tier-1 operation targets: either a DM peer or a group.
class ConversationTarget {
  const ConversationTarget.dm(this.username)
    : groupId = null,
      isGroup = false;
  const ConversationTarget.group(this.groupId)
    : username = null,
      isGroup = true;

  /// DM peer username (the wire `to` field).
  final String? username;
  final String? groupId;
  final bool isGroup;

  bool get isDm => !isGroup;

  @override
  bool operator ==(Object other) {
    return other is ConversationTarget &&
        other.username == username &&
        other.groupId == groupId &&
        other.isGroup == isGroup;
  }

  @override
  int get hashCode => Object.hash(username, groupId, isGroup);

  @override
  String toString() => isGroup
      ? 'ConversationTarget.group($groupId)'
      : 'ConversationTarget.dm($username)';
}

/// Per-conversation unread state (C7).
class UnreadEntry {
  const UnreadEntry({this.count = 0, this.mention = false});

  final int count;
  final bool mention;

  UnreadEntry copyWith({int? count, bool? mention}) => UnreadEntry(
    count: count ?? this.count,
    mention: mention ?? this.mention,
  );
}

/// A known profile (C9): what other clients see about a user.
class ProfileEntry {
  const ProfileEntry({required this.username, this.displayName, this.status});

  final String username;
  final String? displayName;
  final String? status;

  ProfileEntry copyWith({String? displayName, String? status}) => ProfileEntry(
    username: username,
    displayName: displayName ?? this.displayName,
    status: status ?? this.status,
  );
}

/// Fixed reaction set (C5), in spec order.
const List<String> reactionEmojis = <String>[
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🎉',
  '🔥',
  '👀',
];
