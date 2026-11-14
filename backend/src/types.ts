// ── Branded primitives ────────────────────────────────────────────────

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type SocketId = Brand<string, 'SocketId'>;

export function UserId(value: string): UserId {
  return value as UserId;
}
export function SocketId(value: string): SocketId {
  return value as SocketId;
}

export type PasswordHash = Brand<string, 'PasswordHash'>;
export type PinHash = Brand<string, 'PinHash'>;
export type GroupId = Brand<string, 'GroupId'>;

export function GroupId(value: string): GroupId {
  return value as GroupId;
}

// ── Domain types ──────────────────────────────────────────────────────

export type UserInfo = {
  readonly userId: UserId;
  readonly username: string;
  readonly socketId: SocketId;
  readonly joinedAt: number;
  // Profile fields are stamped on at emit time from the in-memory store.
  readonly displayName?: string;
  readonly status?: string;
};

export type Account = {
  readonly userId: UserId;
  readonly username: string;
  readonly passwordHash: PasswordHash;
  readonly pinHash: PinHash | undefined;
  readonly createdAt: number;
};

export type SocketData = {
  readonly userId: UserId;
  readonly username: string;
  readonly authenticated: boolean;
};

// ── Payload types ─────────────────────────────────────────────────────

export type UserJoinPayload = {
  readonly username: string;
};

export type UserLeftPayload = {
  readonly userId: UserId;
  readonly username: string;
};

export type EncryptedMessagePayload = {
  readonly id: string;
  readonly to: string;
  readonly ciphertext: string;
  readonly iv: string;
};

export type E2eePublicKeyPayload = {
  readonly to: string;
  readonly publicKey: string;
};

export type E2eePublicKeyRelay = {
  readonly from: UserId;
  readonly fromUsername: string;
  readonly publicKey: string;
};

export type RegisterPayload = {
  readonly username: string;
  readonly password: string;
  readonly pin?: string;
};

export type LoginPayload = {
  readonly username: string;
  readonly password: string;
  readonly pin?: string;
};

export type PrivateMessage = {
  readonly from: UserId;
  readonly fromUsername: string;
  readonly to: UserId;
  readonly toUsername: string;
  readonly id: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly timestamp: number;
};

export type MessageRejectedPayload = {
  readonly reason: string;
};

export type MediaTokenPayload = {
  readonly token: string; // 64 lowercase hex chars (32 random bytes)
};

export type ErrorPayload = {
  readonly message: string;
};

export type GroupErrorPayload = {
  readonly message: string;
};

// ── Group types ──────────────────────────────────────────────────────

export type GroupMember = {
  readonly userId: UserId;
  readonly username: string;
  readonly isAdmin: boolean;
  // Profile fields are stamped on at emit time from the in-memory store.
  readonly displayName?: string;
  readonly status?: string;
};

export type GroupInfo = {
  readonly groupId: GroupId;
  readonly name: string;
  readonly members: readonly GroupMember[];
  readonly createdBy: UserId;
  readonly createdAt: number;
};

export type GroupEncryptedPayload = {
  readonly id: string;
  readonly groupId: string;
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
};

export type GroupMessage = {
  readonly groupId: string;
  readonly from: UserId;
  readonly fromUsername: string;
  readonly id: string;
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
  readonly timestamp: number;
};

export type GroupTargetPayload = {
  readonly groupId: string;
  readonly username: string;
};

export type GroupMemberRemovedPayload = {
  readonly groupId: string;
  readonly username: string;
  readonly reason: 'removed' | 'kicked';
};

export type KickTallyPayload = {
  readonly groupId: string;
  readonly username: string;
  readonly votes: readonly string[];
  readonly required: number;
  readonly status: 'active' | 'passed' | 'expired';
  readonly expiresAt: number;
};

// ── Tier-1 relay payloads ─────────────────────────────────────────────

export type TypingSendPayload = {
  readonly to?: string;
  readonly groupId?: string;
  readonly active: boolean;
};

export type ReceiptReadPayload = {
  readonly to: string;
  readonly upTo: number;
};

export type MessageReactPayload = {
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
  readonly emoji: string;
  readonly active: boolean;
};

export type MessageEditPayload = {
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
  readonly ciphertext: string;
  readonly iv: string;
};

export type MessageDeletePayload = {
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
};

