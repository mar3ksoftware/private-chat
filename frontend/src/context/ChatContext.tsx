import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { E2eeSession } from '../lib/e2ee-session';
import { parseEnvelope, wrapPollEnvelope, wrapTextEnvelope } from '../lib/envelope';
import { clearMediaCache, MediaError, prepareAndUpload } from '../lib/media';
import { mentionsMe } from '../lib/mentions';
import { validateProfile } from '../lib/profile';
import { getSocket } from '../lib/socket';
import type {
  ConversationTarget,
  DecryptedGroupMessage,
  DecryptedMessage,
  GroupInfo,
  KickTally,
  LoginPayload,
  PollState,
  PrivateMessage,
  ProfileEntry,
  ReactionAgg,
  ReplyRef,
  UnreadEntry,
  UserInfo,
} from '../types';
import { EVENTS } from '../types';

// Client re-sends typing:send at this cadence while a burst is live; the
// backend debounces duplicates per (sender, target, active) within 3 s.
const TYPING_REPEAT_MS = 4_000;
// Receiver-side auto-hide: an indicator disappears even if active:false is lost.
const TYPING_HIDE_MS = 6_000;
// Optimistic ops roll back only if their rejection lands within this window.
const PENDING_OP_TTL_MS = 5_000;

const noopOp = () => {};

type ChatState = {
  readonly user: null | {
    readonly userId: string;
    readonly username: string;
    readonly isGuest: boolean;
  };
  readonly users: readonly UserInfo[];
  readonly messages: readonly DecryptedMessage[];
  readonly groups: readonly GroupInfo[];
  readonly groupMessages: readonly DecryptedGroupMessage[];
  readonly directory: readonly string[];
  readonly kickTallies: readonly KickTally[];
  readonly connectionStatus: 'connecting' | 'connected' | 'disconnected';
  readonly error: string | null;
  readonly openConversation: ConversationTarget | null;
  readonly unread: Readonly<Record<string, UnreadEntry>>;
  readonly reactions: Readonly<Record<string, ReactionAgg>>;
  // DM peer → highest receipt:read upTo we received from them.
  readonly readUpTo: Readonly<Record<string, number>>;
  // Conversation-scoped typing keys → expiry timestamp of the last active flag.
  readonly typing: Readonly<Record<string, number>>;
  readonly profiles: Readonly<Record<string, ProfileEntry>>;
  // pollId → tallies + closed flag; polls live only in ciphertext (B3).
  readonly polls: Readonly<Record<string, PollState>>;
};

const initialState: ChatState = {
  user: null,
  users: [],
  messages: [],
  groups: [],
  groupMessages: [],
  directory: [],
  kickTallies: [],
  connectionStatus: 'connecting',
  error: null,
  openConversation: null,
  unread: {},
  reactions: {},
  readUpTo: {},
  typing: {},
  profiles: {},
  polls: {},
};

type ChatAction =
  | {
      type: 'SET_USER';
      payload: { readonly userId: string; readonly username: string; readonly isGuest: boolean };
    }
  | { type: 'LOGOUT' }
  | { type: 'SET_USERS'; payload: readonly UserInfo[] }
  | { type: 'ADD_USER'; payload: UserInfo }
  | { type: 'REMOVE_USER'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: DecryptedMessage }
  | { type: 'SET_GROUPS'; payload: readonly GroupInfo[] }
  | { type: 'ADD_GROUP'; payload: GroupInfo }
  | { type: 'REMOVE_GROUP'; payload: string }
  | { type: 'ADD_GROUP_MESSAGE'; payload: DecryptedGroupMessage }
  | { type: 'SET_DIRECTORY'; payload: readonly string[] }
  | { type: 'ADD_DIRECTORY_USER'; payload: string }
  | { type: 'SET_KICK_TALLIES'; payload: readonly KickTally[] }
  | { type: 'UPSERT_KICK_TALLY'; payload: KickTally }
  | {
      type: 'SET_CONNECTION_STATUS';
      payload: 'connecting' | 'connected' | 'disconnected';
    }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'OPEN_CONVERSATION'; payload: ConversationTarget | null }
  | { type: 'CLEAR_UNREAD'; payload: string }
  | { type: 'INCREMENT_UNREAD'; payload: { readonly key: string; readonly mention: boolean } }
  | {
      type: 'SET_REACTION';
      payload: {
        readonly targetId: string;
        readonly emoji: string;
        readonly username: string;
        readonly active: boolean;
      };
    }
  | { type: 'SET_READ'; payload: { readonly peer: string; readonly upTo: number } }
  | { type: 'SET_TYPING'; payload: { readonly key: string; readonly expiresAt: number } }
  | { type: 'CLEAR_TYPING_KEY'; payload: string }
  | { type: 'CLEAR_TYPING' }
  | {
      type: 'SET_PROFILE';
      payload: { readonly username: string; readonly displayName: string; readonly status: string };
    }
  | {
      type: 'SET_PROFILES';
      payload: readonly {
        readonly username: string;
        readonly displayName: string;
        readonly status: string;
      }[];
    }
  | {
      type: 'EDIT_MESSAGE';
      payload: {
        readonly targetId: string;
        readonly body: string;
        readonly reply: ReplyRef | null;
        readonly edited: boolean;
      };
    }
  | { type: 'DELETE_MESSAGE'; payload: { readonly targetId: string; readonly deleted: boolean } }
  | {
      type: 'SET_POLL_VOTE';
      payload: {
        readonly pollId: string;
        readonly username: string;
        readonly option: number | null;
      };
    }
  | {
      type: 'SET_POLL_CLOSED';
      payload: { readonly pollId: string; readonly closed: boolean };
    };

