import { randomUUID } from 'node:crypto';
import type { GroupId, GroupInfo, GroupMember, UserId, UserInfo } from './types';
import { GroupId as makeGroupId } from './types';

export class GroupStore {
  #groups: Map<GroupId, GroupInfo>;

  constructor() {
    this.#groups = new Map();
  }

  createGroup(name: string, creator: UserInfo): GroupInfo {
    const groupId = makeGroupId(randomUUID());
    const creatorMember: GroupMember = {
      userId: creator.userId,
      username: creator.username,
      isAdmin: true,
    };
    const group: GroupInfo = {
      groupId,
      name,
      members: [creatorMember],
      createdBy: creator.userId,
      createdAt: Date.now(),
    };
    this.#groups.set(groupId, group);
    return group;
  }

  getGroup(groupId: GroupId): GroupInfo | undefined {
    return this.#groups.get(groupId);
  }

  getGroupsForUser(userId: UserId): readonly GroupInfo[] {
    return Array.from(this.#groups.values()).filter((g) =>
      g.members.some((m) => m.userId === userId),
    );
  }

  addGroupMember(groupId: GroupId, userId: UserId, username: string): boolean {
    const group = this.#groups.get(groupId);
    if (group === undefined) return false;
    if (group.members.some((m) => m.userId === userId)) return false;

    const newMember: GroupMember = { userId, username, isAdmin: false };
    const updated: GroupInfo = { ...group, members: [...group.members, newMember] };
    this.#groups.set(groupId, updated);
    return true;
  }

  removeGroupMember(groupId: GroupId, userId: UserId): boolean {
    const group = this.#groups.get(groupId);
    if (group === undefined) return false;
    if (group.createdBy === userId) return false;
    if (!group.members.some((m) => m.userId === userId)) return false;

    const updated: GroupInfo = {
      ...group,
      members: group.members.filter((m) => m.userId !== userId),
    };
    this.#groups.set(groupId, updated);
    return true;
  }

  isMember(groupId: GroupId, userId: UserId): boolean {
    const group = this.#groups.get(groupId);
    if (group === undefined) return false;
    return group.members.some((m) => m.userId === userId);
  }

  destroy(): void {
    this.#groups.clear();
  }
}
