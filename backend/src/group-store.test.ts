import { afterAll, describe, expect, test } from 'bun:test';
import { GroupStore } from './group-store';
import { GroupId, UserId, type UserInfo } from './types';

describe('GroupStore', () => {
  let store: GroupStore;

  afterAll(() => {
    store.destroy();
  });

  test('createGroup returns group with creator as admin', () => {
    store = new GroupStore();
    const creator: UserInfo = {
      userId: UserId('user1'),
      username: 'alice',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Test Group', creator);

    expect(group.name).toBe('Test Group');
    expect(group.members.length).toBe(1);
    const [firstMember] = group.members;
    expect(firstMember?.userId).toBe(UserId('user1'));
    expect(firstMember?.isAdmin).toBe(true);
    expect(group.createdBy).toBe(UserId('user1'));
  });

  test('getGroup returns group by id', () => {
    const creator: UserInfo = {
      userId: UserId('user2'),
      username: 'bob',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Another Group', creator);
    const found = store.getGroup(group.groupId);

    expect(found).toBeDefined();
    expect(found?.name).toBe('Another Group');
  });

  test('getGroup returns undefined for unknown id', () => {
    const found = store.getGroup(GroupId('nonexistent'));
    expect(found).toBeUndefined();
  });

  test('getGroupsForUser returns groups user belongs to', () => {
    const creator: UserInfo = {
      userId: UserId('user3'),
      username: 'charlie',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Charlie Group', creator);
    const groups = store.getGroupsForUser(UserId('user3'));

    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.some((g) => g.groupId === group.groupId)).toBe(true);
  });

  test('addGroupMember adds new member successfully', () => {
    const creator: UserInfo = {
      userId: UserId('user4'),
      username: 'dave',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Dave Group', creator);
    const added = store.addGroupMember(group.groupId, UserId('user5'), 'eve');

    expect(added).toBe(true);
    const updated = store.getGroup(group.groupId);
    expect(updated?.members.length).toBe(2);
  });

  test('addGroupMember returns false for duplicate member', () => {
    const creator: UserInfo = {
      userId: UserId('user6'),
      username: 'frank',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Frank Group', creator);
    const first = store.addGroupMember(group.groupId, UserId('user7'), 'grace');
    const second = store.addGroupMember(group.groupId, UserId('user7'), 'grace');

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  test('addGroupMember returns false for unknown group', () => {
    const added = store.addGroupMember(GroupId('unknown'), UserId('user8'), 'henry');
    expect(added).toBe(false);
  });

  test('removeGroupMember removes non-admin member', () => {
    const creator: UserInfo = {
      userId: UserId('user9'),
      username: 'ivy',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Ivy Group', creator);
    store.addGroupMember(group.groupId, UserId('user10'), 'jack');
    const removed = store.removeGroupMember(group.groupId, UserId('user10'));

    expect(removed).toBe(true);
    const updated = store.getGroup(group.groupId);
    expect(updated?.members.length).toBe(1);
  });

  test('removeGroupMember returns false for admin (creator)', () => {
    const creator: UserInfo = {
      userId: UserId('user11'),
      username: 'kate',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Kate Group', creator);
    const removed = store.removeGroupMember(group.groupId, UserId('user11'));

    expect(removed).toBe(false);
  });

  test('removeGroupMember returns false for non-member', () => {
    const creator: UserInfo = {
      userId: UserId('user12'),
      username: 'leo',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Leo Group', creator);
    const removed = store.removeGroupMember(group.groupId, UserId('user13'));

    expect(removed).toBe(false);
  });

  test('removeGroupMember returns false for unknown group', () => {
    const removed = store.removeGroupMember(GroupId('unknown'), UserId('user14'));
    expect(removed).toBe(false);
  });

  test('isMember returns true for group member', () => {
    const creator: UserInfo = {
      userId: UserId('user15'),
      username: 'mike',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Mike Group', creator);
    expect(store.isMember(group.groupId, UserId('user15'))).toBe(true);
  });

  test('isMember returns false for non-member', () => {
    const creator: UserInfo = {
      userId: UserId('user16'),
      username: 'nina',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    const group = store.createGroup('Nina Group', creator);
    expect(store.isMember(group.groupId, UserId('user17'))).toBe(false);
  });

  test('isMember returns false for unknown group', () => {
    expect(store.isMember(GroupId('unknown'), UserId('user18'))).toBe(false);
  });

  test('destroy clears all groups', () => {
    const creator: UserInfo = {
      userId: UserId('user19'),
      username: 'oscar',
      socketId: null as unknown as never,
      joinedAt: Date.now(),
    };

    store.createGroup('Oscar Group', creator);
    store.destroy();
    expect(store.getGroupsForUser(UserId('user19')).length).toBe(0);
  });
});