export type PollVotePayload = {
  readonly pollId: string;
  readonly option: number;
  readonly to?: string;
  readonly groupId?: string;
};

export type PollClosePayload = {
  readonly pollId: string;
  readonly to?: string;
  readonly groupId?: string;
};

export type ProfileUpdatePayload = {
  readonly displayName: string;
  readonly status: string;
};

export type TypingChangedPayload = {
  readonly from: UserId;
  readonly fromUsername: string;
  readonly to?: string;
  readonly groupId?: string;
  readonly active: boolean;
};

export type ReceiptReadRelay = {
  readonly from: UserId;
  readonly fromUsername: string;
  readonly upTo: number;
};

export type MessageReactedPayload = {
  readonly from: UserId;
  readonly fromUsername: string;
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
  readonly emoji: string;
  readonly active: boolean;
  readonly timestamp: number;
};

export type MessageEditedPayload = {
  readonly from: UserId;
  readonly fromUsername: string;
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly timestamp: number;
};

export type MessageDeletedPayload = {
  readonly from: UserId;
  readonly fromUsername: string;
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
  readonly timestamp: number;
};

export type ProfileUpdatedPayload = {
  readonly username: string;
  readonly displayName: string;
  readonly status: string;
};

// Same fields as the send payload plus the acting username, mirroring how
// message:reacted carries the reactor.
export type PollVotedPayload = {
  readonly pollId: string;
  readonly option: number;
  readonly u: string;
  readonly to?: string;
  readonly groupId?: string;
};

export type PollClosedPayload = {
  readonly pollId: string;
  readonly u: string;
  readonly to?: string;
  readonly groupId?: string;
};

// ── Discriminated unions ──────────────────────────────────────────────

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly errors: readonly string[] };

export type RateLimitResult =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly retryAfterMs: number };

export type DeliveryResult =
  | { readonly delivered: true }
  | {
      readonly delivered: false;
      readonly reason: 'user_disconnected' | 'user_not_found';
      readonly to: string;
    };

export type DeliveryFailedPayload = Extract<DeliveryResult, { readonly delivered: false }>;

export type RegisterResult =
  | { readonly kind: 'register_success'; readonly userId: UserId; readonly username: string }
  | {
      readonly kind: 'register_error';
      readonly reason: 'username_taken' | 'validation_failed' | 'rate_limited' | 'internal_error';
    };

export type LoginResult =
  | { readonly kind: 'login_success'; readonly userId: UserId; readonly username: string }
  | {
      readonly kind: 'login_error';
      readonly reason:
        | 'invalid_credentials'
        | 'pin_required'
        | 'pin_invalid'
        | 'validation_failed'
        | 'rate_limited'
        | 'internal_error';
    };

// ── Constants ─────────────────────────────────────────────────────────

export const CONSTANTS = {
  MAX_MESSAGE_LENGTH: 5000,
  MAX_CIPHERTEXT_LENGTH: 30_000,
  MAX_IV_LENGTH: 64,
  MAX_PUBLIC_KEY_LENGTH: 4096,
  MAX_GROUP_CIPHERTEXTS: 100,
  USER_STALE_TIMEOUT_MS: 30_000,
  RATE_LIMIT_MAX: 10,
  RATE_LIMIT_WINDOW_MS: 1_000,
  MAX_USERNAME_LENGTH: 30,
  MIN_USERNAME_LENGTH: 1,
  DEFAULT_PORT: 3000,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  MIN_PIN_LENGTH: 4,
  MAX_PIN_LENGTH: 6,
  MAX_GROUP_NAME_LENGTH: 50,
  MAX_GROUP_MEMBERS: 50,
  KICK_VOTE_TTL_MS: 60_000,
  MAX_MEDIA_BYTES: 16 * 1024 * 1024,
  MAX_MEDIA_TOTAL_BYTES: 512 * 1024 * 1024,
  MAX_MEDIA_FILES: 1000,
  MEDIA_TTL_MS: 24 * 60 * 60 * 1000,
  MEDIA_SWEEP_INTERVAL_MS: 30_000,
  MEDIA_TOKEN_TTL_MS: 24 * 60 * 60 * 1000,
  MAX_EMOJI_LENGTH: 16,
  MAX_DISPLAY_NAME_LENGTH: 32,
  MAX_STATUS_LENGTH: 80,
  RECEIPT_UP_TO_FUTURE_MS: 60_000,
  TYPING_DEBOUNCE_MS: 3_000,
} as const;

