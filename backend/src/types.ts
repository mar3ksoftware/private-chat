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
  readonly ciphertext: string;
  readonly iv: string;
  readonly timestamp: number;
};

export type MessageRejectedPayload = {
  readonly reason: string;
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
};

export type GroupInfo = {
  readonly groupId: GroupId;
  readonly name: string;
  readonly members: readonly GroupMember[];
  readonly createdBy: UserId;
  readonly createdAt: number;
};

export type GroupEncryptedPayload = {
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
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
  readonly timestamp: number;
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
} as const;

// ── Event name map ────────────────────────────────────────────────────

export const EVENTS = {
  CLIENT: {
    USER_JOIN: 'user:join',
    MESSAGE_SEND: 'message:send',
    E2EE_PUBLIC_KEY: 'e2ee:public_key',
    USER_REGISTER: 'user:register',
    USER_LOGIN: 'user:login',
    GROUP_CREATE: 'group:create',
    GROUP_MESSAGE_SEND: 'group:message:send',
  },
  SERVER: {
    USER_JOINED: 'user:joined',
    USER_LEFT: 'user:left',
    PRIVATE_MESSAGE: 'private_message',
    E2EE_PUBLIC_KEY: 'e2ee:public_key',
    DELIVERY_FAILED: 'delivery_failed',
    MESSAGE_REJECTED: 'message_rejected',
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
};

// ── Utility ───────────────────────────────────────────────────────────

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
