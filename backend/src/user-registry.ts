import type { SocketId, UserInfo } from './types';
import { CONSTANTS, UserId } from './types';

export class UserRegistry {
  #users: Map<UserId, UserInfo>;
  #pendingRemoval: Map<UserId, ReturnType<typeof setTimeout>>;
  #socketToUser: Map<SocketId, UserInfo>;
  onUserRemoved: ((userId: UserId, username: string) => void) | undefined;

  constructor() {
    this.#users = new Map();
    this.#pendingRemoval = new Map();
    this.#socketToUser = new Map();
    this.onUserRemoved = undefined;
  }

  #insertUser(userInfo: UserInfo, socketId: SocketId): UserInfo | undefined {
    for (const existing of this.#users.values()) {
      if (existing.username !== userInfo.username) {
        continue;
      }
      if (existing.userId !== userInfo.userId) {
        return undefined;
      }

      this.cancelPendingRemoval(existing.userId);
      this.#socketToUser.delete(existing.socketId);

      const updated: UserInfo = { ...userInfo, joinedAt: existing.joinedAt };
      this.#users.set(updated.userId, updated);
      this.#socketToUser.set(socketId, updated);
      return updated;
    }

    this.#users.set(userInfo.userId, userInfo);
    this.#socketToUser.set(socketId, userInfo);
    return userInfo;
  }

  addUser(username: string, socketId: SocketId): UserInfo | undefined {
    const userId = UserId(username);
    const userInfo: UserInfo = {
      userId,
      username,
      socketId,
      joinedAt: Date.now(),
    };
    return this.#insertUser(userInfo, socketId);
  }

  registerSocket(userId: UserId, username: string, socketId: SocketId): UserInfo | undefined {
    const userInfo: UserInfo = {
      userId,
      username,
      socketId,
      joinedAt: Date.now(),
    };
    return this.#insertUser(userInfo, socketId);
  }

  removeUser(userId: UserId): boolean {
    const user = this.#users.get(userId);
    if (!user) {
      return false;
    }
    this.#users.delete(userId);
    this.#socketToUser.delete(user.socketId);
    const timer = this.#pendingRemoval.get(userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#pendingRemoval.delete(userId);
    }
    return true;
  }

  removeUserBySocketId(socketId: SocketId): UserInfo | undefined {
    const user = this.#socketToUser.get(socketId);
    if (!user) {
      return undefined;
    }
    this.#users.delete(user.userId);
    this.#socketToUser.delete(socketId);
    const timer = this.#pendingRemoval.get(user.userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#pendingRemoval.delete(user.userId);
    }
    return user;
  }

  getUser(userId: UserId): UserInfo | undefined {
    return this.#users.get(userId);
  }

  getUserByUsername(username: string): UserInfo | undefined {
    for (const user of this.#users.values()) {
      if (user.username === username) {
        return user;
      }
    }
    return undefined;
  }

  getUserBySocketId(socketId: SocketId): UserInfo | undefined {
    return this.#socketToUser.get(socketId);
  }

  getAllUsers(): readonly UserInfo[] {
    return Array.from(this.#users.values());
  }

  get size(): number {
    return this.#users.size;
  }

  markDisconnected(userId: UserId): void {
    const user = this.#users.get(userId);
    if (!user) {
      return;
    }
    const { username, socketId } = user;
    const timer = setTimeout(() => {
      this.#users.delete(userId);
      this.#pendingRemoval.delete(userId);
      this.#socketToUser.delete(socketId);
      this.onUserRemoved?.(userId, username);
    }, CONSTANTS.USER_STALE_TIMEOUT_MS);
    this.#pendingRemoval.set(userId, timer);
  }

  cancelPendingRemoval(userId: UserId): boolean {
    const timer = this.#pendingRemoval.get(userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#pendingRemoval.delete(userId);
      return true;
    }
    return false;
  }

  destroy(): void {
    for (const timer of this.#pendingRemoval.values()) {
      clearTimeout(timer);
    }
    this.#pendingRemoval.clear();
    this.#users.clear();
    this.#socketToUser.clear();
    this.onUserRemoved = undefined;
  }
}