// ── Event name map ────────────────────────────────────────────────────

export const EVENTS = {
  CLIENT: {
    USER_JOIN: 'user:join',
    MESSAGE_SEND: 'message:send',
    TYPING_SEND: 'typing:send',
    RECEIPT_READ: 'receipt:read',
    MESSAGE_REACT: 'message:react',
    MESSAGE_EDIT: 'message:edit',
    MESSAGE_DELETE: 'message:delete',
    POLL_VOTE: 'poll:vote',
    POLL_CLOSE: 'poll:close',
    PROFILE_UPDATE: 'profile:update',
    E2EE_PUBLIC_KEY: 'e2ee:public_key',
    USER_REGISTER: 'user:register',
    USER_LOGIN: 'user:login',
    GROUP_CREATE: 'group:create',
    GROUP_MEMBER_ADD: 'group:member:add',
    GROUP_MEMBER_REMOVE: 'group:member:remove',
    GROUP_KICK_VOTE: 'group:kick:vote',
    GROUP_MESSAGE_SEND: 'group:message:send',
  },
  SERVER: {
    USER_JOINED: 'user:joined',
    USER_LEFT: 'user:left',
    PRIVATE_MESSAGE: 'private_message',
    E2EE_PUBLIC_KEY: 'e2ee:public_key',
    DELIVERY_FAILED: 'delivery_failed',
    MESSAGE_REJECTED: 'message_rejected',
    TYPING_CHANGED: 'typing:changed',
    RECEIPT_READ: 'receipt:read',
    MESSAGE_REACTED: 'message:reacted',
    MESSAGE_EDITED: 'message:edited',
    MESSAGE_DELETED: 'message:deleted',
    POLL_VOTED: 'poll:voted',
    POLL_CLOSED: 'poll:closed',
    PROFILE_UPDATED: 'profile:updated',
    ACTIVE_USERS: 'active_users',
    ACTIVE_GROUPS: 'active_groups',
    ERROR: 'error',
    REGISTER_SUCCESS: 'register_success',
    REGISTER_ERROR: 'register_error',
    LOGIN_SUCCESS: 'login_success',
    LOGIN_ERROR: 'login_error',
    GROUP_CREATED: 'group:created',
    GROUP_CREATED_ERROR: 'group:created_error',
    GROUP_MESSAGE: 'group:message',
    GROUP_MESSAGE_DELIVERY_FAILED: 'group:message_delivery_failed',
    USERS_DIRECTORY: 'users:directory',
    GROUP_MEMBER_REMOVED: 'group:member:removed',
    GROUP_KICK_TALLY: 'group:kick:tally',
    MEDIA_TOKEN: 'media:token',
  },
} as const;

// ── Socket.io event type maps ─────────────────────────────────────────

