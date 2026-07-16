import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { E2eeSession } from '../lib/e2ee-session';
import { getSocket } from '../lib/socket';
import type { DecryptedGroupMessage, DecryptedMessage, GroupInfo, UserInfo } from '../types';
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
    case 'ADD_USER':
      return { ...state, users: [...state.users, action.payload] };
    case 'REMOVE_USER':
      return { ...state, users: state.users.filter((u) => u.userId !== action.payload) };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'SET_GROUPS':
      return { ...state, groups: action.payload };
    case 'ADD_GROUP': {
      const exists = state.groups.some((g) => g.groupId === action.payload.groupId);
      if (exists) return state;
      return { ...state, groups: [...state.groups, action.payload] };
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
  readonly sendMessage: (toUsername: string, plaintext: string) => Promise<void>;
  readonly groups: readonly GroupInfo[];
  readonly groupMessages: readonly DecryptedGroupMessage[];
  readonly createGroup: (name: string, members: readonly string[]) => void;
  readonly sendGroupMessage: (groupId: string, plaintext: string) => Promise<void>;
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

export function ChatProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef(getSocket());
  const e2eeRef = useRef(new E2eeSession());
  const stateRef = useRef(state);
  const pendingGuestRef = useRef<string | null>(null);

  stateRef.current = state;

  const login = useCallback((username: string, password: string, pin?: string) => {
    const payload =
      pin !== undefined && pin.length > 0 ? { username, password, pin } : { username, password };
    socketRef.current.emit(EVENTS.CLIENT.USER_LOGIN, payload);
  }, []);

  const register = useCallback((username: string, password: string, pin?: string) => {
    const payload =
      pin !== undefined && pin.length > 0 ? { username, password, pin } : { username, password };
    socketRef.current.emit(EVENTS.CLIENT.USER_REGISTER, payload);
  }, []);

  const joinAsGuest = useCallback((username: string) => {
    pendingGuestRef.current = username;
    socketRef.current.emit(EVENTS.CLIENT.USER_JOIN, { username });
  }, []);

  const logout = useCallback(() => {
    socketRef.current.disconnect();
    dispatch({ type: 'LOGOUT' });
  }, []);

  const sendMessage = useCallback(async (toUsername: string, plaintext: string) => {
    const { ciphertext, iv } = await e2eeRef.current.encrypt(toUsername, plaintext);
    socketRef.current.emit(EVENTS.CLIENT.MESSAGE_SEND, { to: toUsername, ciphertext, iv });
  }, []);

  const createGroup = useCallback((name: string, members: readonly string[]) => {
    socketRef.current.emit(EVENTS.CLIENT.GROUP_CREATE, { name, members });
  }, []);

  const sendGroupMessage = useCallback(async (groupId: string, plaintext: string) => {
    const group = stateRef.current.groups.find((g) => g.groupId === groupId);
    if (group === undefined) return;

    const ciphertexts: { readonly to: string; readonly ciphertext: string; readonly iv: string }[] =
      [];
    for (const member of group.members) {
      if (member.username === stateRef.current.user?.username) continue;
      const { ciphertext, iv } = await e2eeRef.current.encrypt(member.username, plaintext);
      ciphertexts.push({ to: member.username, ciphertext, iv });
    }

    socketRef.current.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, { groupId, ciphertexts });
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const scheduleClearError = () => {
      const id = setTimeout(() => {
        dispatch({ type: 'SET_ERROR', payload: null });
      }, 5000);
      timeouts.push(id);
    };

    socket.on('connect', () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'connected' });
    });

    socket.on('disconnect', () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'disconnected' });
    });

    socket.on('connect_error', () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'disconnected' });
    });

    socket.on(EVENTS.SERVER.LOGIN_SUCCESS, (result) => {
      if (result.kind === 'login_success') {
        dispatch({
          type: 'SET_USER',
          payload: { userId: result.userId, username: result.username, isGuest: false },
        });
      }
    });

    socket.on(EVENTS.SERVER.LOGIN_ERROR, (result) => {
      if (result.kind === 'login_error') {
        dispatch({ type: 'SET_ERROR', payload: result.reason });
        scheduleClearError();
      }
    });

    socket.on(EVENTS.SERVER.REGISTER_SUCCESS, (result) => {
      if (result.kind === 'register_success') {
        dispatch({
          type: 'SET_USER',
          payload: { userId: result.userId, username: result.username, isGuest: false },
        });
      }
    });

    socket.on(EVENTS.SERVER.REGISTER_ERROR, (result) => {
      if (result.kind === 'register_error') {
        dispatch({ type: 'SET_ERROR', payload: result.reason });
        scheduleClearError();
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
      e2eeRef.current.getPublicKey().then(
        (publicKey) => {
          socket.emit(EVENTS.CLIENT.E2EE_PUBLIC_KEY, { to: user.username, publicKey });
        },
        () => {},
      );
    });

    socket.on(EVENTS.SERVER.USER_LEFT, (data) => {
      dispatch({ type: 'REMOVE_USER', payload: data.userId });
    });

    socket.on(EVENTS.SERVER.ACTIVE_USERS, (users) => {
      dispatch({ type: 'SET_USERS', payload: users });
    });

    socket.on(EVENTS.SERVER.E2EE_PUBLIC_KEY, (data) => {
      e2eeRef.current.deriveSharedSecret(data.fromUsername, data.publicKey).catch(() => {});
    });

    socket.on(EVENTS.SERVER.PRIVATE_MESSAGE, (msg) => {
      e2eeRef.current.decrypt(msg.fromUsername, msg.ciphertext, msg.iv).then(
        (plaintext) => {
          dispatch({
            type: 'ADD_MESSAGE',
            payload: {
              from: msg.from,
              fromUsername: msg.fromUsername,
              to: msg.to,
              plaintext,
              timestamp: msg.timestamp,
              isOwn: msg.from === stateRef.current.user?.userId,
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
              plaintext: '[Decryption failed]',
              timestamp: msg.timestamp,
              isOwn: msg.from === stateRef.current.user?.userId,
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
      dispatch({ type: 'SET_ERROR', payload: data.message });
      scheduleClearError();
    });

    socket.on(EVENTS.SERVER.GROUP_MESSAGE, (msg) => {
      const myUsername = stateRef.current.user?.username;
      if (myUsername === undefined) return;

      const myEntry = msg.ciphertexts.find((c) => c.to === myUsername);
      if (myEntry === undefined) {
        dispatch({
          type: 'ADD_GROUP_MESSAGE',
          payload: {
            groupId: msg.groupId,
            from: msg.from,
            fromUsername: msg.fromUsername,
            plaintext: msg.fromUsername,
            timestamp: msg.timestamp,
            isOwn: msg.from === stateRef.current.user?.userId,
            decryptionFailed: false,
          },
        });
        return;
      }

      e2eeRef.current.decrypt(msg.fromUsername, myEntry.ciphertext, myEntry.iv).then(
        (plaintext) => {
          dispatch({
            type: 'ADD_GROUP_MESSAGE',
            payload: {
              groupId: msg.groupId,
              from: msg.from,
              fromUsername: msg.fromUsername,
              plaintext,
              timestamp: msg.timestamp,
              isOwn: msg.from === stateRef.current.user?.userId,
              decryptionFailed: false,
            },
          });
        },
        () => {
          dispatch({
            type: 'ADD_GROUP_MESSAGE',
            payload: {
              groupId: msg.groupId,
              from: msg.from,
              fromUsername: msg.fromUsername,
              plaintext: '[Decryption failed]',
              timestamp: msg.timestamp,
              isOwn: msg.from === stateRef.current.user?.userId,
              decryptionFailed: true,
            },
          });
        },
      );
    });

    socket.on(EVENTS.SERVER.GROUP_MESSAGE_DELIVERY_FAILED, (data) => {
      dispatch({ type: 'SET_ERROR', payload: data.message });
      scheduleClearError();
    });

    socket.on(EVENTS.SERVER.DELIVERY_FAILED, (result) => {
      if (!result.delivered) {
        dispatch({
          type: 'SET_ERROR',
          payload: `Message to ${result.to} failed: ${result.reason}`,
        });
        scheduleClearError();
      }
    });

    socket.on(EVENTS.SERVER.MESSAGE_REJECTED, (data) => {
      dispatch({ type: 'SET_ERROR', payload: data.reason });
      scheduleClearError();
    });

    socket.on(EVENTS.SERVER.ERROR, (data) => {
      dispatch({ type: 'SET_ERROR', payload: data.message });
      scheduleClearError();
    });

    socket.connect();

    return () => {
      for (const id of timeouts) {
        clearTimeout(id);
      }
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

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
