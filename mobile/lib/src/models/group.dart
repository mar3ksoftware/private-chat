import 'json_utils.dart';

/// A member entry inside a [GroupInfo].
class GroupMember {
  const GroupMember({
    required this.userId,
    required this.username,
    required this.isAdmin,
  });

  factory GroupMember.fromJson(Map<String, dynamic> json) {
    return GroupMember(
      userId: readString(json['userId']),
      username: readString(json['username']),
      isAdmin: readBool(json['isAdmin']),
    );
  }

  final String userId;
  final String username;
  final bool isAdmin;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'username': username,
    'isAdmin': isAdmin,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupMember &&
        other.userId == userId &&
        other.username == username &&
        other.isAdmin == isAdmin;
  }

  @override
  int get hashCode => Object.hash(userId, username, isAdmin);
}

/// Mirrors `GroupInfo` from the backend contract.
class GroupInfo {
  const GroupInfo({
    required this.groupId,
    required this.name,
    required this.members,
    required this.createdBy,
    required this.createdAt,
  });

  factory GroupInfo.fromJson(Map<String, dynamic> json) {
    return GroupInfo(
      groupId: readString(json['groupId']),
      name: readString(json['name']),
      members: readList(
        json['members'],
      ).map((entry) => GroupMember.fromJson(asJsonMap(entry))).toList(),
      createdBy: readString(json['createdBy']),
      createdAt: readInt(json['createdAt']),
    );
  }

  final String groupId;
  final String name;
  final List<GroupMember> members;
  final String createdBy;
  final int createdAt;

  List<String> get memberUsernames =>
      members.map((member) => member.username).toList(growable: false);

  bool hasMember(String username) =>
      members.any((member) => member.username == username);

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'name': name,
    'members': members.map((member) => member.toJson()).toList(),
    'createdBy': createdBy,
    'createdAt': createdAt,
  };

  GroupInfo copyWith({
    String? groupId,
    String? name,
    List<GroupMember>? members,
    String? createdBy,
    int? createdAt,
  }) {
    return GroupInfo(
      groupId: groupId ?? this.groupId,
      name: name ?? this.name,
      members: members ?? this.members,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is GroupInfo &&
        other.groupId == groupId &&
        other.name == name &&
        other.createdBy == createdBy &&
        other.createdAt == createdAt &&
        _membersEqual(other.members, members);
  }

  static bool _membersEqual(List<GroupMember> a, List<GroupMember> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(
    groupId,
    name,
    createdBy,
    createdAt,
    Object.hashAll(members),
  );
}

/// Outbound `group:create` payload.
class GroupCreatePayload {
  const GroupCreatePayload({required this.name, required this.members});

  factory GroupCreatePayload.fromJson(Map<String, dynamic> json) {
    return GroupCreatePayload(
      name: readString(json['name']),
      members: readList(
        json['members'],
      ).map((entry) => readString(entry)).toList(),
    );
  }

  final String name;
  final List<String> members;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'name': name,
    'members': members,
  };
}

/// Targets one user inside a group — the payload of `group:member:add`,
/// `group:member:remove` and `group:kick:vote`.
class GroupTargetPayload {
  const GroupTargetPayload({required this.groupId, required this.username});

  factory GroupTargetPayload.fromJson(Map<String, dynamic> json) {
    return GroupTargetPayload(
      groupId: readString(json['groupId']),
      username: readString(json['username']),
    );
  }

  final String groupId;
  final String username;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'username': username,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupTargetPayload &&
        other.groupId == groupId &&
        other.username == username;
  }

  @override
  int get hashCode => Object.hash(groupId, username);
}

/// `group:member:removed` — sent only to the removed user. [reason] is
/// `'removed'` for an admin remove and `'kicked'` for a vote kick.
class GroupMemberRemovedPayload {
  const GroupMemberRemovedPayload({
    required this.groupId,
    required this.username,
    required this.reason,
  });

  factory GroupMemberRemovedPayload.fromJson(Map<String, dynamic> json) {
    return GroupMemberRemovedPayload(
      groupId: readString(json['groupId']),
      username: readString(json['username']),
      reason: readString(json['reason']),
    );
  }

  final String groupId;
  final String username;
  final String reason;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'username': username,
    'reason': reason,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupMemberRemovedPayload &&
        other.groupId == groupId &&
        other.username == username &&
        other.reason == reason;
  }

  @override
  int get hashCode => Object.hash(groupId, username, reason);
}

/// `group:kick:tally` — the current vote-kick state for one group.
/// [status] is `'active'`, `'passed'` or `'expired'`.
class KickTally {
  const KickTally({
    required this.groupId,
    required this.username,
    required this.votes,
    required this.required,
    required this.status,
    required this.expiresAt,
  });

  factory KickTally.fromJson(Map<String, dynamic> json) {
    return KickTally(
      groupId: readString(json['groupId']),
      username: readString(json['username']),
      votes: readList(
        json['votes'],
      ).map((entry) => readString(entry)).toList(),
      required: readInt(json['required']),
      status: readString(json['status']),
      expiresAt: readInt(json['expiresAt']),
    );
  }

  final String groupId;
  final String username;
  final List<String> votes;
  final int required;
  final String status;
  final int expiresAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'username': username,
    'votes': votes,
    'required': required,
    'status': status,
    'expiresAt': expiresAt,
  };

  @override
  bool operator ==(Object other) {
    return other is KickTally &&
        other.groupId == groupId &&
        other.username == username &&
        other.required == required &&
        other.status == status &&
        other.expiresAt == expiresAt &&
        _votesEqual(other.votes, votes);
  }

  static bool _votesEqual(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(
    groupId,
    username,
    required,
    status,
    expiresAt,
    Object.hashAll(votes),
  );
}
