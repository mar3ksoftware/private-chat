import 'json_utils.dart';

/// A user currently attached to the backend registry.
///
/// Mirrors `UserInfo` from `backend/src/types.ts`.
class UserInfo {
  const UserInfo({
    required this.userId,
    required this.username,
    required this.socketId,
    required this.joinedAt,
  });

  factory UserInfo.fromJson(Map<String, dynamic> json) {
    return UserInfo(
      userId: readString(json['userId']),
      username: readString(json['username']),
      socketId: readString(json['socketId']),
      joinedAt: readInt(json['joinedAt']),
    );
  }

  /// Branded `UserId` on the backend; a plain string on the wire.
  final String userId;
  final String username;
  final String socketId;

  /// Unix epoch milliseconds.
  final int joinedAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'username': username,
    'socketId': socketId,
    'joinedAt': joinedAt,
  };

  UserInfo copyWith({
    String? userId,
    String? username,
    String? socketId,
    int? joinedAt,
  }) {
    return UserInfo(
      userId: userId ?? this.userId,
      username: username ?? this.username,
      socketId: socketId ?? this.socketId,
      joinedAt: joinedAt ?? this.joinedAt,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is UserInfo &&
        other.userId == userId &&
        other.username == username &&
        other.socketId == socketId &&
        other.joinedAt == joinedAt;
  }

  @override
  int get hashCode => Object.hash(userId, username, socketId, joinedAt);

  @override
  String toString() => 'UserInfo($username, $userId)';
}

/// The locally authenticated identity.
///
/// Corresponds to `state.user` in the web client. `isGuest` is a client-side
/// flag because guest joins never create an account.
class ActiveUser {
  const ActiveUser({
    required this.userId,
    required this.username,
    required this.isGuest,
  });

  final String userId;
  final String username;
  final bool isGuest;

  ActiveUser copyWith({String? userId, String? username, bool? isGuest}) {
    return ActiveUser(
      userId: userId ?? this.userId,
      username: username ?? this.username,
      isGuest: isGuest ?? this.isGuest,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'username': username,
    'isGuest': isGuest,
  };

  @override
  bool operator ==(Object other) {
    return other is ActiveUser &&
        other.userId == userId &&
        other.username == username &&
        other.isGuest == isGuest;
  }

  @override
  int get hashCode => Object.hash(userId, username, isGuest);

  @override
  String toString() => 'ActiveUser($username, isGuest: $isGuest)';
}

/// Outbound `user:join` payload.
class UserJoinPayload {
  const UserJoinPayload({required this.username});

  factory UserJoinPayload.fromJson(Map<String, dynamic> json) {
    return UserJoinPayload(username: readString(json['username']));
  }

  final String username;

  Map<String, dynamic> toJson() => <String, dynamic>{'username': username};
}

/// Inbound `user:left` payload.
class UserLeftPayload {
  const UserLeftPayload({required this.userId, required this.username});

  factory UserLeftPayload.fromJson(Map<String, dynamic> json) {
    return UserLeftPayload(
      userId: readString(json['userId']),
      username: readString(json['username']),
    );
  }

  final String userId;
  final String username;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'username': username,
  };
}
