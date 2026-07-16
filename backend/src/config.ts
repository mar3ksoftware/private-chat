type Config = {
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly logLevel: string;
  readonly dbPath: string;
  readonly pingInterval: number;
  readonly pingTimeout: number;
};

const DEFAULTS = {
  port: 3000,
  corsOrigins: ['*'] as const,
  logLevel: 'info',
  dbPath: './chat.db',
  pingInterval: 25_000,
  pingTimeout: 20_000,
} as const;

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULTS.port;
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return parsed;
}

function parseCorsOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') {
    return DEFAULTS.corsOrigins;
  }
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function parsePositiveInt(value: string | undefined, defaultVal: number, name: string): number {
  if (value === undefined || value === '') {
    return defaultVal;
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1000) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function createConfig(env: typeof process.env = process.env): Config {
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const portRaw = env['PORT'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const corsOriginsRaw = env['CORS_ORIGINS'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const logLevelRaw = env['LOG_LEVEL'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const pingIntervalRaw = env['PING_INTERVAL'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const pingTimeoutRaw = env['PING_TIMEOUT'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const dbPathRaw = env['DB_PATH'];

  const port = parsePort(portRaw);
  const corsOrigins = parseCorsOrigins(corsOriginsRaw);
  const logLevel = logLevelRaw ?? DEFAULTS.logLevel;
  const dbPath = dbPathRaw ?? DEFAULTS.dbPath;
  const pingInterval = parsePositiveInt(pingIntervalRaw, DEFAULTS.pingInterval, 'PING_INTERVAL');
  const pingTimeout = parsePositiveInt(pingTimeoutRaw, DEFAULTS.pingTimeout, 'PING_TIMEOUT');

  return Object.freeze({
    port,
    corsOrigins,
    logLevel,
    pingInterval,
    pingTimeout,
    dbPath,
  });
}

const config = createConfig();

export type { Config };
export { config, createConfig };
