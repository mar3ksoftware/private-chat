import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { MediaAuth } from './media-auth';
import { createMediaHttpHandler } from './media-http';
import { MediaStore } from './media-store';
import { RateLimiterRegistry } from './rate-limiter';
import { CONSTANTS } from './types';

const BASE = 'http://localhost';
const FILE_ID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';
const OTHER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

type StoreOverrides = {
  readonly ttlMs?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
};

type Env = {
  readonly handler: (req: Request) => Promise<Response>;
  readonly store: MediaStore;
  readonly token: string;
  readonly otherToken: string;
  readonly setStoreNow: (value: number) => void;
};

function createEnv(opts?: {
  readonly store?: StoreOverrides;
  readonly corsOrigins?: readonly string[];
}): Env {
  let storeNow = 0;
  const authNow = 0;
  const rateNow = 0;
  const store = new MediaStore({ sweepIntervalMs: 0, now: () => storeNow, ...opts?.store });
  const auth = new MediaAuth(undefined, () => authNow);
  const rateLimiters = new RateLimiterRegistry(undefined, undefined, () => rateNow);
  const logger = pino({ level: 'silent' });
  const handler = createMediaHttpHandler(
    store,
    auth,
    rateLimiters,
    opts?.corsOrigins ?? ['*'],
    logger,
  );
  return {
    handler,
    store,
    token: auth.issue('alice'),
    otherToken: auth.issue('bob'),
    setStoreNow: (value: number): void => {
      storeNow = value;
    },
  };
}

function putRequest(
  path: string,
  token: string | null,
  body: Uint8Array,
  headers: Record<string, string> = {},
): Request {
  const merged = new Headers(headers);
  if (token !== null) {
    merged.set('authorization', `Bearer ${token}`);
  }
  return new Request(`${BASE}${path}`, { method: 'PUT', headers: merged, body });
}

function getRequest(path: string, token: string | null): Request {
  const headers = new Headers();
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return new Request(`${BASE}${path}`, { method: 'GET', headers });
}

function sampleBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
}

