// ── Domain types ──

export type UserInfo = {
  readonly userId: string;
  readonly username: string;
  readonly socketId: string;
  readonly joinedAt: number;
  // Profile fields are stamped on by the server from its in-memory store.
  readonly displayName?: string;
  readonly status?: string;
};

// ── Payload types ──

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

export type PrivateMessage = {
  readonly from: string;
  readonly fromUsername: string;
  readonly to: string;
  readonly toUsername: string;
  readonly id: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly timestamp: number;
};

// Reply reference carried inside a v2 text envelope (C4).
export type ReplyRef = {
  readonly id: string;
  readonly u: string;
  readonly e: string;
};

// Envelope v2: plaintext of newly sent text messages is discriminated JSON.
export type TextEnvelope = {
  readonly t: 'text';
  readonly b: string;
  readonly r?: ReplyRef;
};

// Poll definition carried inside the E2EE plaintext (B1) — the server only
// ever relays the ciphertext, never the question or options.
export type PollEnvelope = {
  readonly t: 'poll';
  readonly q: string;
  readonly o: readonly string[];
};

// Decrypted poll definition attached to a message for the UI.
export type PollDefinition = {
  readonly question: string;
  readonly options: readonly string[];
};

// Result of the ordered envelope parse (C3): media → text → poll → legacy raw.
export type ParsedEnvelope =
  | { readonly kind: 'media'; readonly descriptor: MediaDescriptor }
  | { readonly kind: 'text'; readonly body: string; readonly reply: ReplyRef | null }
  | { readonly kind: 'poll'; readonly poll: PollDefinition }
  | { readonly kind: 'raw'; readonly text: string };

// Decrypted view of a PrivateMessage (what the UI renders)
export type DecryptedMessage = {
  readonly id: string;
  readonly from: string;
  readonly fromUsername: string;
  readonly to: string;
  readonly toUsername: string;
  readonly plaintext: string;
  // Envelope-unwrapped body; '' for media and failed decryptions.
  readonly body: string;
  readonly reply: ReplyRef | null;
  readonly edited: boolean;
  readonly deleted: boolean;
  readonly timestamp: number;
  readonly isOwn: boolean;
  readonly decryptionFailed: boolean;
  readonly media: MediaDescriptor | null;
  readonly poll: PollDefinition | null;
};

// ── Media types ──

export type MediaTokenPayload = {
  readonly token: string;
};

// Descriptor carried inside the E2EE plaintext of a media message (A.2).
export type MediaDescriptor = {
  readonly t: 'media';
  readonly v: 1;
  readonly fileId: string;
  readonly key: string;
  readonly iv: string;
  readonly sha256: string;
  readonly mime: string;
  readonly size: number;
  readonly w?: number;
  readonly h?: number;
  readonly name?: string;
  // Voice duration in seconds; present only when 0 < d <= 300 (B2).
  readonly d?: number;
};

// ── Group types ──

export type GroupMember = {
  readonly userId: string;
  readonly username: string;
  readonly isAdmin: boolean;
  // Profile fields are stamped on by the server from its in-memory store.
  readonly displayName?: string;
  readonly status?: string;
};

export type GroupInfo = {
  readonly groupId: string;
  readonly name: string;
  readonly members: readonly GroupMember[];
  readonly createdBy: string;
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
  readonly from: string;
  readonly fromUsername: string;
  readonly id: string;
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
  readonly timestamp: number;
};

