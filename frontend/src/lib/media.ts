// ── Media sharing: envelope parsing, metadata stripping, upload/fetch ──
// Self-contained on purpose — the E2EE module stays untouched.

import type { MediaDescriptor } from '../types';
import { CONSTANTS } from '../types';

export class MediaError extends Error {}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const MEDIA_MIME_ALLOWLIST: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export function mimeForFileName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  return EXTENSION_MIME[name.slice(dot + 1).toLowerCase()] ?? null;
}

// ── Base64 helpers (duplicated locally; e2ee.ts stays untouched) ────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

// ── Envelope reception (A.2 rule, order-agnostic) ───────────────────────

export function parseMediaEnvelope(plaintext: string): MediaDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const fields = parsed as Record<string, unknown>;
  if (fields['t'] !== 'media' || fields['v'] !== 1) return null;

  const fileId = fields['fileId'];
  if (typeof fileId !== 'string' || !UUID_V4_RE.test(fileId)) return null;

  const key = fields['key'];
  if (typeof key !== 'string') return null;
  const keyBytes = base64ToBytes(key);
  if (keyBytes === null || keyBytes.length !== 32) return null;

  const iv = fields['iv'];
  if (typeof iv !== 'string') return null;
  const ivBytes = base64ToBytes(iv);
  if (ivBytes === null || ivBytes.length !== 12) return null;

  const sha256 = fields['sha256'];
  if (typeof sha256 !== 'string') return null;
  const shaBytes = base64ToBytes(sha256);
  if (shaBytes === null || shaBytes.length !== 32) return null;

  const mime = fields['mime'];
  if (typeof mime !== 'string' || mime.length === 0) return null;

  const size = fields['size'];
  if (
    typeof size !== 'number' ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > CONSTANTS.MAX_MEDIA_BYTES
  ) {
    return null;
  }

  const rawW = fields['w'];
  const rawH = fields['h'];
  let width: number | undefined;
  let height: number | undefined;
  if (rawW !== undefined || rawH !== undefined) {
    if (typeof rawW !== 'number' || !Number.isInteger(rawW) || rawW <= 0) return null;
    if (typeof rawH !== 'number' || !Number.isInteger(rawH) || rawH <= 0) return null;
    width = rawW;
    height = rawH;
  }

  const rawName = fields['name'];
  if (rawName !== undefined && typeof rawName !== 'string') return null;

  const base = {
    t: 'media' as const,
    v: 1 as const,
    fileId,
    key,
    iv,
    sha256,
    mime,
    size,
  };
  if (width !== undefined && height !== undefined) {
    if (typeof rawName === 'string') return { ...base, w: width, h: height, name: rawName };
    return { ...base, w: width, h: height };
  }
  if (typeof rawName === 'string') return { ...base, name: rawName };
  return base;
}

// ── Metadata stripping (fail closed) ────────────────────────────────────

export function stripImageMetadata(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Uint8Array<ArrayBuffer> {
  if (!mime.startsWith('image/')) return bytes;
  try {
    if (mime === 'image/jpeg') return stripJpeg(bytes);
    if (mime === 'image/png') return stripPng(bytes);
    if (mime === 'image/webp') return stripWebp(bytes);
    throw new Error('unsupported image type');
  } catch {
    throw new MediaError('Could not process that file.');
  }
}

function stripJpeg(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('missing SOI');
  }
  const out: number[] = [0xff, 0xd8];
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) throw new Error('expected marker');
    const marker = bytes[pos + 1];
    if (marker === undefined) throw new Error('truncated marker');
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      return new Uint8Array(out);
    }
    if (marker === 0xda) {
      // Entropy-coded data from SOS to the end, copied verbatim.
      out.push(...bytes.subarray(pos));
      return new Uint8Array(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) throw new Error('truncated segment');
    const length = readU16BE(bytes, pos + 2);
    if (length < 2 || pos + 2 + length > bytes.length) throw new Error('bad segment length');
    if (marker !== 0xe1 && marker !== 0xed) {
      out.push(...bytes.subarray(pos, pos + 2 + length));
    }
    pos += 2 + length;
  }
  throw new Error('missing SOS');
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROPPED_CHUNKS = ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'];