function unreadKeyFor(target: ConversationTarget): string {
  return target.kind === 'dm' ? `dm:${target.username}` : `group:${target.groupId}`;
}

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, user: action.payload };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        users: [],
        messages: [],
        groups: [],
        groupMessages: [],
        directory: [],
        kickTallies: [],
        error: null,
        openConversation: null,
        unread: {},
        reactions: {},
        readUpTo: {},
        typing: {},
        profiles: {},
        polls: {},
      };
    case 'SET_USERS':
      return { ...state, users: action.payload };
    case 'ADD_USER': {
      // `user:joined` is re-emitted on reconnect, so upsert instead of append.
      const index = state.users.findIndex((u) => u.userId === action.payload.userId);
      if (index === -1) {
        return { ...state, users: [...state.users, action.payload] };
      }
      const users = state.users.slice();
      users[index] = action.payload;
      return { ...state, users };
    }
    case 'REMOVE_USER':
      return { ...state, users: state.users.filter((u) => u.userId !== action.payload) };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'SET_GROUPS':
      return { ...state, groups: action.payload };
    case 'ADD_GROUP': {
      // Full group state — re-sent on create and every membership change; replace on same id.
      const index = state.groups.findIndex((g) => g.groupId === action.payload.groupId);
      if (index === -1) {
        return { ...state, groups: [...state.groups, action.payload] };
      }
      const groups = state.groups.slice();
      groups[index] = action.payload;
      return { ...state, groups };
    }
    case 'REMOVE_GROUP':
      return { ...state, groups: state.groups.filter((g) => g.groupId !== action.payload) };
    case 'SET_DIRECTORY':
      return { ...state, directory: action.payload };
    case 'ADD_DIRECTORY_USER':
      if (state.directory.includes(action.payload)) {
        return state;
      }
      return { ...state, directory: [...state.directory, action.payload] };
    case 'SET_KICK_TALLIES':
      return { ...state, kickTallies: action.payload };
    case 'UPSERT_KICK_TALLY': {
      const index = state.kickTallies.findIndex((t) => t.groupId === action.payload.groupId);
      if (index === -1) {
        return { ...state, kickTallies: [...state.kickTallies, action.payload] };
      }
      const kickTallies = state.kickTallies.slice();
      kickTallies[index] = action.payload;
      return { ...state, kickTallies };
    }
    case 'ADD_GROUP_MESSAGE':
      return { ...state, groupMessages: [...state.groupMessages, action.payload] };
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'OPEN_CONVERSATION': {
      const target = action.payload;
      if (target === null) return { ...state, openConversation: null };
      const key = unreadKeyFor(target);
      const previous = state.unread[key];
      return {
        ...state,
        openConversation: target,
        unread:
          previous === undefined
            ? state.unread
            : { ...state.unread, [key]: { count: 0, mention: false } },
      };
    }
    case 'CLEAR_UNREAD': {
      const previous = state.unread[action.payload];
      if (previous === undefined || (previous.count === 0 && !previous.mention)) return state;
      return {
        ...state,
        unread: { ...state.unread, [action.payload]: { count: 0, mention: false } },
      };
    }
    case 'INCREMENT_UNREAD': {
      const previous = state.unread[action.payload.key] ?? { count: 0, mention: false };
      return {
        ...state,
        unread: {
          ...state.unread,
          [action.payload.key]: {
            count: previous.count + 1,
            mention: previous.mention || action.payload.mention,
          },
        },
      };
    }
    case 'SET_REACTION': {
      const { targetId, emoji, username, active } = action.payload;
      const merged: Record<string, readonly string[]> = {};
      for (const [key, value] of Object.entries(state.reactions[targetId] ?? {})) {
        if (key !== emoji) merged[key] = value;
      }
      const reactors = new Set(merged[emoji] ?? []);
      if (active) reactors.add(username);
      else reactors.delete(username);
      if (reactors.size > 0) merged[emoji] = Array.from(reactors);
      return { ...state, reactions: { ...state.reactions, [targetId]: merged } };
    }
    case 'SET_READ': {
      const previous = state.readUpTo[action.payload.peer] ?? 0;
      if (action.payload.upTo <= previous) return state;
      return {
        ...state,
        readUpTo: { ...state.readUpTo, [action.payload.peer]: action.payload.upTo },
      };
    }
    case 'SET_TYPING':
      return {
        ...state,
        typing: { ...state.typing, [action.payload.key]: action.payload.expiresAt },
      };
    case 'CLEAR_TYPING_KEY': {
      if (!(action.payload in state.typing)) return state;
      const typing: Record<string, number> = {};
      for (const [key, expiresAt] of Object.entries(state.typing)) {
        if (key !== action.payload) typing[key] = expiresAt;
      }
      return { ...state, typing };
    }
    case 'CLEAR_TYPING':
      if (Object.keys(state.typing).length === 0) return state;
      return { ...state, typing: {} };
    case 'SET_PROFILE':
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [action.payload.username]: {
            displayName: action.payload.displayName,
            status: action.payload.status,
          },
        },
      };
    case 'SET_PROFILES': {
      const profiles = { ...state.profiles };
      for (const entry of action.payload) {
        profiles[entry.username] = { displayName: entry.displayName, status: entry.status };
      }
      return { ...state, profiles };
    }
    case 'EDIT_MESSAGE': {
      const { targetId, body, reply, edited } = action.payload;
      const applyToMessage = (message: DecryptedMessage): DecryptedMessage =>
        message.id === targetId ? { ...message, body, reply, edited } : message;
      const applyToGroupMessage = (message: DecryptedGroupMessage): DecryptedGroupMessage =>
        message.id === targetId ? { ...message, body, reply, edited } : message;
      return {
        ...state,
        messages: state.messages.map(applyToMessage),
        groupMessages: state.groupMessages.map(applyToGroupMessage),
      };
    }
    case 'DELETE_MESSAGE': {
      const { targetId, deleted } = action.payload;
      const applyToMessage = (message: DecryptedMessage): DecryptedMessage =>
        message.id === targetId ? { ...message, deleted } : message;
      const applyToGroupMessage = (message: DecryptedGroupMessage): DecryptedGroupMessage =>
        message.id === targetId ? { ...message, deleted } : message;
      return {
        ...state,
        messages: state.messages.map(applyToMessage),
        groupMessages: state.groupMessages.map(applyToGroupMessage),
      };
    }
    case 'SET_POLL_VOTE': {
      const { pollId, username, option } = action.payload;
      const existing = state.polls[pollId];
      const tallies: Record<string, number> = { ...(existing?.tallies ?? {}) };
      if (option === null) {
        // Rollback of an optimistic vote that never had a prior choice.
        if (!(username in tallies)) return state;
        delete tallies[username];
      } else {
        // Last write wins: a later vote replaces the same voter's earlier one.
        tallies[username] = option;
      }
      return {
        ...state,
        polls: { ...state.polls, [pollId]: { tallies, closed: existing?.closed ?? false } },
      };
    }
    case 'SET_POLL_CLOSED': {
      const { pollId, closed } = action.payload;
      const existing = state.polls[pollId];
      if ((existing?.closed ?? false) === closed) return state;
      return {
        ...state,
        polls: {
          ...state.polls,
          [pollId]: { tallies: existing?.tallies ?? {}, closed },
        },
      };
    }
    default:
      return state;
  }
}

// ── Envelope-unwrapping message builders ────────────────────────────────

function bodyOfPlaintext(
  plaintext: string,
  decryptionFailed: boolean,
): {
  readonly body: string;
  readonly reply: ReplyRef | null;
  readonly media: DecryptedMessage['media'];
  readonly poll: DecryptedMessage['poll'];
} {
  // Poll questions stay out of `body` on purpose: unread/mention parsing
  // never sees them (C5), and the reply excerpt reads `poll.question`.
  if (decryptionFailed) return { body: '', reply: null, media: null, poll: null };
  const parsed = parseEnvelope(plaintext);
  if (parsed.kind === 'media')
    return { body: '', reply: null, media: parsed.descriptor, poll: null };
  if (parsed.kind === 'text')
    return { body: parsed.body, reply: parsed.reply, media: null, poll: null };
  if (parsed.kind === 'poll') return { body: '', reply: null, media: null, poll: parsed.poll };
  return { body: parsed.text, reply: null, media: null, poll: null };
}

function buildDecryptedMessage(
  msg: PrivateMessage,
  plaintext: string,
  decryptionFailed: boolean,
  isOwn: boolean,
): DecryptedMessage {
  const unwrapped = bodyOfPlaintext(plaintext, decryptionFailed);
  return {
    id: msg.id,
    from: msg.from,
    fromUsername: msg.fromUsername,
    to: msg.to,
    toUsername: msg.toUsername,
    plaintext,
    body: unwrapped.body,
    reply: unwrapped.reply,
    edited: false,
    deleted: false,
    timestamp: msg.timestamp,
    isOwn,
    decryptionFailed,
    media: unwrapped.media,
    poll: unwrapped.poll,
  };
}

