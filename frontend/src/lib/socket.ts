// ── Socket.io-client singleton ──────────────────────────────────────────
// Connects to the backend via VITE_API_URL.
// If VITE_API_URL is unset, socket.io falls back to same-origin (Vite proxy
// in dev, reverse proxy in prod). Returns the same socket instance on every call.

import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';

import type { ClientToServerEvents, ServerToClientEvents } from '../types';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | undefined;

export function getSocket(): TypedSocket {
  if (socket === undefined) {
    // biome-ignore lint/complexity/useLiteralKeys: Vite env index sig
    const url = import.meta.env['VITE_API_URL'] as string | undefined;
    socket = io(url, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}