function stripPng(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (bytes.length < PNG_SIGNATURE.length) throw new Error('truncated png');
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('bad png signature');
  }
  const out: number[] = Array.from(bytes.subarray(0, 8));
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = readU32BE(bytes, pos);
    const end = pos + 12 + length;
    if (end > bytes.length) throw new Error('truncated chunk');
    const type = readFourCC(bytes, pos + 4);
    if (!PNG_DROPPED_CHUNKS.includes(type)) {
      out.push(...bytes.subarray(pos, end));
    }
    pos = end;
    if (type === 'IEND') return new Uint8Array(out);
  }
  throw new Error('missing IEND');
}

function stripWebp(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (bytes.length < 12) throw new Error('truncated webp');
  if (readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') {
    throw new Error('bad riff header');
  }
  const out: number[] = Array.from(bytes.subarray(0, 12));
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = readFourCC(bytes, pos);
    const size = readU32LE(bytes, pos + 4);
    const dataEnd = pos + 8 + size;
    if (dataEnd > bytes.length) throw new Error('truncated chunk');
    const chunkEnd = dataEnd + (size % 2);
    if (chunkEnd > bytes.length) throw new Error('missing pad byte');
    if (id !== 'EXIF ' && id !== 'XMP ') {
      out.push(...bytes.subarray(pos, chunkEnd));
    }
    pos = chunkEnd;
  }
  if (pos !== bytes.length) throw new Error('trailing bytes');
  const riffSize = out.length - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >>> 8) & 0xff;
  out[6] = (riffSize >>> 16) & 0xff;
  out[7] = (riffSize >>> 24) & 0xff;
  return new Uint8Array(out);
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] as number,
    bytes[offset + 1] as number,
    bytes[offset + 2] as number,
    bytes[offset + 3] as number,
  );
}

// ── Send pipeline (C.1) ─────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control chars from user filenames
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

function readImageSize(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<{ readonly w: number; readonly h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ w: image.naturalWidth, h: image.naturalHeight });
      } else {
        reject(new MediaError('Could not process that file.'));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new MediaError('Could not process that file.'));
    };
    image.src = url;
  });
}

function apiBase(): string {
  // biome-ignore lint/complexity/useLiteralKeys: Vite env index sig
  return (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';
}

async function putMediaBlob(
  fileId: string,
  bytes: Uint8Array<ArrayBuffer>,
  token: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/media/${fileId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
  } catch {
    throw new MediaError('Upload failed. Please try again.');
  }
  if (response.ok) return;
  if (response.status === 401) throw new MediaError('Not connected. Please try again.');
  if (response.status === 429) {
    if ((await readErrorCode(response)) === 'quota_exceeded') {
      throw new MediaError('Server storage is full. Please try again later.');
    }
    throw new MediaError('Too many uploads. Please wait a moment.');
  }
  throw new MediaError('Upload failed. Please try again.');
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const value = (body as { readonly error: unknown }).error;
      return typeof value === 'string' ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function prepareAndUpload(file: File, token: string): Promise<MediaDescriptor> {
  try {
    if (token.length === 0) throw new MediaError('Not connected. Please try again.');

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > CONSTANTS.MAX_MEDIA_BYTES) {
      throw new MediaError('File is too large (16 MB max).');
    }
    if (bytes.length === 0) throw new MediaError('Could not process that file.');

    const mime = file.type !== '' ? file.type : (mimeForFileName(file.name) ?? '');
    if (!MEDIA_MIME_ALLOWLIST.includes(mime)) throw new MediaError('Unsupported file type.');

    let payload = bytes;
    let width: number | undefined;
    let height: number | undefined;
    if (mime.startsWith('image/')) {
      payload = stripImageMetadata(bytes, mime);
      const dimensions = await readImageSize(payload, mime);
      width = dimensions.w;
      height = dimensions.h;
    }

    const fileId = crypto.randomUUID();
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, payload),
    );
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));

    await putMediaBlob(fileId, ciphertext, token);

    const base = {
      t: 'media' as const,
      v: 1 as const,
      fileId,
      key: bytesToBase64(key),
      iv: bytesToBase64(iv),
      sha256: bytesToBase64(digest),
      mime,
      size: payload.length,
    };
    const name = sanitizeFileName(file.name);
    if (width !== undefined && height !== undefined) {
      if (name.length > 0) return { ...base, w: width, h: height, name };
      return { ...base, w: width, h: height };
    }
    if (name.length > 0) return { ...base, name };
    return base;
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError('Upload failed. Please try again.');
  }
}