function buildDecryptedGroupMessage(
  msg: {
    readonly groupId: string;
    readonly from: string;
    readonly fromUsername: string;
    readonly id: string;
    readonly timestamp: number;
  },
  plaintext: string,
  decryptionFailed: boolean,
  isOwn: boolean,
): DecryptedGroupMessage {
  const unwrapped = bodyOfPlaintext(plaintext, decryptionFailed);
  return {
    id: msg.id,
    groupId: msg.groupId,
    from: msg.from,
    fromUsername: msg.fromUsername,
    plaintext,
    body: unwrapped.body,
    reply: unwrapped.reply,
    edited: false,
    deleted: false,
    timestamp: msg.timestamp,
    isOwn,
    decryptionFailed,
    media: unwrapped.media,
    poll: unwrapped.poll,
  };
}

// ── Shared helpers ──────────────────────────────────────────────────────

function scopePayload(
  target: ConversationTarget,
): { readonly to: string } | { readonly groupId: string } {
  return target.kind === 'dm' ? { to: target.username } : { groupId: target.groupId };
}

function sameConversation(a: ConversationTarget, b: ConversationTarget): boolean {
  if (a.kind === 'dm' && b.kind === 'dm') return a.username === b.username;
  if (a.kind === 'group' && b.kind === 'group') return a.groupId === b.groupId;
  return false;
}

function appIsFocused(): boolean {
  return document.hasFocus() && document.visibilityState === 'visible';
}

type StoredCredentials =
  | {
      readonly mode: 'login';
      readonly username: string;
      readonly password: string;
      readonly pin?: string;
    }
  | { readonly mode: 'guest'; readonly username: string };

type LoginCredentials = Extract<StoredCredentials, { readonly mode: 'login' }>;

function buildLoginPayload(credentials: LoginCredentials): LoginPayload {
  return credentials.pin !== undefined && credentials.pin.length > 0
    ? {
        username: credentials.username,
        password: credentials.password,
        pin: credentials.pin,
      }
    : { username: credentials.username, password: credentials.password };
}

export type ChatContextValue = {
  readonly user: null | {
    readonly userId: string;
    readonly username: string;
    readonly isGuest: boolean;
  };
  readonly login: (username: string, password: string, pin?: string) => void;
  readonly register: (username: string, password: string, pin?: string) => void;
  readonly joinAsGuest: (username: string) => void;
  readonly logout: () => void;
  readonly users: readonly UserInfo[];
  readonly messages: readonly DecryptedMessage[];
  readonly sendMessage: (
    toUsername: string,
    body: string,
    reply?: ReplyRef | null,
  ) => Promise<boolean>;
  readonly sendMediaMessage: (
    toUsername: string,
    file: File,
    durationSeconds?: number,
  ) => Promise<boolean>;
  readonly sendPollMessage: (
    toUsername: string,
    question: string,
    options: readonly string[],
  ) => Promise<boolean>;
  readonly groups: readonly GroupInfo[];
  readonly groupMessages: readonly DecryptedGroupMessage[];
  readonly directory: readonly string[];
  readonly kickTallies: readonly KickTally[];
  readonly createGroup: (name: string, members: readonly string[]) => void;
  readonly sendGroupMessage: (
    groupId: string,
    body: string,
    reply?: ReplyRef | null,
  ) => Promise<boolean>;
  readonly sendGroupMediaMessage: (
    groupId: string,
    file: File,
    durationSeconds?: number,
  ) => Promise<boolean>;
  readonly sendGroupPollMessage: (
    groupId: string,
    question: string,
    options: readonly string[],
  ) => Promise<boolean>;
  readonly mediaToken: string | null;
  readonly addMember: (groupId: string, username: string) => void;
  readonly removeMember: (groupId: string, username: string) => void;
  readonly voteKick: (groupId: string, username: string) => void;
  readonly connectionStatus: 'connecting' | 'connected' | 'disconnected';
  readonly error: string | null;
  // ── Tier-1 features ──
  readonly unread: Readonly<Record<string, UnreadEntry>>;
  readonly reactions: Readonly<Record<string, ReactionAgg>>;
  readonly readUpTo: Readonly<Record<string, number>>;
  readonly typing: Readonly<Record<string, number>>;
  readonly profiles: Readonly<Record<string, ProfileEntry>>;
  readonly displayNameOf: (username: string) => string;
  readonly setOpenConversation: (target: ConversationTarget | null) => void;
  readonly sendTyping: (target: ConversationTarget) => void;
  readonly stopTyping: () => void;
  readonly toggleReaction: (target: ConversationTarget, targetId: string, emoji: string) => void;
  readonly editMessage: (
    target: ConversationTarget,
    targetId: string,
    body: string,
    reply: ReplyRef | null,
  ) => Promise<boolean>;
  readonly deleteMessage: (target: ConversationTarget, targetId: string) => void;
  readonly polls: Readonly<Record<string, PollState>>;
  readonly votePoll: (target: ConversationTarget, pollId: string, option: number) => void;
  readonly closePoll: (target: ConversationTarget, pollId: string) => void;
  readonly updateProfile: (displayName: string, status: string) => void;
};

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (ctx === null) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return ctx;
}

// The backend reports auth/delivery failures as machine-readable reasons;
// translate them before they reach the user.
const FRIENDLY_REASONS: Readonly<Record<string, string>> = {
  invalid_credentials: 'Incorrect username or password.',
  username_taken: 'That username is already taken.',
  validation_failed: 'Please check your entries and try again.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  internal_error: 'Something went wrong. Please try again.',
  user_not_found: 'That user is not online.',
  user_disconnected: 'That user has disconnected.',
};

function friendlyReason(reason: string): string {
  return FRIENDLY_REASONS[reason] ?? reason;
}

type PendingOp = {
  readonly at: number;
  readonly undo: () => void;
};