export type DecryptedGroupMessage = {
  readonly id: string;
  readonly groupId: string;
  readonly from: string;
  readonly fromUsername: string;
  readonly plaintext: string;
  readonly body: string;
  readonly reply: ReplyRef | null;
  readonly edited: boolean;
  readonly deleted: boolean;
  readonly timestamp: number;
  readonly isOwn: boolean;
  readonly decryptionFailed: boolean;
  readonly media: MediaDescriptor | null;
  readonly poll: PollDefinition | null;
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

export type KickTally = {
  readonly groupId: string;
  readonly username: string;
  readonly votes: readonly string[];
  readonly required: number;
  readonly status: 'active' | 'passed' | 'expired';
  readonly expiresAt: number;
};

// ── Tier-1 relay payloads ──
// Mirrors backend/src/types.ts one-for-one (spec B).

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

export type ProfileUpdatePayload = {
  readonly displayName: string;
  readonly status: string;
};

export type TypingChangedPayload = {
  readonly from: string;
  readonly fromUsername: string;
  readonly to?: string;
  readonly groupId?: string;
  readonly active: boolean;
};

export type ReceiptReadRelay = {
  readonly from: string;
  readonly fromUsername: string;
  readonly upTo: number;
};

export type MessageReactedPayload = {
  readonly from: string;
  readonly fromUsername: string;
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
  readonly emoji: string;
  readonly active: boolean;
  readonly timestamp: number;
};

export type MessageEditedPayload = {
  readonly from: string;
  readonly fromUsername: string;
  readonly to?: string;
  readonly groupId?: string;
  readonly targetId: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly timestamp: number;
};

export type MessageDeletedPayload = {
  readonly from: string;
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

// ── Poll relay payloads ──
// Mirrors backend/src/types.ts one-for-one (spec B3).

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

// ── Client-side poll state ──

// pollId → voter username → chosen option index (last write wins), plus the
// closed flag applied optimistically or from `poll:closed` (C3/C4).
export type PollState = {
  readonly tallies: Readonly<Record<string, number>>;
  readonly closed: boolean;
};

// ── Client-side tier-1 state shapes ──

// A conversation as addressed by client features (typing, reactions, unread).
export type ConversationTarget =
  | { readonly kind: 'dm'; readonly username: string }
  | { readonly kind: 'group'; readonly groupId: string };

// targetId → emoji → usernames of reactors.
export type ReactionAgg = Readonly<Record<string, readonly string[]>>;

export type UnreadEntry = {
  readonly count: number;
  readonly mention: boolean;
};

export type ProfileEntry = {
  readonly displayName: string;
  readonly status: string;
};

// Fixed quick-picker set — order is part of the contract (C5).
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'] as const;

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
  MAX_MEDIA_BYTES: 16 * 1024 * 1024,
  MAX_DISPLAY_NAME_LENGTH: 32,
  MAX_STATUS_LENGTH: 80,
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
  'group:member:add': (payload: GroupTargetPayload) => void;
  'group:member:remove': (payload: GroupTargetPayload) => void;
  'group:kick:vote': (payload: GroupTargetPayload) => void;
  'typing:send': (payload: TypingSendPayload) => void;
  'receipt:read': (payload: ReceiptReadPayload) => void;
  'message:react': (payload: MessageReactPayload) => void;
  'message:edit': (payload: MessageEditPayload) => void;
  'message:delete': (payload: MessageDeletePayload) => void;
  'poll:vote': (payload: PollVotePayload) => void;
  'poll:close': (payload: PollClosePayload) => void;
  'profile:update': (payload: ProfileUpdatePayload) => void;
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
  'users:directory': (usernames: readonly string[]) => void;
  'group:member:removed': (payload: GroupMemberRemovedPayload) => void;
  'group:kick:tally': (payload: KickTally) => void;
  'media:token': (payload: MediaTokenPayload) => void;
  'typing:changed': (payload: TypingChangedPayload) => void;
  'receipt:read': (payload: ReceiptReadRelay) => void;
  'message:reacted': (payload: MessageReactedPayload) => void;
  'message:edited': (payload: MessageEditedPayload) => void;
  'message:deleted': (payload: MessageDeletedPayload) => void;
  'poll:voted': (payload: PollVotedPayload) => void;
  'poll:closed': (payload: PollClosedPayload) => void;
  'profile:updated': (payload: ProfileUpdatedPayload) => void;
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
    GROUP_MEMBER_ADD: 'group:member:add',
    GROUP_MEMBER_REMOVE: 'group:member:remove',
    GROUP_KICK_VOTE: 'group:kick:vote',
    TYPING_SEND: 'typing:send',
    RECEIPT_READ: 'receipt:read',
    MESSAGE_REACT: 'message:react',
    MESSAGE_EDIT: 'message:edit',
    MESSAGE_DELETE: 'message:delete',
    POLL_VOTE: 'poll:vote',
    POLL_CLOSE: 'poll:close',
    PROFILE_UPDATE: 'profile:update',
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
    USERS_DIRECTORY: 'users:directory',
    GROUP_MEMBER_REMOVED: 'group:member:removed',
    GROUP_KICK_TALLY: 'group:kick:tally',
    MEDIA_TOKEN: 'media:token',
    TYPING_CHANGED: 'typing:changed',
    RECEIPT_READ: 'receipt:read',
    MESSAGE_REACTED: 'message:reacted',
    MESSAGE_EDITED: 'message:edited',
    MESSAGE_DELETED: 'message:deleted',
    POLL_VOTED: 'poll:voted',
    POLL_CLOSED: 'poll:closed',
    PROFILE_UPDATED: 'profile:updated',
  },
} as const;
