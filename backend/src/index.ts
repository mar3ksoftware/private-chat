import { Database } from 'bun:sqlite';
import { Server as Engine } from '@socket.io/bun-engine';
import { Server } from 'socket.io';
import { AccountStore } from './account-store';
import { config } from './config';
import { GroupStore } from './group-store';
import { KickVoteStore } from './kick-vote-store';
import { logger } from './logger';
import { MediaAuth } from './media-auth';
import { createMediaHttpHandler } from './media-http';
import { MediaStore } from './media-store';
import { ProfileStore } from './profile-store';
import { RateLimiterRegistry } from './rate-limiter';
import { createServer } from './server';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { UserDirectory } from './user-directory';
import { UserRegistry } from './user-registry';

const io = new Server<ClientToServerEvents, ServerToClientEvents>();
// `['*']` must stay the wildcard string: the engine treats an array as a list
// of literal origins and would reject every request.
const corsOrigin = config.corsOrigins.includes('*') ? '*' : [...config.corsOrigins];
const engine = new Engine({
  path: '/socket.io/',
  pingInterval: config.pingInterval,
  pingTimeout: config.pingTimeout,
  maxHttpBufferSize: 4 * 1024 * 1024,
  cors: { origin: corsOrigin },
});

io.bind(engine);

const userRegistry = new UserRegistry();
const rateLimiters = new RateLimiterRegistry();
const db = new Database(config.dbPath);
const accountStore = new AccountStore(db);
const userDirectory = new UserDirectory(db);
const groupStore = new GroupStore();
const kickVoteStore = new KickVoteStore();
const mediaStore = new MediaStore();
const mediaAuth = new MediaAuth();
const profileStore = new ProfileStore();
const mediaRateLimiters = new RateLimiterRegistry();
const mediaHttp = createMediaHttpHandler(
  mediaStore,
  mediaAuth,
  mediaRateLimiters,
  config.corsOrigins,
  logger,
);

createServer(
  io,
  userRegistry,
  rateLimiters,
  accountStore,
  groupStore,
  userDirectory,
  kickVoteStore,
  mediaAuth,
  profileStore,
  logger,
);

const handler = engine.handler();

const tls =
  config.tlsCertFile !== null && config.tlsKeyFile !== null
    ? { tls: { certFile: config.tlsCertFile, keyFile: config.tlsKeyFile } }
    : {};
const server = Bun.serve({
  port: config.port,
  ...tls,
  idleTimeout: Math.ceil(config.pingInterval / 1000) + 5,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', uptime: process.uptime() }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.startsWith('/media')) {
      return mediaHttp(req);
    }
    return handler.fetch(req, srv);
  },
  websocket: handler.websocket,
});

logger.info({ port: server.port, tls: config.tlsCertFile !== null }, 'server started');

function shutdown(): void {
  logger.info('shutting down');
  io.close();
  userRegistry.destroy();
  kickVoteStore.destroy();
  rateLimiters.destroy();
  accountStore.destroy();
  groupStore.destroy();
  mediaStore.destroy();
  mediaAuth.destroy();
  profileStore.destroy();
  mediaRateLimiters.destroy();
  server.stop(true);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