export function ChatProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef(getSocket());
  const e2eeRef = useRef(new E2eeSession());
  const stateRef = useRef(state);
  const pendingGuestRef = useRef<string | null>(null);
  // Kept in memory only — never persisted to storage.
  const credentialsRef = useRef<StoredCredentials | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in memory only — never persisted to storage.
  const mediaTokenRef = useRef<string | null>(null);
  // Outgoing typing burst state: which conversation, and its repeat timer.
  const typingRef = useRef<{
    target: ConversationTarget | null;
    active: boolean;
    interval: ReturnType<typeof setInterval> | null;
  }>({ target: null, active: false, interval: null });
  // Auto-hide timers for incoming typing indicators, keyed like `typing`.
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Highest receipt:read upTo already sent per peer — keeps repeats off the
  // shared rate-limit bucket.
  const lastReceiptRef = useRef<Record<string, number>>({});
  // Optimistic reacts/edits/deletes/profiles awaiting a possible rejection;
  // message_rejected carries no correlation id, so replies are matched FIFO-ish
  // by recency within a short window.
  const pendingOpsRef = useRef<PendingOp[]>([]);

  stateRef.current = state;

  const showError = useCallback((message: string) => {
    dispatch({ type: 'SET_ERROR', payload: message });
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
    }
    errorTimerRef.current = setTimeout(() => {
      errorTimerRef.current = null;
      dispatch({ type: 'SET_ERROR', payload: null });
    }, 5000);
  }, []);

  const enqueueOp = useCallback((undo: () => void) => {
    const now = Date.now();
    const fresh = pendingOpsRef.current.filter((op) => now - op.at <= PENDING_OP_TTL_MS);
    fresh.push({ at: now, undo });
    pendingOpsRef.current = fresh;
  }, []);

  const runLatestPendingOp = useCallback(() => {
    const now = Date.now();
    const fresh = pendingOpsRef.current.filter((op) => now - op.at <= PENDING_OP_TTL_MS);
    pendingOpsRef.current = fresh;
    // Newest first: a rejection lands within one round-trip of its emit, so
    // the most recent pending op is almost always the one being rejected.
    const op = fresh.pop();
    if (op !== undefined) op.undo();
  }, []);

  const connectIfNeeded = useCallback(() => {
    const socket = socketRef.current;
    if (!socket.connected) {
      socket.connect();
    }
  }, []);

  const login = useCallback(
    (username: string, password: string, pin?: string) => {
      const credentials: LoginCredentials =
        pin !== undefined && pin.length > 0
          ? { mode: 'login', username, password, pin }
          : { mode: 'login', username, password };
      credentialsRef.current = credentials;
      connectIfNeeded();
      socketRef.current.emit(EVENTS.CLIENT.USER_LOGIN, buildLoginPayload(credentials));
    },
    [connectIfNeeded],
  );

  const register = useCallback(
    (username: string, password: string, pin?: string) => {
      const credentials: LoginCredentials =
        pin !== undefined && pin.length > 0
          ? { mode: 'login', username, password, pin }
          : { mode: 'login', username, password };
      credentialsRef.current = credentials;
      connectIfNeeded();
      socketRef.current.emit(EVENTS.CLIENT.USER_REGISTER, buildLoginPayload(credentials));
    },
    [connectIfNeeded],
  );

  const joinAsGuest = useCallback(
    (username: string) => {
      credentialsRef.current = { mode: 'guest', username };
      pendingGuestRef.current = username;
      connectIfNeeded();
      socketRef.current.emit(EVENTS.CLIENT.USER_JOIN, { username });
    },
    [connectIfNeeded],
  );

  const clearTypingTimers = useCallback(() => {
    for (const timer of typingTimersRef.current.values()) {
      clearTimeout(timer);
    }
    typingTimersRef.current.clear();
  }, []);

  const stopTyping = useCallback(() => {
    const current = typingRef.current;
    if (current.interval !== null) {
      clearInterval(current.interval);
      current.interval = null;
    }
    if (current.active && current.target !== null) {
      enqueueOp(noopOp);
      if (socketRef.current.connected) {
        socketRef.current.emit(EVENTS.CLIENT.TYPING_SEND, {
          ...scopePayload(current.target),
          active: false,
        });
      }
    }
    current.active = false;
    current.target = null;
  }, [enqueueOp]);

  const sendTyping = useCallback(
    (target: ConversationTarget) => {
      const current = typingRef.current;
      if (current.active) {
        if (current.target !== null && sameConversation(current.target, target)) return;
        // Conversation switched mid-burst: clear the previous indicator first.
        stopTyping();
      }
      current.active = true;
      current.target = target;
      enqueueOp(noopOp);
      if (socketRef.current.connected) {
        socketRef.current.emit(EVENTS.CLIENT.TYPING_SEND, {
          ...scopePayload(target),
          active: true,
        });
      }
      current.interval = setInterval(() => {
        const live = typingRef.current;
        if (!live.active || live.target === null) return;
        enqueueOp(noopOp);
        if (socketRef.current.connected) {
          socketRef.current.emit(EVENTS.CLIENT.TYPING_SEND, {
            ...scopePayload(live.target),
            active: true,
          });
        }
      }, TYPING_REPEAT_MS);
    },
    [enqueueOp, stopTyping],
  );

  const logout = useCallback(() => {
    credentialsRef.current = null;
    pendingGuestRef.current = null;
    mediaTokenRef.current = null;
    clearMediaCache();
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    stopTyping();
    clearTypingTimers();
    dispatch({ type: 'CLEAR_TYPING' });
    pendingOpsRef.current = [];
    lastReceiptRef.current = {};
    socketRef.current.disconnect();
    e2eeRef.current = new E2eeSession();
    dispatch({ type: 'LOGOUT' });
  }, [clearTypingTimers, stopTyping]);

  // Highest timestamp of a message received from this peer (C2 upTo).
  const computeUpTo = useCallback((peer: string): number | undefined => {
    let max: number | undefined;
    for (const message of stateRef.current.messages) {
      if (message.isOwn || message.fromUsername !== peer) continue;
      if (max === undefined || message.timestamp > max) max = message.timestamp;
    }
    return max;
  }, []);

  const sendReadReceipt = useCallback(
    (peer: string, upTo: number) => {
      const socket = socketRef.current;
      if (!socket.connected) return;
      const last = lastReceiptRef.current[peer];
      if (last !== undefined && upTo <= last) return;
      lastReceiptRef.current[peer] = upTo;
      enqueueOp(noopOp);
      socket.emit(EVENTS.CLIENT.RECEIPT_READ, { to: peer, upTo });
    },
    [enqueueOp],
  );

  const setOpenConversation = useCallback(
    (target: ConversationTarget | null) => {
      dispatch({ type: 'OPEN_CONVERSATION', payload: target });
      if (target === null || target.kind !== 'dm' || !appIsFocused()) return;
      const upTo = computeUpTo(target.username);
      if (upTo !== undefined) sendReadReceipt(target.username, upTo);
    },
    [computeUpTo, sendReadReceipt],
  );

  const toggleReaction = useCallback(
    (target: ConversationTarget, targetId: string, emoji: string) => {
      const me = stateRef.current.user?.username;
      if (me === undefined) return;
      const current = stateRef.current.reactions[targetId]?.[emoji] ?? [];
      const active = !current.includes(me);
      enqueueOp(() =>
        dispatch({
          type: 'SET_REACTION',
          payload: { targetId, emoji, username: me, active: !active },
        }),
      );
      dispatch({ type: 'SET_REACTION', payload: { targetId, emoji, username: me, active } });
      socketRef.current.emit(EVENTS.CLIENT.MESSAGE_REACT, {
        ...scopePayload(target),
        targetId,
        emoji,
        active,
      });
    },
    [enqueueOp],
  );

  const findMessageById = useCallback(
    (targetId: string): DecryptedMessage | DecryptedGroupMessage | undefined => {
      return (
        stateRef.current.messages.find((m) => m.id === targetId) ??
        stateRef.current.groupMessages.find((m) => m.id === targetId)
      );
    },
    [],
  );

  const editMessage = useCallback(
    async (
      target: ConversationTarget,
      targetId: string,
      body: string,
      reply: ReplyRef | null,
    ): Promise<boolean> => {
      const original = findMessageById(targetId);
      if (
        original === undefined ||
        !original.isOwn ||
        original.media != null ||
        original.poll != null ||
        original.deleted
      ) {
        return false;
      }

      try {
        const envelope = wrapTextEnvelope(body, reply);
        const rollback = () =>
          dispatch({
            type: 'EDIT_MESSAGE',
            payload: {
              targetId,
              body: original.body,
              reply: original.reply,
              edited: original.edited,
            },
          });

        if (target.kind === 'dm') {
          const e2ee = e2eeRef.current;
          const ready = await e2ee.waitForSharedKey(target.username);
          if (!ready) {
            showError('Secure session not ready. Please try again.');
            return false;
          }
          const { ciphertext, iv } = await e2ee.encrypt(target.username, envelope);
          enqueueOp(rollback);
          dispatch({ type: 'EDIT_MESSAGE', payload: { targetId, body, reply, edited: true } });
          socketRef.current.emit(EVENTS.CLIENT.MESSAGE_EDIT, {
            to: target.username,
            targetId,
            ciphertext,
            iv,
          });
          return true;
        }

        const group = stateRef.current.groups.find((g) => g.groupId === target.groupId);
        if (group === undefined) return false;
        const e2ee = e2eeRef.current;
        const myUsername = stateRef.current.user?.username;
        const recipients = group.members.filter(
          (member) => member.username !== myUsername && e2ee.hasSharedKey(member.username),
        );
        if (recipients.length === 0) {
          showError('Secure session not ready. Please try again.');
          return false;
        }

        // One ciphertext decrypts with exactly one pairwise key, so each member
        // gets their own copy — the same key scheme a group send uses.
        const copies: { readonly ciphertext: string; readonly iv: string }[] = [];
        for (const member of recipients) {
          copies.push(await e2ee.encrypt(member.username, envelope));
        }
        enqueueOp(rollback);
        for (let i = 1; i < copies.length; i++) enqueueOp(noopOp);
        dispatch({ type: 'EDIT_MESSAGE', payload: { targetId, body, reply, edited: true } });
        for (const copy of copies) {
          socketRef.current.emit(EVENTS.CLIENT.MESSAGE_EDIT, {
            groupId: target.groupId,
            targetId,
            ciphertext: copy.ciphertext,
            iv: copy.iv,
          });
        }
        return true;
      } catch {
        showError('Failed to send message. Please try again.');
        return false;
      }
    },
    [enqueueOp, findMessageById, showError],
  );

  const deleteMessage = useCallback(
    (target: ConversationTarget, targetId: string) => {
      const original = findMessageById(targetId);
      if (original === undefined || !original.isOwn || original.deleted) return;
      enqueueOp(() => dispatch({ type: 'DELETE_MESSAGE', payload: { targetId, deleted: false } }));
      dispatch({ type: 'DELETE_MESSAGE', payload: { targetId, deleted: true } });
      socketRef.current.emit(EVENTS.CLIENT.MESSAGE_DELETE, { ...scopePayload(target), targetId });
    },
    [enqueueOp, findMessageById],
  );

  const votePoll = useCallback(
    (target: ConversationTarget, pollId: string, option: number) => {
      const me = stateRef.current.user?.username;
      if (me === undefined) return;
      const message = findMessageById(pollId);
      if (message === undefined || message.poll === null || message.deleted) return;
      if (option < 0 || option >= message.poll.options.length) return;
      if (stateRef.current.polls[pollId]?.closed === true) return;

      const previous = stateRef.current.polls[pollId]?.tallies[me];
      enqueueOp(() =>
        dispatch({
          type: 'SET_POLL_VOTE',
          payload: { pollId, username: me, option: previous ?? null },
        }),
      );
      dispatch({ type: 'SET_POLL_VOTE', payload: { pollId, username: me, option } });
      socketRef.current.emit(EVENTS.CLIENT.POLL_VOTE, { ...scopePayload(target), pollId, option });
    },
    [enqueueOp, findMessageById],
  );

  const closePoll = useCallback(
    (target: ConversationTarget, pollId: string) => {
      const me = stateRef.current.user?.username;
      if (me === undefined) return;
      const message = findMessageById(pollId);
      // Closing is author-only on the client (B3) — the server relays blindly.
      if (message === undefined || message.poll === null || message.deleted) return;
      if (!message.isOwn || message.fromUsername !== me) return;
      if (stateRef.current.polls[pollId]?.closed === true) return;

      enqueueOp(() => dispatch({ type: 'SET_POLL_CLOSED', payload: { pollId, closed: false } }));
      dispatch({ type: 'SET_POLL_CLOSED', payload: { pollId, closed: true } });
      socketRef.current.emit(EVENTS.CLIENT.POLL_CLOSE, { ...scopePayload(target), pollId });
    },
    [enqueueOp, findMessageById],
  );

  const updateProfile = useCallback(
    (rawDisplayName: string, rawStatus: string) => {
      const me = stateRef.current.user;
      if (me === null) return;
      const validation = validateProfile(rawDisplayName, rawStatus);
      // The editor renders these inline; nothing to send when either fails.
      if (validation.nameError !== null || validation.statusError !== null) return;
      const previous = stateRef.current.profiles[me.username] ?? {
        displayName: me.username,
        status: '',
      };
      enqueueOp(() =>
        dispatch({
          type: 'SET_PROFILE',
          payload: { username: me.username, ...previous },
        }),
      );
      dispatch({
        type: 'SET_PROFILE',
        payload: {
          username: me.username,
          displayName: validation.displayName,
          status: validation.status,
        },
      });
      socketRef.current.emit(EVENTS.CLIENT.PROFILE_UPDATE, {
        displayName: validation.displayName,
        status: validation.status,
      });
    },
    [enqueueOp],
  );

  const sendEncrypted = useCallback(
    async (toUsername: string, plaintext: string): Promise<boolean> => {
      if (toUsername === stateRef.current.user?.username) return false;
      try {
        const e2ee = e2eeRef.current;
        const ready = await e2ee.waitForSharedKey(toUsername);
        if (!ready) {
          showError('Secure session not ready. Please try again.');
          return false;
        }
        const { ciphertext, iv } = await e2ee.encrypt(toUsername, plaintext);
        enqueueOp(noopOp);
        socketRef.current.emit(EVENTS.CLIENT.MESSAGE_SEND, {
          id: crypto.randomUUID(),
          to: toUsername,
          ciphertext,
          iv,
        });
        return true;
      } catch {
        showError('Failed to send message. Please try again.');
        return false;
      }
    },
    [enqueueOp, showError],
  );

  // Text sends always go out as a v2 envelope; media keeps its own descriptor.
  const sendMessage = useCallback(
    (toUsername: string, body: string, reply?: ReplyRef | null): Promise<boolean> => {
      return sendEncrypted(toUsername, wrapTextEnvelope(body, reply ?? null));
    },
    [sendEncrypted],
  );

  const createGroup = useCallback((name: string, members: readonly string[]) => {
    socketRef.current.emit(EVENTS.CLIENT.GROUP_CREATE, { name, members });
  }, []);

  const addMember = useCallback((groupId: string, username: string) => {
    socketRef.current.emit(EVENTS.CLIENT.GROUP_MEMBER_ADD, { groupId, username });
  }, []);

  const removeMember = useCallback((groupId: string, username: string) => {
    socketRef.current.emit(EVENTS.CLIENT.GROUP_MEMBER_REMOVE, { groupId, username });
  }, []);

  const voteKick = useCallback((groupId: string, username: string) => {
    socketRef.current.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId, username });
  }, []);

  const sendGroupEncrypted = useCallback(
    async (groupId: string, plaintext: string): Promise<boolean> => {
      const currentUser = stateRef.current.user;
      const group = stateRef.current.groups.find((g) => g.groupId === groupId);
      if (currentUser === null || group === undefined) return false;

      try {
        const e2ee = e2eeRef.current;
        // Ensure we can decrypt our own echoed group message.
        await e2ee.ensureSelfKey(currentUser.username);

        const ciphertexts: {
          readonly to: string;
          readonly ciphertext: string;
          readonly iv: string;
        }[] = [];
        for (const member of group.members) {
          if (!e2ee.hasSharedKey(member.username)) continue;
          try {
            const { ciphertext, iv } = await e2ee.encrypt(member.username, plaintext);
            ciphertexts.push({ to: member.username, ciphertext, iv });
          } catch {
            if (member.username === currentUser.username) {
              showError('Failed to encrypt group message. Please try again.');
              return false;
            }
          }
        }

        if (ciphertexts.length === 0) {
          showError('Secure session not ready. Please try again.');
          return false;
        }

        enqueueOp(noopOp);
        socketRef.current.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, {
          id: crypto.randomUUID(),
          groupId,
          ciphertexts,
        });
        return true;
      } catch {
        showError('Failed to send message. Please try again.');
        return false;
      }
    },
    [enqueueOp, showError],
  );

  const sendGroupMessage = useCallback(
    (groupId: string, body: string, reply?: ReplyRef | null): Promise<boolean> => {
      return sendGroupEncrypted(groupId, wrapTextEnvelope(body, reply ?? null));
    },
    [sendGroupEncrypted],
  );

  const prepareMediaEnvelope = useCallback(
    async (file: File, durationSeconds?: number): Promise<string | null> => {
      try {
        const descriptor = await prepareAndUpload(
          file,
          mediaTokenRef.current ?? '',
          durationSeconds,
        );
        return JSON.stringify(descriptor);
      } catch (error) {
        showError(error instanceof MediaError ? error.message : 'Upload failed. Please try again.');
        return null;
      }
    },
    [showError],
  );

  const sendMediaMessage = useCallback(
    async (toUsername: string, file: File, durationSeconds?: number): Promise<boolean> => {
      const envelope = await prepareMediaEnvelope(file, durationSeconds);
      if (envelope === null) return false;
      // Media descriptors stay unwrapped — the parser branches on t first.
      return sendEncrypted(toUsername, envelope);
    },
    [prepareMediaEnvelope, sendEncrypted],
  );

  const sendGroupMediaMessage = useCallback(
    async (groupId: string, file: File, durationSeconds?: number): Promise<boolean> => {
      const envelope = await prepareMediaEnvelope(file, durationSeconds);
      if (envelope === null) return false;
      return sendGroupEncrypted(groupId, envelope);
    },
    [prepareMediaEnvelope, sendGroupEncrypted],
  );

  // Polls ride the normal message:send path; only the envelope shape differs.
  const sendPollMessage = useCallback(
    (toUsername: string, question: string, options: readonly string[]): Promise<boolean> => {
      const envelope = wrapPollEnvelope(question, options);
      if (envelope === null) return Promise.resolve(false);
      return sendEncrypted(toUsername, envelope);
    },
    [sendEncrypted],
  );

  const sendGroupPollMessage = useCallback(
    (groupId: string, question: string, options: readonly string[]): Promise<boolean> => {
      const envelope = wrapPollEnvelope(question, options);
      if (envelope === null) return Promise.resolve(false);
      return sendGroupEncrypted(groupId, envelope);
    },
    [sendGroupEncrypted],
  );

  useEffect(() => {
    const socket = socketRef.current;

    const sendPublicKeyTo = (to: string) => {
      e2eeRef.current.getPublicKey().then(
        (publicKey) => {
          socket.emit(EVENTS.CLIENT.E2EE_PUBLIC_KEY, { to, publicKey });
        },
        () => {},
      );
    };

    const knownUsernames = (): string[] => {
      const snapshot = stateRef.current;
      const names = new Set(snapshot.directory);
      for (const active of snapshot.users) names.add(active.username);
      if (snapshot.user !== null) names.add(snapshot.user.username);
      return Array.from(names);
    };

    const noteIncomingDm = (msg: PrivateMessage, built: DecryptedMessage, isOwn: boolean) => {
      if (isOwn) return;
      const snapshot = stateRef.current;
      const open = snapshot.openConversation;
      const isOpen = open !== null && open.kind === 'dm' && open.username === msg.fromUsername;
      const mention =
        !built.decryptionFailed &&
        built.poll === null &&
        snapshot.user !== null &&
        mentionsMe(built.body, knownUsernames(), snapshot.user.username, false);
      // Unread: count when the DM is closed or the window is in the back
      // ground; a mention of me always counts (C7).
      if (mention || !isOpen || !appIsFocused()) {
        dispatch({
          type: 'INCREMENT_UNREAD',
          payload: { key: `dm:${msg.fromUsername}`, mention },
        });
      }
      if (isOpen && appIsFocused()) {
        const upTo = computeUpTo(msg.fromUsername);
        sendReadReceipt(msg.fromUsername, Math.max(upTo ?? 0, msg.timestamp));
      }
    };

    const noteIncomingGroup = (groupId: string, built: DecryptedGroupMessage, isOwn: boolean) => {
      if (isOwn) return;
      const snapshot = stateRef.current;
      const open = snapshot.openConversation;
      const isOpen = open !== null && open.kind === 'group' && open.groupId === groupId;
      const mention =
        !built.decryptionFailed &&
        built.poll === null &&
        snapshot.user !== null &&
        mentionsMe(built.body, knownUsernames(), snapshot.user.username, true);
      if (mention || !isOpen || !appIsFocused()) {
        dispatch({ type: 'INCREMENT_UNREAD', payload: { key: `group:${groupId}`, mention } });
      }
    };

    const handleConnect = () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'connected' });

      const credentials = credentialsRef.current;
      if (credentials === null || stateRef.current.user === null) return;

      // Re-authenticate so the server can reattach the existing session.
      if (credentials.mode === 'guest') {
        pendingGuestRef.current = credentials.username;
        socket.emit(EVENTS.CLIENT.USER_JOIN, { username: credentials.username });
      } else {
        socket.emit(EVENTS.CLIENT.USER_LOGIN, buildLoginPayload(credentials));
      }
    };

    const handleDisconnect = () => {
      mediaTokenRef.current = null;
      clearMediaCache();
      // Indicators can't survive a dead socket; drop local typing state too.
      stopTyping();
      clearTypingTimers();
      dispatch({ type: 'CLEAR_TYPING' });
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'disconnected' });
    };

    const handleConnectError = () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'disconnected' });
    };

    const handleReconnectAttempt = () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'connecting' });
    };

    const handleWindowFocus = () => {
      const open = stateRef.current.openConversation;
      if (open === null) return;
      dispatch({ type: 'CLEAR_UNREAD', payload: unreadKeyFor(open) });
      if (open.kind === 'dm' && appIsFocused()) {
        const upTo = computeUpTo(open.username);
        if (upTo !== undefined) sendReadReceipt(open.username, upTo);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleWindowFocus();
      } else {
        // App backgrounded → typing active:false (C1).
        stopTyping();
      }
    };

    const handlePageHide = () => {
      stopTyping();
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    socket.on(EVENTS.SERVER.MEDIA_TOKEN, (payload) => {
      mediaTokenRef.current = payload.token;
    });

    socket.on(EVENTS.SERVER.LOGIN_SUCCESS, (result) => {
      if (result.kind === 'login_success') {
        pendingGuestRef.current = null;
        dispatch({
          type: 'SET_USER',
          payload: { userId: result.userId, username: result.username, isGuest: false },
        });
      }
    });

    socket.on(EVENTS.SERVER.LOGIN_ERROR, (result) => {
      if (result.kind === 'login_error') {
        showError(friendlyReason(result.reason));
      }
    });

    socket.on(EVENTS.SERVER.REGISTER_SUCCESS, (result) => {
      if (result.kind === 'register_success') {
        pendingGuestRef.current = null;
        dispatch({
          type: 'SET_USER',
          payload: { userId: result.userId, username: result.username, isGuest: false },
        });
      }
    });

    socket.on(EVENTS.SERVER.REGISTER_ERROR, (result) => {
      if (result.kind === 'register_error') {
        showError(friendlyReason(result.reason));
      }
    });

    socket.on(EVENTS.SERVER.USER_JOINED, (user) => {
      if (pendingGuestRef.current !== null && user.username === pendingGuestRef.current) {
        pendingGuestRef.current = null;
        dispatch({
          type: 'SET_USER',
          payload: { userId: user.userId, username: user.username, isGuest: true },
        });
      }
      dispatch({ type: 'ADD_USER', payload: user });
      dispatch({ type: 'ADD_DIRECTORY_USER', payload: user.username });
      dispatch({
        type: 'SET_PROFILE',
        payload: {
          username: user.username,
          displayName: user.displayName ?? user.username,
          status: user.status ?? '',
        },
      });

      // Our own key is derived locally when needed (see ensureSelfKey).
      if (user.username === stateRef.current.user?.username) return;
      // A rejoining peer may have a fresh keypair; drop any stale shared key so
      // sends wait for the new exchange instead of using an unusable key.
      e2eeRef.current.forgetSharedKey(user.username);
      sendPublicKeyTo(user.username);
    });

    socket.on(EVENTS.SERVER.USER_LEFT, (data) => {
      dispatch({ type: 'REMOVE_USER', payload: data.userId });
    });

    socket.on(EVENTS.SERVER.ACTIVE_USERS, (users) => {
      dispatch({ type: 'SET_USERS', payload: users });
      dispatch({
        type: 'SET_PROFILES',
        payload: users.map((u) => ({
          username: u.username,
          displayName: u.displayName ?? u.username,
          status: u.status ?? '',
        })),
      });
      // Include ourselves: the server relays the key back to our own room,
      // which gives us the self shared key used to decrypt our own group echoes.
      e2eeRef.current.getPublicKey().then(
        (publicKey) => {
          for (const user of users) {
            socket.emit(EVENTS.CLIENT.E2EE_PUBLIC_KEY, {
              to: user.username,
              publicKey,
            });
          }
        },
        () => {},
      );
    });

    socket.on(EVENTS.SERVER.ACTIVE_GROUPS, (groups) => {
      // The server re-sent active tallies right after this snapshot.
      dispatch({ type: 'SET_KICK_TALLIES', payload: [] });
      dispatch({ type: 'SET_GROUPS', payload: groups });
      const memberProfiles = groups.flatMap((group) =>
        group.members
          .filter((member) => member.displayName !== undefined || member.status !== undefined)
          .map((member) => ({
            username: member.username,
            displayName: member.displayName ?? member.username,
            status: member.status ?? '',
          })),
      );
      if (memberProfiles.length > 0) {
        dispatch({ type: 'SET_PROFILES', payload: memberProfiles });
      }
    });

    socket.on(EVENTS.SERVER.E2EE_PUBLIC_KEY, (data) => {
      e2eeRef.current.deriveSharedSecret(data.fromUsername, data.publicKey).catch(() => {});
    });

    socket.on(EVENTS.SERVER.PRIVATE_MESSAGE, (msg) => {
      const isOwn = msg.from === stateRef.current.user?.userId;
      // Our own echoed message is encrypted with the recipient's shared key,
      // not with our self key.
      const decryptWith = isOwn ? msg.toUsername : msg.fromUsername;
      e2eeRef.current.decrypt(decryptWith, msg.ciphertext, msg.iv).then(
        (plaintext) => {
          const built = buildDecryptedMessage(msg, plaintext, false, isOwn);
          dispatch({ type: 'ADD_MESSAGE', payload: built });
          noteIncomingDm(msg, built, isOwn);
        },
        () => {
          const built = buildDecryptedMessage(msg, '[Decryption failed]', true, isOwn);
          dispatch({ type: 'ADD_MESSAGE', payload: built });
          noteIncomingDm(msg, built, isOwn);
        },
      );
    });

    socket.on(EVENTS.SERVER.GROUP_CREATED, (group) => {
      dispatch({ type: 'ADD_GROUP', payload: group });
      const memberProfiles = group.members
        .filter((member) => member.displayName !== undefined || member.status !== undefined)
        .map((member) => ({
          username: member.username,
          displayName: member.displayName ?? member.username,
          status: member.status ?? '',
        }));
      if (memberProfiles.length > 0) {
        dispatch({ type: 'SET_PROFILES', payload: memberProfiles });
      }
    });

    socket.on(EVENTS.SERVER.GROUP_CREATED_ERROR, (data) => {
      showError(data.message);
    });

    socket.on(EVENTS.SERVER.USERS_DIRECTORY, (usernames) => {
      dispatch({ type: 'SET_DIRECTORY', payload: usernames });
    });

    socket.on(EVENTS.SERVER.GROUP_MEMBER_REMOVED, (payload) => {
      // Capture the name before dropping the group — the toast needs it afterwards.
      const group = stateRef.current.groups.find((g) => g.groupId === payload.groupId);
      const name = group?.name;
      dispatch({ type: 'REMOVE_GROUP', payload: payload.groupId });
      if (payload.username === stateRef.current.user?.username) {
        showError(
          payload.reason === 'kicked'
            ? `You were voted out of ${name ?? 'the group'}.`
            : `You were removed from ${name ?? 'the group'}.`,
        );
      }
    });

    socket.on(EVENTS.SERVER.GROUP_KICK_TALLY, (tally) => {
      dispatch({ type: 'UPSERT_KICK_TALLY', payload: tally });
    });

    socket.on(EVENTS.SERVER.GROUP_MESSAGE, (msg) => {
      const myUsername = stateRef.current.user?.username;
      if (myUsername === undefined) return;

      const isOwn = msg.from === stateRef.current.user?.userId;

      const myEntry = msg.ciphertexts.find((c) => c.to === myUsername);
      if (myEntry === undefined) {
        const built = buildDecryptedGroupMessage(msg, '[Encrypted]', true, isOwn);
        dispatch({ type: 'ADD_GROUP_MESSAGE', payload: built });
        noteIncomingGroup(msg.groupId, built, isOwn);
        return;
      }

      e2eeRef.current.decrypt(msg.fromUsername, myEntry.ciphertext, myEntry.iv).then(
        (plaintext) => {
          const built = buildDecryptedGroupMessage(msg, plaintext, false, isOwn);
          dispatch({ type: 'ADD_GROUP_MESSAGE', payload: built });
          noteIncomingGroup(msg.groupId, built, isOwn);
        },
        () => {
          const built = buildDecryptedGroupMessage(msg, '[Decryption failed]', true, isOwn);
          dispatch({ type: 'ADD_GROUP_MESSAGE', payload: built });
          noteIncomingGroup(msg.groupId, built, isOwn);
        },
      );
    });

    socket.on(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, (data) => {
      showError(data.message);
    });

    socket.on(EVENTS.SERVER.DELIVERY_FAILED, (result) => {
      if (!result.delivered) {
        showError(`Message to ${result.to} failed: ${friendlyReason(result.reason)}`);
      }
    });

    socket.on(EVENTS.SERVER.MESSAGE_REJECTED, (data) => {
      showError(data.reason);
      runLatestPendingOp();
    });

    socket.on(EVENTS.SERVER.ERROR, (data) => {
      showError(data.message);
    });

    // ── Tier-1 events ──

    socket.on(EVENTS.SERVER.TYPING_CHANGED, (payload) => {
      const key =
        payload.groupId !== undefined
          ? `group:${payload.groupId}:${payload.fromUsername}`
          : `dm:${payload.fromUsername}`;

      const existingTimer = typingTimersRef.current.get(key);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
        typingTimersRef.current.delete(key);
      }

      if (!payload.active) {
        dispatch({ type: 'CLEAR_TYPING_KEY', payload: key });
        return;
      }

      dispatch({ type: 'SET_TYPING', payload: { key, expiresAt: Date.now() + TYPING_HIDE_MS } });
      const timer = setTimeout(() => {
        typingTimersRef.current.delete(key);
        dispatch({ type: 'CLEAR_TYPING_KEY', payload: key });
      }, TYPING_HIDE_MS);
      typingTimersRef.current.set(key, timer);
    });

    socket.on(EVENTS.SERVER.RECEIPT_READ, (payload) => {
      dispatch({
        type: 'SET_READ',
        payload: { peer: payload.fromUsername, upTo: payload.upTo },
      });
    });

    socket.on(EVENTS.SERVER.MESSAGE_REACTED, (payload) => {
      dispatch({
        type: 'SET_REACTION',
        payload: {
          targetId: payload.targetId,
          emoji: payload.emoji,
          username: payload.fromUsername,
          active: payload.active,
        },
      });
    });

    socket.on(EVENTS.SERVER.MESSAGE_EDITED, (payload) => {
      const list =
        payload.groupId !== undefined ? stateRef.current.groupMessages : stateRef.current.messages;
      const original = list.find((m) => m.id === payload.targetId);
      if (original === undefined) return;
      // The relay is stateless: only the original author may edit, and only
      // when the original was a text message (spec B author enforcement).
      if (original.fromUsername !== payload.fromUsername) return;
      if (original.media != null || original.poll != null || original.deleted) return;

      e2eeRef.current.decrypt(payload.fromUsername, payload.ciphertext, payload.iv).then(
        (plaintext) => {
          const parsed = parseEnvelope(plaintext);
          if (parsed.kind === 'media' || parsed.kind === 'poll') return;
          const body = parsed.kind === 'text' ? parsed.body : parsed.text;
          const reply = parsed.kind === 'text' ? parsed.reply : null;
          dispatch({
            type: 'EDIT_MESSAGE',
            payload: { targetId: payload.targetId, body, reply, edited: true },
          });
        },
        () => {},
      );
    });

    socket.on(EVENTS.SERVER.MESSAGE_DELETED, (payload) => {
      const list =
        payload.groupId !== undefined ? stateRef.current.groupMessages : stateRef.current.messages;
      const original = list.find((m) => m.id === payload.targetId);
      if (original === undefined) return;
      if (original.fromUsername !== payload.fromUsername) return;
      if (original.deleted) return;
      dispatch({
        type: 'DELETE_MESSAGE',
        payload: { targetId: payload.targetId, deleted: true },
      });
    });

    // ── Poll events (B3): the server relays blindly, so every validity
    // rule below is enforced here against the decrypted poll definition.

    const findPollMessage = (pollId: string) => {
      const snapshot = stateRef.current;
      return (
        snapshot.messages.find((m) => m.id === pollId) ??
        snapshot.groupMessages.find((m) => m.id === pollId)
      );
    };

    socket.on(EVENTS.SERVER.POLL_VOTED, (payload) => {
      const message = findPollMessage(payload.pollId);
      // Unknown polls and tombstoned messages drop silently (C3).
      if (message === undefined || message.poll === null || message.deleted) return;
      if (stateRef.current.polls[payload.pollId]?.closed === true) return;
      // Our own vote was applied optimistically before the relay excluded us.
      if (payload.u === stateRef.current.user?.username) return;
      if (
        !Number.isInteger(payload.option) ||
        payload.option < 0 ||
        payload.option >= message.poll.options.length
      ) {
        return;
      }
      dispatch({
        type: 'SET_POLL_VOTE',
        payload: { pollId: payload.pollId, username: payload.u, option: payload.option },
      });
    });

    socket.on(EVENTS.SERVER.POLL_CLOSED, (payload) => {
      const message = findPollMessage(payload.pollId);
      if (message === undefined || message.poll === null || message.deleted) return;
      // Only the poll author's close is applied; anything else is ignored.
      if (payload.u !== message.fromUsername) return;
      if (stateRef.current.polls[payload.pollId]?.closed === true) return;
      dispatch({ type: 'SET_POLL_CLOSED', payload: { pollId: payload.pollId, closed: true } });
    });

    socket.on(EVENTS.SERVER.PROFILE_UPDATED, (payload) => {
      dispatch({
        type: 'SET_PROFILE',
        payload: {
          username: payload.username,
          displayName: payload.displayName,
          status: payload.status,
        },
      });
    });

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      socket.removeAllListeners();
      socket.disconnect();
      mediaTokenRef.current = null;
      clearMediaCache();
      clearTypingTimers();
      if (errorTimerRef.current !== null) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [clearTypingTimers, computeUpTo, runLatestPendingOp, sendReadReceipt, showError, stopTyping]);

  const value: ChatContextValue = {
    user: state.user,
    login,
    register,
    joinAsGuest,
    logout,
    users: state.users,
    messages: state.messages,
    sendMessage,
    sendMediaMessage,
    sendPollMessage,
    groups: state.groups,
    groupMessages: state.groupMessages,
    directory: state.directory,
    kickTallies: state.kickTallies,
    createGroup,
    sendGroupMessage,
    sendGroupMediaMessage,
    sendGroupPollMessage,
    mediaToken: mediaTokenRef.current,
    addMember,
    removeMember,
    voteKick,
    connectionStatus: state.connectionStatus,
    error: state.error,
    unread: state.unread,
    reactions: state.reactions,
    readUpTo: state.readUpTo,
    typing: state.typing,
    profiles: state.profiles,
    displayNameOf: (username: string) => state.profiles[username]?.displayName || username,
    setOpenConversation,
    sendTyping,
    stopTyping,
    toggleReaction,
    editMessage,
    deleteMessage,
    polls: state.polls,
    votePoll,
    closePoll,
    updateProfile,
  };

  return <ChatContext value={value}>{children}</ChatContext>;
}
