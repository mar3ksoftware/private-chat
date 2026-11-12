// ── Envelope v2 (C3/C4): discriminated JSON inside the E2EE plaintext ──

import type { MediaDescriptor, ParsedEnvelope, ReplyRef } from '../types';
import { parseMediaEnvelope } from './media';

const REPLY_EXCERPT_MAX = 140;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReplyRef(value: unknown): ReplyRef | null {
  if (!isRecord(value)) return null;
  const { id, u, e } = value;
  if (typeof id === 'string' && typeof u === 'string' && typeof e === 'string') {
    return { id, u, e };
  }
  return null;
}

// Parse order matters (spec C3): JSON.parse first, then t === 'media',
// then t === 'text'; a failed parse is legacy raw text; any other t
// renders the raw string as-is.
export function parseEnvelope(plaintext: string): ParsedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { kind: 'raw', text: plaintext };
  }
  if (!isRecord(parsed)) return { kind: 'raw', text: plaintext };

  if (parsed['t'] === 'media') {
    const descriptor = parseMediaEnvelope(plaintext);
    // A malformed descriptor falls back to raw so the bubble keeps showing
    // the plaintext instead of an empty attachment slot.
    return descriptor !== null ? { kind: 'media', descriptor } : { kind: 'raw', text: plaintext };
  }

  if (parsed['t'] === 'text') {
    const body = parsed['b'];
    if (typeof body !== 'string') return { kind: 'raw', text: plaintext };
    return { kind: 'text', body, reply: parseReplyRef(parsed['r']) };
  }

  return { kind: 'raw', text: plaintext };
}

// Every newly sent text message goes through here, reply or not.
export function wrapTextEnvelope(body: string, reply?: ReplyRef | null): string {
  if (reply != null) {
    return JSON.stringify({ t: 'text', b: body, r: reply } satisfies {
      t: 'text';
      b: string;
      r: ReplyRef;
    });
  }
  return JSON.stringify({ t: 'text', b: body } satisfies { t: 'text'; b: string });
}

// Reply excerpt: first 140 chars of the original body; media targets use
// the file name or "Attachment" (C4).
export function excerptOf(text: string): string {
  return text.length > REPLY_EXCERPT_MAX ? text.slice(0, REPLY_EXCERPT_MAX) : text;
}

export function replyExcerptFor(
  body: string,
  media: { readonly name?: string | undefined } | null | undefined,
): string {
  if (media != null) return excerptOf(media.name ?? 'Attachment');
  return excerptOf(body);
}

export function mediaDescriptorOf(parsed: ParsedEnvelope): MediaDescriptor | null {
  return parsed.kind === 'media' ? parsed.descriptor : null;
}
