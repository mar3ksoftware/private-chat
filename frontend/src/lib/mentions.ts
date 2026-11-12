// ── Mention parsing (C8) ──
// `@username` only counts when the name is an exact match against the known
// directory and sits on a word boundary; `@all` is group-only.

// `start` is the offset of the segment inside the body — used as a stable
// React key when rendering.
export type BodySegment =
  | { readonly kind: 'text'; readonly text: string; readonly start: number }
  | { readonly kind: 'mention'; readonly text: string; readonly start: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Boundary: preceded by start-of-string or a non-alphanumeric char, followed
// by a non-username char (usernames are [a-zA-Z0-9_-]).
function buildMentionRegExp(candidates: readonly string[]): RegExp | null {
  if (candidates.length === 0) return null;
  const unique = Array.from(new Set(candidates)).filter((name) => name.length > 0);
  if (unique.length === 0) return null;
  unique.sort((a, b) => b.length - a.length);
  const alternation = unique.map(escapeRegExp).join('|');
  return new RegExp(`(?<![A-Za-z0-9])@(${alternation})(?![A-Za-z0-9_-])`, 'gu');
}

function candidatesFor(
  knownUsernames: readonly string[],
  myUsername: string,
  allowAll: boolean,
): string[] {
  const names = new Set(knownUsernames);
  if (myUsername.length > 0) names.add(myUsername);
  if (allowAll) names.add('all');
  return Array.from(names);
}

// Splits the body into plain text and the mention tokens that address the
// current user (or `@all` in a group). Other valid mentions stay plain text —
// only mentions of me are highlighted.
export function splitMentions(
  body: string,
  knownUsernames: readonly string[],
  myUsername: string,
  allowAll: boolean,
): BodySegment[] {
  const regex = buildMentionRegExp(candidatesFor(knownUsernames, myUsername, allowAll));
  if (regex === null) return [{ kind: 'text', text: body, start: 0 }];

  const segments: BodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(regex)) {
    const token = match[1] ?? '';
    const isMine = token === myUsername || (allowAll && token === 'all');
    if (!isMine) continue;
    const start = match.index;
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: body.slice(lastIndex, start), start: lastIndex });
    }
    segments.push({ kind: 'mention', text: `@${token}`, start });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: 'text', text: body.slice(lastIndex), start: lastIndex });
  }
  return segments.length > 0 ? segments : [{ kind: 'text', text: body, start: 0 }];
}

export function mentionsMe(
  body: string,
  knownUsernames: readonly string[],
  myUsername: string,
  allowAll: boolean,
): boolean {
  return splitMentions(body, knownUsernames, myUsername, allowAll).some(
    (segment) => segment.kind === 'mention',
  );
}
