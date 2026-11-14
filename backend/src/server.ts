import type { Logger } from 'pino';
import type { Server as IoServer, Socket } from 'socket.io';

import type { AccountStore } from './account-store';
import type { GroupStore } from './group-store';
import type { KickVoteStore } from './kick-vote-store';
import type { MediaAuth } from './media-auth';
import type { ProfileStore } from './profile-store';
import type { RateLimiterRegistry } from './rate-limiter';
import type {
  ClientToServerEvents,
  GroupInfo,
  GroupMember,
  KickTallyPayload,
  ServerToClientEvents,
  UserId,
  UserInfo,
} from './types';
import { CONSTANTS, EVENTS, GroupId, UserId as makeUserId, SocketId } from './types';
import type { UserDirectory } from './user-directory';
import type { UserRegistry } from './user-registry';
import {
  validateE2eePublicKeyPayload,
  validateGroupCreatePayload,
  validateGroupMessagePayload,
  validateGroupTargetPayload,
  validateLoginPayload,
  validateMessageDeletePayload,
  validateMessageEditPayload,
  validateMessageId,
  validateMessagePayload,
  validateMessageReactPayload,
  validatePollClosePayload,
  validatePollVotePayload,
  validateProfileUpdatePayload,
  validateReceiptReadPayload,
  validateRegisterPayload,
  validateTypingSendPayload,
  validateUserJoinPayload,
} from './validators';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = IoServer<ClientToServerEvents, ServerToClientEvents>;

// Where a conversation relay goes: the DM peer, or every group member.
type Conversation =
  | { readonly kind: 'dm'; readonly peer: UserInfo }
  | { readonly kind: 'group'; readonly groupId: GroupId; readonly members: readonly GroupMember[] };

// Either the fan-out set or a rejection reason for the emitter.
type ConversationResolution =
  | { readonly conversation: Conversation; readonly reason?: undefined }
  | { readonly conversation?: undefined; readonly reason: string };

function disconnectPreviousSocket(
  io: TypedServer,
  previous: UserInfo | undefined,
  currentSocketId: SocketId,
): void {
  if (previous === undefined || previous.socketId === currentSocketId) {
    return;
  }
  io.sockets.sockets.get(String(previous.socketId))?.disconnect(true);
}

