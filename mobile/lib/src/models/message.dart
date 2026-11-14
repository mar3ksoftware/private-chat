import 'json_utils.dart';
import 'media.dart';

/// Outbound `message:send` payload.
class EncryptedMessagePayload {
  const EncryptedMessagePayload({
    required this.id,
    required this.to,
    required this.ciphertext,
    required this.iv,
  });

  factory EncryptedMessagePayload.fromJson(Map<String, dynamic> json) {
    return EncryptedMessagePayload(
      id: readString(json['id']),
      to: readString(json['to']),
      ciphertext: readString(json['ciphertext']),
      iv: readString(json['iv']),
    );
  }

  /// Client-generated UUIDv4 identifying the send.
  final String id;
  final String to;
  final String ciphertext;
  final String iv;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'to': to,
    'ciphertext': ciphertext,
    'iv': iv,
  };
}

/// One recipient's copy of an encrypted group message.
class GroupCiphertext {
  const GroupCiphertext({
    required this.to,
    required this.ciphertext,
    required this.iv,
  });

  factory GroupCiphertext.fromJson(Map<String, dynamic> json) {
    return GroupCiphertext(
      to: readString(json['to']),
      ciphertext: readString(json['ciphertext']),
      iv: readString(json['iv']),
    );
  }

  final String to;
  final String ciphertext;
  final String iv;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'to': to,
    'ciphertext': ciphertext,
    'iv': iv,
  };
}

/// Inbound `private_message` wire payload.
///
/// `timestamp` is Unix epoch milliseconds. The server echoes the sender's own
/// message back to them, so both `fromUsername` and `toUsername` are present.
class PrivateMessage {
  const PrivateMessage({
    this.id = '',
    required this.from,
    required this.fromUsername,
    required this.to,
    required this.toUsername,
    required this.ciphertext,
    required this.iv,
    required this.timestamp,
  });

  factory PrivateMessage.fromJson(Map<String, dynamic> json) {
    return PrivateMessage(
      id: readString(json['id']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      to: readString(json['to']),
      toUsername: readString(json['toUsername']),
      ciphertext: readString(json['ciphertext']),
      iv: readString(json['iv']),
      timestamp: readInt(json['timestamp']),
    );
  }

  /// Client-generated UUIDv4; empty on legacy sends without one.
  final String id;
  final String from;
  final String fromUsername;
  final String to;
  final String toUsername;
  final String ciphertext;
  final String iv;
  final int timestamp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (id.isNotEmpty) 'id': id,
    'from': from,
    'fromUsername': fromUsername,
    'to': to,
    'toUsername': toUsername,
    'ciphertext': ciphertext,
    'iv': iv,
    'timestamp': timestamp,
  };

  /// Stable identity for the message, used to dedupe re-deliveries and to
  /// replace a placeholder once decryption succeeds.
  String get dedupeKey =>
      '$from\u001f$to\u001f$timestamp\u001f$ciphertext\u001f$iv';
}

/// A private message after decryption, ready for rendering.
class DecryptedMessage {
  const DecryptedMessage({
    this.id = '',
    required this.from,
    required this.fromUsername,
    required this.to,
    required this.toUsername,
    required this.plaintext,
    this.body,
    this.reply,
    this.edited = false,
    this.deleted = false,
    required this.timestamp,
    required this.isOwn,
    required this.decryptionFailed,
    this.media,
  });

  factory DecryptedMessage.fromJson(Map<String, dynamic> json) {
    return DecryptedMessage(
      id: readString(json['id']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      to: readString(json['to']),
      toUsername: readString(json['toUsername']),
      plaintext: readString(json['plaintext']),
      body: json['body'] is String ? json['body'] as String : null,
      reply: json['reply'] is Map ? Map<String, dynamic>.from(json['reply'] as Map) : null,
      edited: readBool(json['edited']),
      deleted: readBool(json['deleted']),
      timestamp: readInt(json['timestamp']),
      isOwn: readBool(json['isOwn']),
      decryptionFailed: readBool(json['decryptionFailed']),
      media: MediaDescriptor.tryFromJson(json['media']),
    );
  }

  /// Client-generated UUIDv4; empty on legacy sends without one.
  final String id;
  final String from;
  final String fromUsername;
  final String to;
  final String toUsername;

  /// Raw decrypted payload (envelope JSON for text sends).
  final String plaintext;

  /// Envelope-unwrapped text body; null for raw/failed decryption.
  final String? body;

  /// Reply target `{from, to, excerpt, groupId?}` when this is a reply.
  final Map<String, dynamic>? reply;

  final bool edited;
  final bool deleted;
  final int timestamp;
  final bool isOwn;
  final bool decryptionFailed;

  /// Attachment descriptor parsed from the plaintext, or null for text.
  final MediaDescriptor? media;

  /// The other participant in this conversation, regardless of direction.
  String get peerUsername => isOwn ? toUsername : fromUsername;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (id.isNotEmpty) 'id': id,
    'from': from,
    'fromUsername': fromUsername,
    'to': to,
    'toUsername': toUsername,
    'plaintext': plaintext,
    if (body != null) 'body': body,
    if (reply != null) 'reply': reply,
    'edited': edited,
    'deleted': deleted,
    'timestamp': timestamp,
    'isOwn': isOwn,
    'decryptionFailed': decryptionFailed,
    if (media != null) 'media': media!.toJson(),
  };

