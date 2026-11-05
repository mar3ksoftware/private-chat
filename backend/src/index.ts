import { Database } from 'bun:sqlite';
import { Server as Engine } from '@socket.io/bun-engine';
import { Server } from 'socket.io';
import { AccountStore } from './account-store';
import { config } from './config';
import { GroupStore } from './group-store';
import { logger } from './logger';
import { RateLimiterRegistry } from './rate-limiter';
import { createServer } from './server';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
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
const accountStore = new AccountStore(new Database(config.dbPath));
const groupStore = new GroupStore();

createServer(io, userRegistry, rateLimiters, accountStore, groupStore, logger);

const handler = engine.handler();

const server = Bun.serve({
  port: config.port,
  idleTimeout: Math.ceil(config.pingInterval / 1000) + 5,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', uptime: process.uptime() }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return handler.fetch(req, srv);
  },
  websocket: handler.websocket,
});

logger.info({ port: server.port }, 'server started');

function shutdown(): void {
  logger.info('shutting down');
  io.close();
  userRegistry.destroy();
  rateLimiters.destroy();
  accountStore.destroy();
  groupStore.destroy();
  server.stop(true);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