describe('createMediaHttpHandler', () => {
  test('missing or malformed Authorization returns 401 unauthorized', async () => {
    const env = createEnv();

    const missing = await env.handler(getRequest(`/media/${FILE_ID}`, null));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: 'unauthorized' });

    const garbage = await env.handler(getRequest(`/media/${FILE_ID}`, 'not-a-token'));
    expect(garbage.status).toBe(401);
    expect(await garbage.json()).toEqual({ error: 'unauthorized' });

    const wrongScheme = await env.handler(
      new Request(`${BASE}/media/${FILE_ID}`, {
        method: 'GET',
        headers: { authorization: 'Basic dXNlcjpwdw==' },
      }),
    );
    expect(wrongScheme.status).toBe(401);
    expect(await wrongScheme.json()).toEqual({ error: 'unauthorized' });
  });

  test('PUT with a malformed id returns 400 invalid_id, a missing segment 404', async () => {
    const env = createEnv();

    const badId = await env.handler(putRequest('/media/not-a-uuid', env.token, sampleBytes()));
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({ error: 'invalid_id' });

    const noSegment = await env.handler(putRequest('/media/', env.token, sampleBytes()));
    expect(noSegment.status).toBe(404);
    expect(await noSegment.json()).toEqual({ error: 'not_found' });

    const nested = await env.handler(
      putRequest(`/media/${FILE_ID}/extra`, env.token, sampleBytes()),
    );
    expect(nested.status).toBe(404);
    expect(await nested.json()).toEqual({ error: 'not_found' });
  });

  test('PUT stores the bytes and GET serves them back', async () => {
    const env = createEnv();
    const payload = sampleBytes();

    const uploaded = await env.handler(putRequest(`/media/${FILE_ID}`, env.token, payload));
    expect(uploaded.status).toBe(201);
    expect(await uploaded.json()).toEqual({ ok: true });
    expect(env.store.fileCount).toBe(1);

    const fetched = await env.handler(getRequest(`/media/${FILE_ID}`, env.token));
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('application/octet-stream');
    expect(fetched.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(payload);
  });

  test('GET for an unknown id returns 404 not_found', async () => {
    const env = createEnv();

    const res = await env.handler(getRequest(`/media/${OTHER_ID}`, env.token));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  test('oversized uploads return 413 too_large', async () => {
    const env = createEnv({ store: { maxFileBytes: 8 } });

    const tooBig = await env.handler(putRequest(`/media/${FILE_ID}`, env.token, new Uint8Array(9)));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: 'too_large' });
    expect(env.store.fileCount).toBe(0);

    const early = await env.handler(
      putRequest(`/media/${OTHER_ID}`, env.token, new Uint8Array(4), {
        'content-length': String(CONSTANTS.MAX_MEDIA_BYTES + 17),
      }),
    );
    expect(early.status).toBe(413);
    expect(await early.json()).toEqual({ error: 'too_large' });
    expect(env.store.fileCount).toBe(0);
  });

  test('exceeding the total-byte quota returns 429 quota_exceeded', async () => {
    const env = createEnv({ store: { maxTotalBytes: 8 } });

    const first = await env.handler(putRequest(`/media/${FILE_ID}`, env.token, new Uint8Array(4)));
    expect(first.status).toBe(201);

    const second = await env.handler(
      putRequest(`/media/${OTHER_ID}`, env.token, new Uint8Array(5)),
    );
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'quota_exceeded' });
    expect(env.store.totalBytes).toBe(4);
  });

  test('expired blobs return 404 on GET', async () => {
    const env = createEnv({ store: { ttlMs: 1_000 } });

    const uploaded = await env.handler(putRequest(`/media/${FILE_ID}`, env.token, sampleBytes()));
    expect(uploaded.status).toBe(201);
    expect((await env.handler(getRequest(`/media/${FILE_ID}`, env.token))).status).toBe(200);

    env.setStoreNow(1_000);
    const expired = await env.handler(getRequest(`/media/${FILE_ID}`, env.token));
    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual({ error: 'not_found' });
  });

  test('PUT rate limit is per token and allows 10 requests per window', async () => {
    const env = createEnv();

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await env.handler(
        putRequest(`/media/${FILE_ID}`, env.token, new Uint8Array([i])),
      );
      statuses.push(res.status);
      if (res.status === 429) {
        expect(await res.json()).toEqual({ error: 'rate_limited' });
      }
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1);
    expect(statuses.filter((status) => status === 201).length).toBe(10);

    const otherToken = await env.handler(
      putRequest(`/media/${OTHER_ID}`, env.otherToken, new Uint8Array([9])),
    );
    expect(otherToken.status).toBe(201);
  });

  test('OPTIONS preflight returns 204 with CORS headers', async () => {
    const env = createEnv();

    const res = await env.handler(new Request(`${BASE}/media/${FILE_ID}`, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('CORS origin handling: wildcard, echo, and unlisted origin', async () => {
    const wildcard = createEnv({ corsOrigins: ['*'] });
    const starRes = await wildcard.handler(
      putRequest(`/media/${FILE_ID}`, wildcard.token, sampleBytes(), {
        origin: 'http://any.test',
      }),
    );
    expect(starRes.status).toBe(201);
    expect(starRes.headers.get('access-control-allow-origin')).toBe('*');

    const listed = createEnv({ corsOrigins: ['http://a.test'] });
    const echoRes = await listed.handler(
      putRequest(`/media/${FILE_ID}`, listed.token, sampleBytes(), {
        origin: 'http://a.test',
      }),
    );
    expect(echoRes.status).toBe(201);
    expect(echoRes.headers.get('access-control-allow-origin')).toBe('http://a.test');
    expect(echoRes.headers.get('vary')).toBe('Origin');

    const deniedRes = await listed.handler(
      putRequest(`/media/${OTHER_ID}`, listed.token, sampleBytes(), {
        origin: 'http://evil.test',
      }),
    );
    expect(deniedRes.status).toBe(201);
    expect(deniedRes.headers.get('access-control-allow-origin')).toBeNull();
    expect(deniedRes.headers.get('vary')).toBeNull();
  });

  test('unsupported methods return 405 method_not_allowed', async () => {
    const env = createEnv();

    const res = await env.handler(new Request(`${BASE}/media/${FILE_ID}`, { method: 'POST' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
    expect(res.headers.get('allow')).toContain('PUT');
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });

  test('error responses still carry CORS headers', async () => {
    const env = createEnv({ corsOrigins: ['http://a.test'] });

    const res = await env.handler(getRequest(`/media/${OTHER_ID}`, null));
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();

    const allowed = await env.handler(
      new Request(`${BASE}/media/${OTHER_ID}`, {
        method: 'GET',
        headers: { origin: 'http://a.test' },
      }),
    );
    expect(allowed.status).toBe(401);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://a.test');
    expect(allowed.headers.get('vary')).toBe('Origin');
  });
});