  DecryptedMessage copyWith({
    String? id,
    String? plaintext,
    String? body,
    Map<String, dynamic>? reply,
    bool? edited,
    bool? deleted,
    bool? decryptionFailed,
    MediaDescriptor? media,
  }) {
    return DecryptedMessage(
      id: id ?? this.id,
      from: from,
      fromUsername: fromUsername,
      to: to,
      toUsername: toUsername,
      plaintext: plaintext ?? this.plaintext,
      body: body ?? this.body,
      reply: reply ?? this.reply,
      edited: edited ?? this.edited,
      deleted: deleted ?? this.deleted,
      timestamp: timestamp,
      isOwn: isOwn,
      decryptionFailed: decryptionFailed ?? this.decryptionFailed,
      media: media ?? this.media,
    );
  }
}

/// Outbound `group:message:send` payload.
class GroupEncryptedPayload {
  const GroupEncryptedPayload({
    required this.id,
    required this.groupId,
    required this.ciphertexts,
  });

  factory GroupEncryptedPayload.fromJson(Map<String, dynamic> json) {
    return GroupEncryptedPayload(
      id: readString(json['id']),
      groupId: readString(json['groupId']),
      ciphertexts: readList(
        json['ciphertexts'],
      ).map((entry) => GroupCiphertext.fromJson(asJsonMap(entry))).toList(),
    );
  }

  /// Client-generated UUIDv4 identifying the send.
  final String id;
  final String groupId;
  final List<GroupCiphertext> ciphertexts;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'groupId': groupId,
    'ciphertexts': ciphertexts.map((entry) => entry.toJson()).toList(),
  };
}

/// Inbound `group:message` wire payload.
class GroupMessage {
  const GroupMessage({
    this.id = '',
    required this.groupId,
    required this.from,
    required this.fromUsername,
    required this.ciphertexts,
    required this.timestamp,
  });

  factory GroupMessage.fromJson(Map<String, dynamic> json) {
    return GroupMessage(
      id: readString(json['id']),
      groupId: readString(json['groupId']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      ciphertexts: readList(
        json['ciphertexts'],
      ).map((entry) => GroupCiphertext.fromJson(asJsonMap(entry))).toList(),
      timestamp: readInt(json['timestamp']),
    );
  }

  /// Client-generated UUIDv4; empty on legacy sends without one.
  final String id;
  final String groupId;
  final String from;
  final String fromUsername;
  final List<GroupCiphertext> ciphertexts;
  final int timestamp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (id.isNotEmpty) 'id': id,
    'groupId': groupId,
    'from': from,
    'fromUsername': fromUsername,
    'ciphertexts': ciphertexts.map((entry) => entry.toJson()).toList(),
    'timestamp': timestamp,
  };

  String get dedupeKey =>
      '$groupId\u001f$from\u001f$timestamp\u001f'
      '${ciphertexts.map((entry) => '${entry.to}:${entry.ciphertext}:${entry.iv}').join(',')}';
}

/// A group message after decryption, ready for rendering.
class DecryptedGroupMessage {
  const DecryptedGroupMessage({
    this.id = '',
    required this.groupId,
    required this.from,
    required this.fromUsername,
    required this.plaintext,
    this.body,
    this.reply,
    this.edited = false,
    this.deleted = false,
    required this.timestamp,
    required this.isOwn,
    required this.decryptionFailed,
    this.media,
  });

  factory DecryptedGroupMessage.fromJson(Map<String, dynamic> json) {
    return DecryptedGroupMessage(
      id: readString(json['id']),
      groupId: readString(json['groupId']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      plaintext: readString(json['plaintext']),
      body: json['body'] is String ? json['body'] as String : null,
      reply: json['reply'] is Map ? Map<String, dynamic>.from(json['reply'] as Map) : null,
      edited: readBool(json['edited']),
      deleted: readBool(json['deleted']),
      timestamp: readInt(json['timestamp']),
      isOwn: readBool(json['isOwn']),
      decryptionFailed: readBool(json['decryptionFailed']),
      media: MediaDescriptor.tryFromJson(json['media']),
    );
  }

  /// Client-generated UUIDv4; empty on legacy sends without one.
  final String id;
  final String groupId;
  final String from;
  final String fromUsername;

  /// Raw decrypted payload (envelope JSON for text sends).
  final String plaintext;

  /// Envelope-unwrapped text body; null for raw/failed decryption.
  final String? body;

  /// Reply target `{from, to, excerpt, groupId?}` when this is a reply.
  final Map<String, dynamic>? reply;

  final bool edited;
  final bool deleted;
  final int timestamp;
  final bool isOwn;
  final bool decryptionFailed;

  /// Attachment descriptor parsed from the plaintext, or null for text.
  final MediaDescriptor? media;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (id.isNotEmpty) 'id': id,
    'groupId': groupId,
    'from': from,
    'fromUsername': fromUsername,
    'plaintext': plaintext,
    if (body != null) 'body': body,
    if (reply != null) 'reply': reply,
    'edited': edited,
    'deleted': deleted,
    'timestamp': timestamp,
    'isOwn': isOwn,
    'decryptionFailed': decryptionFailed,
    if (media != null) 'media': media!.toJson(),
  };

  DecryptedGroupMessage copyWith({
    String? id,
    String? plaintext,
    String? body,
    Map<String, dynamic>? reply,
    bool? edited,
    bool? deleted,
    bool? decryptionFailed,
    MediaDescriptor? media,
  }) {
    return DecryptedGroupMessage(
      id: id ?? this.id,
      groupId: groupId,
      from: from,
      fromUsername: fromUsername,
      plaintext: plaintext ?? this.plaintext,
      body: body ?? this.body,
      reply: reply ?? this.reply,
      edited: edited ?? this.edited,
      deleted: deleted ?? this.deleted,
      timestamp: timestamp,
      isOwn: isOwn,
      decryptionFailed: decryptionFailed ?? this.decryptionFailed,
      media: media ?? this.media,
    );
  }
}
