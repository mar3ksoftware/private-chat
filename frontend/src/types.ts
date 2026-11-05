// ── Domain types ──

export type UserInfo = {
  readonly userId: string;
  readonly username: string;
  readonly socketId: string;
  readonly joinedAt: number;
};

// ── Payload types ──

export type EncryptedMessagePayload = {
  readonly to: string;
  readonly ciphertext: string;
  readonly iv: string;
};

export type E2eePublicKeyPayload = {
  readonly to: string;
  readonly publicKey: string;
};

export type PrivateMessage = {
  readonly from: string;
  readonly fromUsername: string;
  readonly to: string;
  readonly toUsername: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly timestamp: number;
};

// Decrypted view of a PrivateMessage (what the UI renders)
export type DecryptedMessage = {
  readonly from: string;
  readonly fromUsername: string;
  readonly to: string;
  readonly toUsername: string;
  readonly plaintext: string;
  readonly timestamp: number;
  readonly isOwn: boolean;
  readonly decryptionFailed: boolean;
};

// ── Group types ──

export type GroupMember = {
  readonly userId: string;
  readonly username: string;
  readonly isAdmin: boolean;
};

export type GroupInfo = {
  readonly groupId: string;
  readonly name: string;
  readonly members: readonly GroupMember[];
  readonly createdBy: string;
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
  readonly from: string;
  readonly fromUsername: string;
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
  readonly timestamp: number;
};

export type DecryptedGroupMessage = {
  readonly groupId: string;
  readonly from: string;
  readonly fromUsername: string;
  readonly plaintext: string;
  readonly timestamp: number;
  readonly isOwn: boolean;
  readonly decryptionFailed: boolean;
};

// ── Auth payloads ──

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

// ── Result types (discriminated unions) ──

export type RegisterResult =
  | { readonly kind: 'register_success'; readonly userId: string; readonly username: string }
  | { readonly kind: 'register_error'; readonly reason: string };

export type LoginResult =
  | { readonly kind: 'login_success'; readonly userId: string; readonly username: string }
  | { readonly kind: 'login_error'; readonly reason: string };

export type DeliveryResult =
  | { readonly delivered: true }
  | {
      readonly delivered: false;
      readonly reason: 'user_disconnected' | 'user_not_found';
      readonly to: string;
    };

// ── E2EE relay ──

export type E2eePublicKeyRelay = {
  readonly from: string;
  readonly fromUsername: string;
  readonly publicKey: string;
};

// ── Constants ──

export const CONSTANTS = {
  MAX_MESSAGE_LENGTH: 5000,
  MAX_USERNAME_LENGTH: 30,
  MIN_USERNAME_LENGTH: 1,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  MIN_PIN_LENGTH: 4,
  MAX_PIN_LENGTH: 6,
  RATE_LIMIT_MAX: 10,
} as const;

// ── Socket event maps ──

export type ClientToServerEvents = {
  'user:join': (payload: { readonly username: string }) => void;
  'user:register': (payload: RegisterPayload) => void;
  'user:login': (payload: LoginPayload) => void;
  'message:send': (payload: EncryptedMessagePayload) => void;
  'e2ee:public_key': (payload: E2eePublicKeyPayload) => void;
  'group:create': (payload: { readonly name: string; readonly members: readonly string[] }) => void;
  'group:message:send': (payload: GroupEncryptedPayload) => void;
};

export type ServerToClientEvents = {
  'user:joined': (payload: UserInfo) => void;
  'user:left': (payload: { readonly userId: string; readonly username: string }) => void;
  private_message: (payload: PrivateMessage) => void;
  delivery_failed: (payload: DeliveryResult) => void;
  message_rejected: (payload: { readonly reason: string }) => void;
  active_users: (payload: readonly UserInfo[]) => void;
  active_groups: (payload: readonly GroupInfo[]) => void;
  error: (payload: { readonly message: string }) => void;
  register_success: (payload: RegisterResult) => void;
  register_error: (payload: RegisterResult) => void;
  login_success: (payload: LoginResult) => void;
  login_error: (payload: LoginResult) => void;
  'e2ee:public_key': (payload: E2eePublicKeyRelay) => void;
  'group:created': (payload: GroupInfo) => void;
  'group:created_error': (payload: { readonly message: string }) => void;
  'group:message': (payload: GroupMessage) => void;
  'group:message_delivery_failed': (payload: { readonly message: string }) => void;
};

// ── Event name map ──

export const EVENTS = {
  CLIENT: {
    USER_JOIN: 'user:join',
    MESSAGE_SEND: 'message:send',
    USER_REGISTER: 'user:register',
    USER_LOGIN: 'user:login',
    E2EE_PUBLIC_KEY: 'e2ee:public_key',
    GROUP_CREATE: 'group:create',
    GROUP_MESSAGE_SEND: 'group:message:send',
  },
  SERVER: {
    USER_JOINED: 'user:joined',
    USER_LEFT: 'user:left',
    PRIVATE_MESSAGE: 'private_message',
    DELIVERY_FAILED: 'delivery_failed',
    MESSAGE_REJECTED: 'message_rejected',
    ACTIVE_USERS: 'active_users',
    ACTIVE_GROUPS: 'active_groups',
    ERROR: 'error',
    REGISTER_SUCCESS: 'register_success',
    REGISTER_ERROR: 'register_error',
    LOGIN_SUCCESS: 'login_success',
    LOGIN_ERROR: 'login_error',
    E2EE_PUBLIC_KEY: 'e2ee:public_key',
    GROUP_CREATED: 'group:created',
    GROUP_CREATED_ERROR: 'group:created_error',
    GROUP_MESSAGE: 'group:message',
    GROUP_MESSAGE_DELIVERY_FAILED: 'group:message_delivery_failed',
  },
} as const;
