import type { Logger } from 'pino';
import type { Server as IoServer, Socket } from 'socket.io';

import type { AccountStore } from './account-store';
import type { GroupStore } from './group-store';
import type { RateLimiterRegistry } from './rate-limiter';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { EVENTS, GroupId, SocketId, UserId } from './types';
import type { UserRegistry } from './user-registry';
import {
  validateE2eePublicKeyPayload,
  validateGroupCreatePayload,
  validateGroupMessagePayload,
  validateLoginPayload,
  validateMessagePayload,
  validateRegisterPayload,
  validateUsername,
} from './validators';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = IoServer<ClientToServerEvents, ServerToClientEvents>;

export function createServer(
  io: TypedServer,
  userRegistry: UserRegistry,
  rateLimiters: RateLimiterRegistry,
  accountStore: AccountStore,
  groupStore: GroupStore,
  logger: Logger,
): void {
  io.on('connection', (socket: TypedSocket) => {
    socket.on(EVENTS.CLIENT.USER_JOIN, (username: string) => {
      const val = validateUsername(username);
      if (!val.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, val.errors);
        return;
      }

      const userInfo = userRegistry.addUser(username, SocketId(socket.id));
      if (userInfo === undefined) {
        socket.emit(EVENTS.SERVER.ERROR, 'username taken');
        return;
      }

      socket.join(String(userInfo.userId));
      io.emit(EVENTS.SERVER.USER_JOINED, userInfo);
      socket.emit(EVENTS.SERVER.ACTIVE_USERS, userRegistry.getAllUsers());

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

      try {
        const result = await accountStore.createAccount(
          valResult.data.username,
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
          SocketId(socket.id),
        );
        if (userInfo === undefined) {
          socket.emit(EVENTS.SERVER.REGISTER_ERROR, {
            kind: 'register_error',
            reason: 'username_taken',
          });
          return;
        }

        socket.join(String(result.userId));
        io.emit(EVENTS.SERVER.USER_JOINED, userInfo);
        socket.emit(EVENTS.SERVER.ACTIVE_USERS, userRegistry.getAllUsers());
        socket.emit(EVENTS.SERVER.REGISTER_SUCCESS, result);

        logger.info({ userId: result.userId, username: result.username }, 'user registered');
      } catch {
        socket.emit(EVENTS.SERVER.REGISTER_ERROR, {
          kind: 'register_error',
          reason: 'internal_error',
        });
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

        const userInfo = userRegistry.registerSocket(
          result.userId,
          result.username,
          SocketId(socket.id),
        );
        if (userInfo === undefined) {
          socket.emit(EVENTS.SERVER.LOGIN_ERROR, {
            kind: 'login_error',
            reason: 'invalid_credentials',
          });
          return;
        }

        socket.join(String(result.userId));
        io.emit(EVENTS.SERVER.USER_JOINED, userInfo);
        socket.emit(EVENTS.SERVER.ACTIVE_USERS, userRegistry.getAllUsers());
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
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, ['Rate limit exceeded']);
        return;
      }

      const valResult = validateMessagePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.MESSAGE_REJECTED, valResult.errors);
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) {
        return;
      }

      const allUsers = userRegistry.getAllUsers();
      const target = allUsers.find((u) => u.username === valResult.data.to);

      if (target === undefined) {
        socket.emit(EVENTS.SERVER.DELIVERY_FAILED, {
          delivered: false as const,
          reason: 'user_not_found' as const,
          to: UserId(valResult.data.to),
        });
        return;
      }

      const targetSocketId = String(target.socketId);
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket === undefined || !targetSocket.connected) {
        socket.emit(EVENTS.SERVER.DELIVERY_FAILED, {
          delivered: false as const,
          reason: 'user_disconnected' as const,
          to: target.userId,
        });
        return;
      }

      const message = {
        from: sender.userId,
        fromUsername: sender.username,
        to: target.userId,
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

      const allUsers = userRegistry.getAllUsers();
      const target = allUsers.find((u) => u.username === valResult.data.to);
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
        socket.emit(EVENTS.SERVER.GROUP_CREATED_ERROR, 'Rate limit exceeded');
        return;
      }

      const valResult = validateGroupCreatePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.GROUP_CREATED_ERROR, valResult.errors.join(', '));
        return;
      }

      const creator = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (creator === undefined) return;

      const group = groupStore.createGroup(valResult.data.name, creator);

      const allUsers = userRegistry.getAllUsers();
      for (const memberUsername of valResult.data.members) {
        const user = allUsers.find((u) => u.username === memberUsername);
        if (user !== undefined) {
          groupStore.addGroupMember(group.groupId, user.userId, user.username);
        }
      }

      const updated = groupStore.getGroup(group.groupId);
      if (updated === undefined) return;

      for (const member of updated.members) {
        io.to(String(member.userId)).emit(EVENTS.SERVER.GROUP_CREATED, updated);
      }

      logger.info({ groupId: group.groupId, name: group.name }, 'group created');
    });

    socket.on(EVENTS.CLIENT.GROUP_MESSAGE_SEND, (payload) => {
      const rlResult = rateLimiters.check(socket.id);
      if (!rlResult.allowed) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, 'Rate limit exceeded');
        return;
      }

      const valResult = validateGroupMessagePayload(payload);
      if (!valResult.success) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, valResult.errors.join(', '));
        return;
      }

      const sender = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (sender === undefined) return;

      const groupId = GroupId(valResult.data.groupId);
      if (!groupStore.isMember(groupId, sender.userId)) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, 'Not a group member');
        return;
      }

      const group = groupStore.getGroup(groupId);
      if (group === undefined) {
        socket.emit(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, 'Group not found');
        return;
      }

      const message = {
        groupId: valResult.data.groupId,
        from: sender.userId,
        fromUsername: sender.username,
        ciphertexts: valResult.data.ciphertexts,
        timestamp: Date.now(),
      };

      for (const member of group.members) {
        if (member.userId === sender.userId) continue;
        io.to(String(member.userId)).emit(EVENTS.SERVER.GROUP_MESSAGE, message);
      }
      socket.emit(EVENTS.SERVER.GROUP_MESSAGE, message);
    });

    socket.on('disconnect', (reason: string) => {
      const user = userRegistry.getUserBySocketId(SocketId(socket.id));
      if (user === undefined) {
        return;
      }

      rateLimiters.remove(socket.id);

      if (reason === 'client namespace disconnect') {
        userRegistry.removeUserBySocketId(SocketId(socket.id));
        io.emit(EVENTS.SERVER.USER_LEFT, user.userId);
        logger.info({ userId: user.userId, reason }, 'user disconnected (explicit)');
      } else {
        userRegistry.markDisconnected(user.userId);
        io.emit(EVENTS.SERVER.USER_LEFT, user.userId);
        logger.warn({ userId: user.userId, reason }, 'user disconnected (unannounced)');
      }
    });
  });

  logger.info('server ready');
}
