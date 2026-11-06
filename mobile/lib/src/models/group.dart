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
