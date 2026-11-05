import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { E2eeSession } from '../lib/e2ee-session';
import { getSocket } from '../lib/socket';
import type {
  DecryptedGroupMessage,
  DecryptedMessage,
  GroupInfo,
  LoginPayload,
  UserInfo,
} from '../types';
import { EVENTS } from '../types';

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
  readonly connectionStatus: 'connecting' | 'connected' | 'disconnected';
  readonly error: string | null;
};

const initialState: ChatState = {
  user: null,
  users: [],
  messages: [],
  groups: [],
  groupMessages: [],
  connectionStatus: 'connecting',
  error: null,
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
  | { type: 'ADD_GROUP_MESSAGE'; payload: DecryptedGroupMessage }
  | {
      type: 'SET_CONNECTION_STATUS';
      payload: 'connecting' | 'connected' | 'disconnected';
    }
  | { type: 'SET_ERROR'; payload: string | null };

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
        error: null,
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
      // A group can be re-sent (e.g. new member added), so replace on same id.
      const index = state.groups.findIndex((g) => g.groupId === action.payload.groupId);
      if (index === -1) {
        return { ...state, groups: [...state.groups, action.payload] };
      }
      const groups = state.groups.slice();
      groups[index] = action.payload;
      return { ...state, groups };
    }
    case 'ADD_GROUP_MESSAGE':
      return { ...state, groupMessages: [...state.groupMessages, action.payload] };
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
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
  readonly sendMessage: (toUsername: string, plaintext: string) => Promise<boolean>;
  readonly groups: readonly GroupInfo[];
  readonly groupMessages: readonly DecryptedGroupMessage[];
  readonly createGroup: (name: string, members: readonly string[]) => void;
  readonly sendGroupMessage: (groupId: string, plaintext: string) => Promise<boolean>;
  readonly connectionStatus: 'connecting' | 'connected' | 'disconnected';
  readonly error: string | null;
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

export function ChatProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef(getSocket());
  const e2eeRef = useRef(new E2eeSession());
  const stateRef = useRef(state);
  const pendingGuestRef = useRef<string | null>(null);
  // Kept in memory only — never persisted to storage.
  const credentialsRef = useRef<StoredCredentials | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const logout = useCallback(() => {
    credentialsRef.current = null;
    pendingGuestRef.current = null;
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    socketRef.current.disconnect();
    e2eeRef.current = new E2eeSession();
    dispatch({ type: 'LOGOUT' });
  }, []);

  const sendMessage = useCallback(
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
        socketRef.current.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: toUsername, ciphertext, iv });
        return true;
      } catch {
        showError('Failed to send message. Please try again.');
        return false;
      }
    },
    [showError],
  );

  const createGroup = useCallback((name: string, members: readonly string[]) => {
    socketRef.current.emit(EVENTS.CLIENT.GROUP_CREATE, { name, members });
  }, []);

  const sendGroupMessage = useCallback(
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

        socketRef.current.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, { groupId, ciphertexts });
        return true;
      } catch {
        showError('Failed to send message. Please try again.');
        return false;
      }
    },
    [showError],
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
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'disconnected' });
    };

    const handleConnectError = () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'disconnected' });
    };

    const handleReconnectAttempt = () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'connecting' });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);

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
      dispatch({ type: 'SET_GROUPS', payload: groups });
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
          dispatch({
            type: 'ADD_MESSAGE',
            payload: {
              from: msg.from,
              fromUsername: msg.fromUsername,
              to: msg.to,
              toUsername: msg.toUsername,
              plaintext,
              timestamp: msg.timestamp,
              isOwn,
              decryptionFailed: false,
            },
          });
        },
        () => {
          dispatch({
            type: 'ADD_MESSAGE',
            payload: {
              from: msg.from,
              fromUsername: msg.fromUsername,
              to: msg.to,
              toUsername: msg.toUsername,
              plaintext: '[Decryption failed]',
              timestamp: msg.timestamp,
              isOwn,
              decryptionFailed: true,
            },
          });
        },
      );
    });

    socket.on(EVENTS.SERVER.GROUP_CREATED, (group) => {
      dispatch({ type: 'ADD_GROUP', payload: group });
    });

    socket.on(EVENTS.SERVER.GROUP_CREATED_ERROR, (data) => {
      showError(data.message);
    });

    socket.on(EVENTS.SERVER.GROUP_MESSAGE, (msg) => {
      const myUsername = stateRef.current.user?.username;
      if (myUsername === undefined) return;

      const base = {
        groupId: msg.groupId,
        from: msg.from,
        fromUsername: msg.fromUsername,
        timestamp: msg.timestamp,
        isOwn: msg.from === stateRef.current.user?.userId,
      };

      const myEntry = msg.ciphertexts.find((c) => c.to === myUsername);
      if (myEntry === undefined) {
        dispatch({
          type: 'ADD_GROUP_MESSAGE',
          payload: {
            ...base,
            plaintext: '[Encrypted]',
            decryptionFailed: true,
          },
        });
        return;
      }

      e2eeRef.current.decrypt(msg.fromUsername, myEntry.ciphertext, myEntry.iv).then(
        (plaintext) => {
          dispatch({
            type: 'ADD_GROUP_MESSAGE',
            payload: { ...base, plaintext, decryptionFailed: false },
          });
        },
        () => {
          dispatch({
            type: 'ADD_GROUP_MESSAGE',
            payload: { ...base, plaintext: '[Decryption failed]', decryptionFailed: true },
          });
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
    });

    socket.on(EVENTS.SERVER.ERROR, (data) => {
      showError(data.message);
    });

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.removeAllListeners();
      socket.disconnect();
      if (errorTimerRef.current !== null) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [showError]);

  const value: ChatContextValue = {
    user: state.user,
    login,
    register,
    joinAsGuest,
    logout,
    users: state.users,
    messages: state.messages,
    sendMessage,
    groups: state.groups,
    groupMessages: state.groupMessages,
    createGroup,
    sendGroupMessage,
    connectionStatus: state.connectionStatus,
    error: state.error,
  };

  return <ChatContext value={value}>{children}</ChatContext>;
}