export type ServerToClientEvents = {
  readonly [EVENTS.SERVER.USER_JOINED]: (user: UserInfo) => void;
  readonly [EVENTS.SERVER.USER_LEFT]: (payload: UserLeftPayload) => void;
  readonly [EVENTS.SERVER.PRIVATE_MESSAGE]: (message: PrivateMessage) => void;
  readonly [EVENTS.SERVER.E2EE_PUBLIC_KEY]: (relay: E2eePublicKeyRelay) => void;
  readonly [EVENTS.SERVER.DELIVERY_FAILED]: (result: DeliveryFailedPayload) => void;
  readonly [EVENTS.SERVER.MESSAGE_REJECTED]: (payload: MessageRejectedPayload) => void;
  readonly [EVENTS.SERVER.ACTIVE_USERS]: (users: readonly UserInfo[]) => void;
  readonly [EVENTS.SERVER.ACTIVE_GROUPS]: (groups: readonly GroupInfo[]) => void;
  readonly [EVENTS.SERVER.ERROR]: (payload: ErrorPayload) => void;
  readonly [EVENTS.SERVER.REGISTER_SUCCESS]: (
    result: Extract<RegisterResult, { readonly kind: 'register_success' }>,
  ) => void;
  readonly [EVENTS.SERVER.REGISTER_ERROR]: (
    result: Extract<RegisterResult, { readonly kind: 'register_error' }>,
  ) => void;
  readonly [EVENTS.SERVER.LOGIN_SUCCESS]: (
    result: Extract<LoginResult, { readonly kind: 'login_success' }>,
  ) => void;
  readonly [EVENTS.SERVER.LOGIN_ERROR]: (
    result: Extract<LoginResult, { readonly kind: 'login_error' }>,
  ) => void;
  readonly [EVENTS.SERVER.GROUP_CREATED]: (group: GroupInfo) => void;
  readonly [EVENTS.SERVER.GROUP_CREATED_ERROR]: (payload: GroupErrorPayload) => void;
  readonly [EVENTS.SERVER.GROUP_MESSAGE]: (message: GroupMessage) => void;
  readonly [EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED]: (payload: GroupErrorPayload) => void;
  readonly [EVENTS.SERVER.USERS_DIRECTORY]: (usernames: readonly string[]) => void;
  readonly [EVENTS.SERVER.GROUP_MEMBER_REMOVED]: (payload: GroupMemberRemovedPayload) => void;
  readonly [EVENTS.SERVER.GROUP_KICK_TALLY]: (payload: KickTallyPayload) => void;
  readonly [EVENTS.SERVER.MEDIA_TOKEN]: (payload: MediaTokenPayload) => void;
  readonly [EVENTS.SERVER.TYPING_CHANGED]: (payload: TypingChangedPayload) => void;
  readonly [EVENTS.SERVER.RECEIPT_READ]: (payload: ReceiptReadRelay) => void;
  readonly [EVENTS.SERVER.MESSAGE_REACTED]: (payload: MessageReactedPayload) => void;
  readonly [EVENTS.SERVER.MESSAGE_EDITED]: (payload: MessageEditedPayload) => void;
  readonly [EVENTS.SERVER.MESSAGE_DELETED]: (payload: MessageDeletedPayload) => void;
  readonly [EVENTS.SERVER.POLL_VOTED]: (payload: PollVotedPayload) => void;
  readonly [EVENTS.SERVER.POLL_CLOSED]: (payload: PollClosedPayload) => void;
  readonly [EVENTS.SERVER.PROFILE_UPDATED]: (payload: ProfileUpdatedPayload) => void;
};

export type ClientToServerEvents = {
  readonly [EVENTS.CLIENT.USER_JOIN]: (payload: UserJoinPayload) => void;
  readonly [EVENTS.CLIENT.MESSAGE_SEND]: (payload: EncryptedMessagePayload) => void;
  readonly [EVENTS.CLIENT.E2EE_PUBLIC_KEY]: (payload: E2eePublicKeyPayload) => void;
  readonly [EVENTS.CLIENT.USER_REGISTER]: (payload: RegisterPayload) => void;
  readonly [EVENTS.CLIENT.USER_LOGIN]: (payload: LoginPayload) => void;
  readonly [EVENTS.CLIENT.GROUP_CREATE]: (payload: {
    readonly name: string;
    readonly members: readonly string[];
  }) => void;
  readonly [EVENTS.CLIENT.GROUP_MESSAGE_SEND]: (payload: GroupEncryptedPayload) => void;
  readonly [EVENTS.CLIENT.GROUP_MEMBER_ADD]: (payload: GroupTargetPayload) => void;
  readonly [EVENTS.CLIENT.GROUP_MEMBER_REMOVE]: (payload: GroupTargetPayload) => void;
  readonly [EVENTS.CLIENT.GROUP_KICK_VOTE]: (payload: GroupTargetPayload) => void;
  readonly [EVENTS.CLIENT.TYPING_SEND]: (payload: TypingSendPayload) => void;
  readonly [EVENTS.CLIENT.RECEIPT_READ]: (payload: ReceiptReadPayload) => void;
  readonly [EVENTS.CLIENT.MESSAGE_REACT]: (payload: MessageReactPayload) => void;
  readonly [EVENTS.CLIENT.MESSAGE_EDIT]: (payload: MessageEditPayload) => void;
  readonly [EVENTS.CLIENT.MESSAGE_DELETE]: (payload: MessageDeletePayload) => void;
  readonly [EVENTS.CLIENT.POLL_VOTE]: (payload: PollVotePayload) => void;
  readonly [EVENTS.CLIENT.POLL_CLOSE]: (payload: PollClosePayload) => void;
  readonly [EVENTS.CLIENT.PROFILE_UPDATE]: (payload: ProfileUpdatePayload) => void;
};

// ── Utility ───────────────────────────────────────────────────────────

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