export function createServer(
  io: TypedServer,
  userRegistry: UserRegistry,
  rateLimiters: RateLimiterRegistry,
  accountStore: AccountStore,
  groupStore: GroupStore,
  userDirectory: UserDirectory,
  kickVoteStore: KickVoteStore,
  mediaAuth: MediaAuth,
  profileStore: ProfileStore,
  logger: Logger,
): void {
  const pendingRegistrations = new Set<string>();

  // Last relayed typing event per (sender, target, active). Duplicate bursts
  // inside the debounce window collapse; keys are pruned once the map grows.
  const lastTypingSent = new Map<string, number>();

  // Profiles exist only at emit time — the registry and group store stay free
  // of presentation fields.
  const withProfile = (user: UserInfo): UserInfo => ({
    ...user,
    ...profileStore.resolve(user.username),
  });

  const withProfileGroup = (group: GroupInfo): GroupInfo => ({
    ...group,
    members: group.members.map((member) => ({
      ...member,
      ...profileStore.resolve(member.username),
    })),
  });

  // Registry entries survive a transport drop for the 30s reattach window, but
  // they must not be advertised as online while their socket is gone.
  const getConnectedUsers = (): readonly UserInfo[] =>
    userRegistry
      .getAllUsers()
      .filter((user) => io.sockets.sockets.get(String(user.socketId))?.connected === true)
      .map(withProfile);

  // Join/reconnect snapshot. Order matters: clients clear stored kick tallies
  // on active_groups, then re-receive the still-active ones.
  const sendSnapshots = (socket: TypedSocket, userId: UserId): void => {
    socket.emit(
      EVENTS.SERVER.ACTIVE_GROUPS,
      groupStore.getGroupsForUser(userId).map(withProfileGroup),
    );
    socket.emit(EVENTS.SERVER.USERS_DIRECTORY, userDirectory.all());
    for (const tally of kickVoteStore.activeTallies()) {
      if (groupStore.isMember(GroupId(tally.groupId), userId)) {
        socket.emit(EVENTS.SERVER.GROUP_KICK_TALLY, tally);
      }
    }
    socket.emit(EVENTS.SERVER.MEDIA_TOKEN, { token: mediaAuth.issue(userId) });
  };

  // Membership is read when this runs, so cancellation tallies still reach the
  // target before removal while pass/expiry tallies skip already-removed users.
  const broadcastTally = (groupId: GroupId, payload: KickTallyPayload): void => {
    const group = groupStore.getGroup(groupId);
    if (group === undefined) return;
    for (const member of group.members) {
      io.to(String(member.userId)).emit(EVENTS.SERVER.GROUP_KICK_TALLY, payload);
    }
  };

  kickVoteStore.onExpired = (groupId, target, tally) => {
    logger.info({ groupId, username: target }, 'kick vote expired');
    broadcastTally(groupId, { ...tally, status: 'expired' });
  };

  // Tier-1 events address either a DM peer or a group. Zod has already
  // enforced exactly-one-target, so this only maps that target onto a
  // fan-out set or a rejection reason for the emitter.
  const resolveConversation = (
    sender: UserInfo,
    target: { readonly to?: string | undefined; readonly groupId?: string | undefined },
  ): ConversationResolution => {
    if (target.groupId !== undefined) {
      const group = groupStore.getGroup(GroupId(target.groupId));
      if (group === undefined) {
        return { reason: 'Group not found' };
      }
      if (!group.members.some((member) => member.userId === sender.userId)) {
        return { reason: 'Not a group member' };
      }
      return {
        conversation: { kind: 'group', groupId: GroupId(target.groupId), members: group.members },
      };
    }
    if (target.to !== undefined) {
      const peer = userRegistry.getUserByUsername(target.to);
      if (peer !== undefined) {
        return { conversation: { kind: 'dm', peer } };
      }
      return { reason: 'User not found' };
    }
    return { reason: 'No conversation target' };
  };

  // The relay scope mirrors the request target: the DM peer's username or
  // the group id, never both.
  const scopeOf = (conversation: Conversation): { to: string } | { groupId: string } =>
    conversation.kind === 'dm'
      ? { to: conversation.peer.username }
      : { groupId: String(conversation.groupId) };

  const scopeKey = (conversation: Conversation): string =>
    conversation.kind === 'dm' ? conversation.peer.username : String(conversation.groupId);

  // Relay an event to everyone in the conversation except the emitter. Rooms
  // only hold connected sockets, so an offline peer or member simply receives
  // nothing — relays are dropped silently, never delivery_failed.
  function fanOutExceptSender(
    senderId: UserId,
    conversation: Conversation,
    emitToRoom: (room: string) => void,
  ): void {
    if (conversation.kind === 'dm') {
      emitToRoom(String(conversation.peer.userId));
      return;
    }
    for (const member of conversation.members) {
      if (member.userId === senderId) continue;
      emitToRoom(String(member.userId));
    }
  }

  io.on('connection', (socket: TypedSocket) => {
    socket.on(EVENTS.CLIENT.USER_JOIN, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateUserJoinPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const { username } = valResult.data;
      if (pendingRegistrations.has(username) || accountStore.usernameExists(username)) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'username taken' });
        return;
      }

      const currentSocketId = SocketId(socket.id);
      const previous = userRegistry.getUserByUsername(username);
      const userInfo = userRegistry.addUser(username, currentSocketId);
      if (userInfo === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'username taken' });
        return;
      }
      userDirectory.rememberGuest(username);

      disconnectPreviousSocket(io, previous, currentSocketId);

      socket.join(String(userInfo.userId));
      io.emit(EVENTS.SERVER.USER_JOINED, withProfile(userInfo));
      socket.emit(EVENTS.SERVER.ACTIVE_USERS, getConnectedUsers());
      sendSnapshots(socket, userInfo.userId);

      logger.info({ userId: userInfo.userId, username: userInfo.username }, 'user joined');
    });

    socket.on(EVENTS.CLIENT.USER_REGISTER, async (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.REGISTER_ERROR, {
          kind: 'register_error',
          reason: 'rate_limited',
        });
        return;
      }

      const valResult = validateRegisterPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.REGISTER_ERROR, {
          kind: 'register_error',
          reason: 'validation_failed',
        });
        return;
      }

      const username = valResult.data.username;
      if (
        pendingRegistrations.has(username) ||
        userRegistry.getUserByUsername(username) !== undefined
      ) {
        socket.emit(EVENTS.SERVER.REGISTER_ERROR, {
          kind: 'register_error',
          reason: 'username_taken',
        });
        return;
      }

      pendingRegistrations.add(username);
      try {
        const currentSocketId = SocketId(socket.id);
        const previous = userRegistry.getUserByUsername(username);

        const result = await accountStore.createAccount(
          username,
          valResult.data.password,
          valResult.data.pin,
        );

        if (result.kind === 'register_error') {
          socket.emit(EVENTS.SERVER.REGISTER_ERROR, result);
          return;
        }

        const userInfo = userRegistry.registerSocket(
          result.userId,
          result.username,
          currentSocketId,
        );
        if (userInfo === undefined) {
          socket.emit(EVENTS.SERVER.REGISTER_ERROR, {
            kind: 'register_error',
            reason: 'username_taken',
          });
          return;
        }

        disconnectPreviousSocket(io, previous, currentSocketId);

        socket.join(String(result.userId));
        io.emit(EVENTS.SERVER.USER_JOINED, withProfile(userInfo));
        socket.emit(EVENTS.SERVER.ACTIVE_USERS, getConnectedUsers());
        sendSnapshots(socket, result.userId);
        socket.emit(EVENTS.SERVER.REGISTER_SUCCESS, result);

        logger.info({ userId: result.userId, username: result.username }, 'user registered');
      } catch {
        socket.emit(EVENTS.SERVER.REGISTER_ERROR, {
          kind: 'register_error',
          reason: 'internal_error',
        });
      } finally {
        pendingRegistrations.delete(username);
      }
    });

    socket.on(EVENTS.CLIENT.USER_LOGIN, async (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.LOGIN_ERROR, {
          kind: 'login_error',
          reason: 'rate_limited',
        });
        return;
      }

      const valResult = validateLoginPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.LOGIN_ERROR, {
          kind: 'login_error',
          reason: 'validation_failed',
        });
        return;
      }

      try {
        const result = await accountStore.authenticate(
          valResult.data.username,
          valResult.data.password,
          valResult.data.pin,
        );

        if (result.kind === 'login_error') {
          socket.emit(EVENTS.SERVER.LOGIN_ERROR, result);
          return;
        }

        const currentSocketId = SocketId(socket.id);
        const previous = userRegistry.getUserByUsername(result.username);

        const userInfo = userRegistry.registerSocket(
          result.userId,
          result.username,
          currentSocketId,
        );
        if (userInfo === undefined) {
          socket.emit(EVENTS.SERVER.LOGIN_ERROR, {
            kind: 'login_error',
            reason: 'invalid_credentials',
          });
          return;
        }

        disconnectPreviousSocket(io, previous, currentSocketId);

        socket.join(String(result.userId));
        io.emit(EVENTS.SERVER.USER_JOINED, withProfile(userInfo));
        socket.emit(EVENTS.SERVER.ACTIVE_USERS, getConnectedUsers());
        sendSnapshots(socket, result.userId);
        socket.emit(EVENTS.SERVER.LOGIN_SUCCESS, result);

        logger.info({ userId: result.userId, username: result.username }, 'user logged in');
      } catch {
        socket.emit(EVENTS.SERVER.LOGIN_ERROR, {
          kind: 'login_error',
          reason: 'internal_error',
        });
      }
    });

    socket.on(EVENTS.CLIENT.MESSAGE_SEND, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateMessagePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) {
        return;
      }

      const target = userRegistry.getUserByUsername(valResult.data.to);

      if (target === undefined) {
        socket.emit(EVENTS.SERVER.DELIVERY_FAILED, {
          delivered: false as const,
          reason: 'user_not_found' as const,
          to: valResult.data.to,
        });
        return;
      }

      const targetSocketId = String(target.socketId);
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket === undefined || !targetSocket.connected) {
        socket.emit(EVENTS.SERVER.DELIVERY_FAILED, {
          delivered: false as const,
          reason: 'user_disconnected' as const,
          to: target.username,
        });
        return;
      }

      const message = {
        from: sender.userId,
        fromUsername: sender.username,
        to: target.userId,
        toUsername: target.username,
        id: valResult.data.id,
        ciphertext: valResult.data.ciphertext,
        iv: valResult.data.iv,
        timestamp: Date.now(),
      };

      io.to(String(target.userId)).emit(EVENTS.SERVER.PRIVATE_MESSAGE, message);
      socket.emit(EVENTS.SERVER.PRIVATE_MESSAGE, message);
    });

    socket.on(EVENTS.CLIENT.E2EE_PUBLIC_KEY, (payload) => {
      const valResult = validateE2eePublicKeyPayload(payload);
      if (!valResult.success) {
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) {
        return;
      }

      const target = userRegistry.getUserByUsername(valResult.data.to);
      if (target === undefined) {
        return;
      }

      const relay = {
        from: sender.userId,
        fromUsername: sender.username,
        publicKey: valResult.data.publicKey,
      };

      io.to(String(target.userId)).emit(EVENTS.SERVER.E2EE_PUBLIC_KEY, relay);
    });

    socket.on(EVENTS.CLIENT.GROUP_CREATE, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.GROUP_CREATED_ERROR, { message: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateGroupCreatePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.GROUP_CREATED_ERROR, {
          message: valResult.errors.join(', '),
        });
        return;
      }

      const creator = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (creator === undefined) return;

      const invitees = [...new Set(valResult.data.members)].filter((u) => u !== creator.username);
      const unknown = invitees.filter((u) => userDirectory.resolve(u) === undefined);
      if (unknown.length > 0) {
        socket.emit(EVENTS.SERVER.GROUP_CREATED_ERROR, {
          message: `Unknown members: ${unknown.join(', ')}`,
        });
        return;
      }

      const group = groupStore.createGroup(valResult.data.name, creator);

      for (const invitee of invitees) {
        const resolved = userDirectory.resolve(invitee);
        if (resolved === undefined) continue;
        groupStore.addGroupMember(group.groupId, makeUserId(resolved.userId), resolved.username);
      }

      const updated = groupStore.getGroup(group.groupId);
      if (updated === undefined) return;

      for (const member of updated.members) {
        io.to(String(member.userId)).emit(EVENTS.SERVER.GROUP_CREATED, withProfileGroup(updated));
      }

      logger.info({ groupId: group.groupId, name: group.name }, 'group created');
    });

    socket.on(EVENTS.CLIENT.GROUP_MEMBER_ADD, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateGroupTargetPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.ERROR, { message: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const groupId = GroupId(valResult.data.groupId);
      const group = groupStore.getGroup(groupId);
      if (group === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Group not found' });
        return;
      }

      const senderMember = group.members.find((m) => m.userId === sender.userId);
      if (senderMember?.isAdmin !== true) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Only admins can add members' });
        return;
      }

      const { username } = valResult.data;
      if (group.members.some((m) => m.username === username)) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'User is already a member' });
        return;
      }

      if (group.members.length >= CONSTANTS.MAX_GROUP_MEMBERS) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Group is full' });
        return;
      }

      const resolved = userDirectory.resolve(username);
      if (resolved === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, { message: `Unknown user: ${username}` });
        return;
      }

      const added = groupStore.addGroupMember(
        groupId,
        makeUserId(resolved.userId),
        resolved.username,
      );
      if (!added) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'User is already a member' });
        return;
      }

      const updated = groupStore.getGroup(groupId);
      if (updated === undefined) return;

      for (const member of updated.members) {
        io.to(String(member.userId)).emit(EVENTS.SERVER.GROUP_CREATED, withProfileGroup(updated));
      }

      const tally = kickVoteStore.getTally(groupId);
      if (tally !== undefined) {
        io.to(String(resolved.userId)).emit(EVENTS.SERVER.GROUP_KICK_TALLY, tally);
      }

      logger.info({ groupId, username }, 'group member added');
    });

    socket.on(EVENTS.CLIENT.GROUP_MEMBER_REMOVE, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateGroupTargetPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.ERROR, { message: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const groupId = GroupId(valResult.data.groupId);
      const group = groupStore.getGroup(groupId);
      if (group === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Group not found' });
        return;
      }

      const senderMember = group.members.find((m) => m.userId === sender.userId);
      if (senderMember?.isAdmin !== true) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Only admins can remove members' });
        return;
      }

      const { username } = valResult.data;
      const target = group.members.find((m) => m.username === username);
      if (target === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'User is not a group member' });
        return;
      }

      if (target.userId === group.createdBy) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'The group creator cannot be removed' });
        return;
      }

      // A vote on the departing member dies with them: announce the
      // cancellation first so clients drop the tally before the removal.
      const doomedTally = kickVoteStore.getTally(groupId);
      if (doomedTally !== undefined && doomedTally.username === username) {
        kickVoteStore.cancel(groupId);
        broadcastTally(groupId, { ...doomedTally, status: 'expired' });
      }

      groupStore.removeGroupMember(groupId, target.userId);

      if (kickVoteStore.dropVoter(groupId, username)) {
        const shrunkTally = kickVoteStore.getTally(groupId);
        if (shrunkTally !== undefined) {
          broadcastTally(groupId, shrunkTally);
        }
      }

      const updated = groupStore.getGroup(groupId);
      if (updated === undefined) return;

      for (const member of updated.members) {
        io.to(String(member.userId)).emit(EVENTS.SERVER.GROUP_CREATED, withProfileGroup(updated));
      }
      io.to(String(target.userId)).emit(EVENTS.SERVER.GROUP_MEMBER_REMOVED, {
        groupId: valResult.data.groupId,
        username,
        reason: 'removed',
      });

      logger.info({ groupId, username }, 'group member removed');
    });

    socket.on(EVENTS.CLIENT.GROUP_KICK_VOTE, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateGroupTargetPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.ERROR, { message: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const groupId = GroupId(valResult.data.groupId);
      const group = groupStore.getGroup(groupId);
      if (group === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Group not found' });
        return;
      }

      if (!group.members.some((m) => m.userId === sender.userId)) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'Not a group member' });
        return;
      }

      const { username } = valResult.data;
      const target = group.members.find((m) => m.username === username);
      if (target === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'User is not a group member' });
        return;
      }

      if (username === sender.username) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'You cannot vote to kick yourself' });
        return;
      }

      if (target.userId === group.createdBy) {
        socket.emit(EVENTS.SERVER.ERROR, { message: 'The group creator cannot be kicked' });
        return;
      }

      const existing = kickVoteStore.getTally(groupId);
      let tally: KickTallyPayload;
      if (existing === undefined) {
        tally = kickVoteStore.start(groupId, username, group.members.length, sender.username);
      } else {
        if (existing.username !== username) {
          socket.emit(EVENTS.SERVER.ERROR, { message: 'A vote is already in progress' });
          return;
        }
        if (existing.votes.includes(sender.username)) {
          return;
        }
        const next = kickVoteStore.addVoter(groupId, sender.username);
        if (next === undefined) return;
        tally = next;
      }

      if (tally.votes.length >= tally.required) {
        kickVoteStore.cancel(groupId);
        broadcastTally(groupId, { ...tally, status: 'passed' });
        groupStore.removeGroupMember(groupId, target.userId);

        const updated = groupStore.getGroup(groupId);
        if (updated !== undefined) {
          for (const member of updated.members) {
            io.to(String(member.userId)).emit(
              EVENTS.SERVER.GROUP_CREATED,
              withProfileGroup(updated),
            );
          }
        }
        io.to(String(target.userId)).emit(EVENTS.SERVER.GROUP_MEMBER_REMOVED, {
          groupId: valResult.data.groupId,
          username,
          reason: 'kicked',
        });

        logger.info({ groupId, username }, 'group member kicked by vote');
        return;
      }

      broadcastTally(groupId, tally);
    });

    socket.on(EVENTS.CLIENT.GROUP_MESSAGE_SEND, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, {
          message: 'Rate limit exceeded',
        });
        return;
      }

      // Spec A: a malformed id takes the message_rejected path on both send
      // events, ahead of the group-specific validation errors below.
      const idResult = validateMessageId((payload as { readonly id?: unknown } | undefined)?.id);
      if (!idResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, {
          reason: idResult.errors.join(', '),
        });
        return;
      }

      const valResult = validateGroupMessagePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, {
          message: valResult.errors.join(', '),
        });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const groupId = GroupId(valResult.data.groupId);
      if (!groupStore.isMember(groupId, sender.userId)) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, {
          message: 'Not a group member',
        });
        return;
      }

      const group = groupStore.getGroup(groupId);
      if (group === undefined) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, { message: 'Group not found' });
        return;
      }

      const message = {
        groupId: valResult.data.groupId,
        from: sender.userId,
        fromUsername: sender.username,
        id: valResult.data.id,
        ciphertexts: valResult.data.ciphertexts,
        timestamp: Date.now(),
      };

      for (const member of group.members) {
        if (member.userId === sender.userId) continue;
        io.to(String(member.userId)).emit(EVENTS.SERVER.GROUP_MESSAGE, message);
      }
      socket.emit(EVENTS.SERVER.GROUP_MESSAGE, message);
    });

    socket.on(EVENTS.CLIENT.TYPING_SEND, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateTypingSendPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const resolved = resolveConversation(sender, valResult.data);
      if (resolved.reason !== undefined) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: resolved.reason });
        return;
      }
      const conversation = resolved.conversation;

      // Collapse duplicate bursts for the same sender/target/active flag; the
      // debounce is best-effort and clients re-send every 4 s regardless.
      const now = Date.now();
      const key = `${sender.username}|${scopeKey(conversation)}|${valResult.data.active}`;
      const lastSent = lastTypingSent.get(key);
      if (lastSent !== undefined && now - lastSent < CONSTANTS.TYPING_DEBOUNCE_MS) {
        return;
      }
      if (lastTypingSent.size > 1000) {
        for (const [staleKey, sentAt] of lastTypingSent) {
          if (now - sentAt >= CONSTANTS.TYPING_DEBOUNCE_MS) lastTypingSent.delete(staleKey);
        }
      }
      lastTypingSent.set(key, now);

      fanOutExceptSender(sender.userId, conversation, (room) => {
        io.to(room).emit(EVENTS.SERVER.TYPING_CHANGED, {
          from: sender.userId,
          fromUsername: sender.username,
          ...scopeOf(conversation),
          active: valResult.data.active,
        });
      });
    });

    socket.on(EVENTS.CLIENT.RECEIPT_READ, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateReceiptReadPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const target = userRegistry.getUserByUsername(valResult.data.to);
      if (target === undefined) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'User not found' });
        return;
      }

      // DM only: the receipt lands in the peer's room and never echoes back to
      // the sender; an offline peer's room is empty, so it drops silently.
      io.to(String(target.userId)).emit(EVENTS.SERVER.RECEIPT_READ, {
        from: sender.userId,
        fromUsername: sender.username,
        upTo: valResult.data.upTo,
      });
    });

    socket.on(EVENTS.CLIENT.MESSAGE_REACT, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateMessageReactPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const resolved = resolveConversation(sender, valResult.data);
      if (resolved.reason !== undefined) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: resolved.reason });
        return;
      }

      fanOutExceptSender(sender.userId, resolved.conversation, (room) => {
        io.to(room).emit(EVENTS.SERVER.MESSAGE_REACTED, {
          from: sender.userId,
          fromUsername: sender.username,
          ...scopeOf(resolved.conversation),
          targetId: valResult.data.targetId,
          emoji: valResult.data.emoji,
          active: valResult.data.active,
          timestamp: Date.now(),
        });
      });
    });

    socket.on(EVENTS.CLIENT.MESSAGE_EDIT, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateMessageEditPayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const resolved = resolveConversation(sender, valResult.data);
      if (resolved.reason !== undefined) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: resolved.reason });
        return;
      }

      fanOutExceptSender(sender.userId, resolved.conversation, (room) => {
        io.to(room).emit(EVENTS.SERVER.MESSAGE_EDITED, {
          from: sender.userId,
          fromUsername: sender.username,
          ...scopeOf(resolved.conversation),
          targetId: valResult.data.targetId,
          ciphertext: valResult.data.ciphertext,
          iv: valResult.data.iv,
          timestamp: Date.now(),
        });
      });
    });

    socket.on(EVENTS.CLIENT.MESSAGE_DELETE, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateMessageDeletePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const resolved = resolveConversation(sender, valResult.data);
      if (resolved.reason !== undefined) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: resolved.reason });
        return;
      }

      fanOutExceptSender(sender.userId, resolved.conversation, (room) => {
        io.to(room).emit(EVENTS.SERVER.MESSAGE_DELETED, {
          from: sender.userId,
          fromUsername: sender.username,
          ...scopeOf(resolved.conversation),
          targetId: valResult.data.targetId,
          timestamp: Date.now(),
        });
      });
    });

    socket.on(EVENTS.CLIENT.POLL_VOTE, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validatePollVotePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const resolved = resolveConversation(sender, valResult.data);
      if (resolved.reason !== undefined) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: resolved.reason });
        return;
      }

      // Poll definitions live inside the ciphertext, so the server relays the
      // vote blindly — no poll existence check, clients drop unknown pollIds.
      fanOutExceptSender(sender.userId, resolved.conversation, (room) => {
        io.to(room).emit(EVENTS.SERVER.POLL_VOTED, {
          pollId: valResult.data.pollId,
          option: valResult.data.option,
          u: sender.username,
          ...scopeOf(resolved.conversation),
        });
      });
    });

    socket.on(EVENTS.CLIENT.POLL_CLOSE, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validatePollClosePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const resolved = resolveConversation(sender, valResult.data);
      if (resolved.reason !== undefined) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: resolved.reason });
        return;
      }

      // No server-side authorship check on close — ciphertext is opaque, so
      // clients apply poll:closed only when u matches the poll author.
      fanOutExceptSender(sender.userId, resolved.conversation, (room) => {
        io.to(room).emit(EVENTS.SERVER.POLL_CLOSED, {
          pollId: valResult.data.pollId,
          u: sender.username,
          ...scopeOf(resolved.conversation),
        });
      });
    });

    socket.on(EVENTS.CLIENT.PROFILE_UPDATE, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: 'Rate limit exceeded' });
        return;
      }

      const valResult = validateProfileUpdatePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, { reason: valResult.errors.join(', ') });
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      profileStore.set(sender.username, {
        displayName: valResult.data.displayName,
        status: valResult.data.status,
      });

      // Profiles are global: every active session, including the editor,
      // picks up the new fields immediately.
      io.emit(EVENTS.SERVER.PROFILE_UPDATED, {
        username: sender.username,
        displayName: valResult.data.displayName,
        status: valResult.data.status,
      });

      logger.info({ username: sender.username }, 'profile updated');
    });

    socket.on('disconnect', (reason: string) => {
      rateLimiters.remove(socket.id);

      const user = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (user === undefined) {
        return;
      }

      const payload = { userId: user.userId, username: user.username };

      if (reason === 'client namespace disconnect') {
        userRegistry.removeUserBySocketId(SocketId(socket.id));
        io.emit(EVENTS.SERVER.USER_LEFT, payload);
        logger.info({ userId: user.userId, reason }, 'user disconnected (explicit)');
      } else {
        userRegistry.markDisconnected(user.userId);
        io.emit(EVENTS.SERVER.USER_LEFT, payload);
        logger.warn({ userId: user.userId, reason }, 'user disconnected (unannounced)');
      }
    });
  });

  logger.info('server ready');
}