// ── Fetch pipeline (C.3): verify, then decrypt ──────────────────────────

export type MediaFetchResult =
  | { readonly status: 'ready'; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly status: 'expired' }
  | { readonly status: 'error' };

export function downloadAndDecrypt(
  descriptor: MediaDescriptor,
  token: string | null,
): Promise<MediaFetchResult> {
  return downloadAndDecryptInner(descriptor, token);
}

async function downloadAndDecryptInner(
  descriptor: MediaDescriptor,
  token: string | null,
): Promise<MediaFetchResult> {
  // An absent token is an auth failure: show the error but do not cache it,
  // so the bubble can retry once a token arrives.
  if (token === null || token.length === 0) return { status: 'error' };

  const cached = getCached(descriptor.fileId);
  if (cached !== undefined && cached.status !== 'ready') return { status: cached.status };

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/media/${descriptor.fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    putCached(descriptor.fileId, { status: 'error' });
    return { status: 'error' };
  }
  if (response.status === 404) {
    putCached(descriptor.fileId, { status: 'expired' });
    return { status: 'expired' };
  }
  if (response.status === 401) return { status: 'error' };
  if (!response.ok) {
    putCached(descriptor.fileId, { status: 'error' });
    return { status: 'error' };
  }

  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    ciphertext = new Uint8Array(await response.arrayBuffer());
  } catch {
    putCached(descriptor.fileId, { status: 'error' });
    return { status: 'error' };
  }

  const expected = base64ToBytes(descriptor.sha256);
  let actual: Uint8Array;
  try {
    actual = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));
  } catch {
    putCached(descriptor.fileId, { status: 'error' });
    return { status: 'error' };
  }
  if (expected === null || !bytesEqual(expected, actual)) {
    putCached(descriptor.fileId, { status: 'error' });
    return { status: 'error' };
  }

  try {
    const keyBytes = base64ToBytes(descriptor.key);
    const ivBytes = base64ToBytes(descriptor.iv);
    if (keyBytes === null || ivBytes === null) throw new Error('bad descriptor');
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      cryptoKey,
      ciphertext,
    );
    return { status: 'ready', bytes: new Uint8Array(plain) };
  } catch {
    putCached(descriptor.fileId, { status: 'error' });
    return { status: 'error' };
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── Session cache of fetch results ──────────────────────────────────────

export type MediaCacheEntry =
  | { readonly status: 'ready'; readonly blobUrl: string }
  | { readonly status: 'expired' }
  | { readonly status: 'error' };

const mediaCache = new Map<string, MediaCacheEntry>();

export function getCached(fileId: string): MediaCacheEntry | undefined {
  return mediaCache.get(fileId);
}

export function putCached(fileId: string, entry: MediaCacheEntry): void {
  mediaCache.set(fileId, entry);
}

export function clearMediaCache(): void {
  for (const entry of mediaCache.values()) {
    if (entry.status === 'ready') URL.revokeObjectURL(entry.blobUrl);
  }
  mediaCache.clear();
}
