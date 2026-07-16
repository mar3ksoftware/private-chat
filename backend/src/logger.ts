import type { Logger } from 'pino';
import pino from 'pino';

export function createLogger(env: typeof process.env = process.env): Logger {
  // biome-ignore lint/complexity/useLiteralKeys: required by tsconfig noPropertyAccessFromIndexSignature
  const level = env['LOG_LEVEL'] ?? 'info';
  // biome-ignore lint/complexity/useLiteralKeys: required by tsconfig noPropertyAccessFromIndexSignature
  const isProduction = env['NODE_ENV'] === 'production';

  if (isProduction) {
    return pino({ name: 'private-chat', level });
  }

  try {
    return pino({
      name: 'private-chat',
      level,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  } catch {
    return pino({ name: 'private-chat', level });
  }
}

export const logger = createLogger();
