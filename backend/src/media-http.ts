import type { Logger } from 'pino';
import type { MediaAuth } from './media-auth';
import type { MediaStore } from './media-store';
import type { RateLimiterRegistry } from './rate-limiter';
import { CONSTANTS } from './types';

const MEDIA_PREFIX = '/media/';
const MAX_UPLOAD_BYTES = CONSTANTS.MAX_MEDIA_BYTES + 16;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BEARER = /^Bearer\s+(\S+)$/;
const ALLOW_METHODS = 'GET, PUT, OPTIONS';

type ResolvedId =
  | { readonly kind: 'ok'; readonly id: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' };

function resolveId(pathname: string): ResolvedId {
  if (!pathname.startsWith(MEDIA_PREFIX)) {
    return { kind: 'missing' };
  }
  const rest = pathname.slice(MEDIA_PREFIX.length);
  if (rest === '' || rest.includes('/')) {
    return { kind: 'missing' };
  }
  return MEDIA_ID.test(rest) ? { kind: 'ok', id: rest } : { kind: 'invalid' };
}

function corsHeaders(req: Request, corsOrigins: readonly string[]): Headers {
  const headers = new Headers();
  const origin = req.headers.get('origin');
  if (corsOrigins.includes('*')) {
    headers.set('access-control-allow-origin', '*');
  } else if (origin !== null && corsOrigins.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  return headers;
}

function jsonResponse(status: number, body: unknown, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status: number, code: string, cors: Headers): Response {
  return jsonResponse(status, { error: code }, cors);
}

export function createMediaHttpHandler(
  mediaStore: MediaStore,
  mediaAuth: MediaAuth,
  rateLimiters: RateLimiterRegistry,
  corsOrigins: readonly string[],
  logger: Logger,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req, corsOrigins);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      cors.set('access-control-allow-methods', ALLOW_METHODS);
      cors.set('access-control-allow-headers', 'Authorization, Content-Type');
      cors.set('access-control-max-age', '86400');
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method !== 'GET' && req.method !== 'PUT') {
      cors.set('allow', ALLOW_METHODS);
      return errorResponse(405, 'method_not_allowed', cors);
    }

    const resolved = resolveId(url.pathname);
    if (resolved.kind === 'missing') {
      return errorResponse(404, 'not_found', cors);
    }
    if (resolved.kind === 'invalid') {
      return errorResponse(400, 'invalid_id', cors);
    }
    const fileId = resolved.id;

    const authHeader = req.headers.get('authorization');
    const bearer = authHeader === null ? undefined : BEARER.exec(authHeader)?.[1];
    const identity = bearer === undefined ? undefined : mediaAuth.verify(bearer);
    if (identity === undefined || bearer === undefined) {
      return errorResponse(401, 'unauthorized', cors);
    }

    if (req.method === 'GET') {
      const bytes = mediaStore.get(fileId);
      if (bytes === undefined) {
        return errorResponse(404, 'not_found', cors);
      }
      const headers = new Headers(cors);
      headers.set('content-type', 'application/octet-stream');
      headers.set('cache-control', 'no-store');
      logger.info({ fileId }, 'media downloaded');
      return new Response(bytes, { status: 200, headers });
    }

    const rate = rateLimiters.check(bearer);
    if (!rate.allowed) {
      return errorResponse(429, 'rate_limited', cors);
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength !== null) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
        return errorResponse(413, 'too_large', cors);
      }
    }
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.length > MAX_UPLOAD_BYTES) {
      return errorResponse(413, 'too_large', cors);
    }

    const stored = mediaStore.put(fileId, body);
    if (stored === 'too_large') {
      return errorResponse(413, 'too_large', cors);
    }
    if (stored === 'quota_exceeded') {
      return errorResponse(429, 'quota_exceeded', cors);
    }

    logger.info({ fileId, bytes: body.length }, 'media uploaded');
    return jsonResponse(201, { ok: true }, cors);
  };
}
