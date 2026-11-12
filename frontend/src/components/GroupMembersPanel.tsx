import { useState } from 'react';
import { useChat } from '../context/ChatContext';
import type { GroupInfo } from '../types';

type GroupMembersPanelProps = {
  readonly group: GroupInfo;
  readonly onClose?: (() => void) | undefined;
};

function PresenceDot({ online }: { readonly online: boolean }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400'}`}
      aria-hidden="true"
    />
  );
}

function PresenceBadge({ online }: { readonly online: boolean }) {
  if (online) {
    return (
      <span
        role="img"
        aria-label="Online"
        className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-500"
      />
    );
  }
  return <span className="ml-auto text-xs text-zinc-500">offline</span>;
}

export function GroupMembersPanel({ group, onClose }: GroupMembersPanelProps) {
  const { user, users, directory, kickTallies, addMember, removeMember, voteKick, displayNameOf } =
    useChat();
  const [addQuery, setAddQuery] = useState('');

  const myMembership =
    user === null ? undefined : group.members.find((m) => m.userId === user.userId);
  const iAmAdmin = myMembership?.isAdmin === true;
  const tally = kickTallies.find((t) => t.groupId === group.groupId);
  const activeTally = tally?.status === 'active' ? tally : undefined;
  const memberNames = new Set(group.members.map((m) => m.username));
  const isOnline = (username: string) => users.some((u) => u.username === username);

  const query = addQuery.trim().toLowerCase();
  const candidates = directory.filter(
    (name) =>
      !memberNames.has(name) && name !== user?.username && name.toLowerCase().includes(query),
  );

  return (
    <aside className="absolute inset-y-0 right-0 z-30 w-full max-w-xs overflow-y-auto border-l border-zinc-800/50 bg-zinc-950/95 p-4 backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-100">Members ({group.members.length})</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close members"
          className="-mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {tally !== undefined && (
        <div className="mb-4 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-100">{tally.username}</p>
              <p className="text-xs text-zinc-500">
                {tally.votes.length}/{tally.required}
              </p>
            </div>
            {tally.status === 'active' &&
              (user !== null && tally.votes.includes(user.username) ? (
                <button
                  type="button"
                  disabled
                  className="shrink-0 cursor-default rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-300 opacity-60"
                >
                  Voted
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => voteKick(group.groupId, tally.username)}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
                >
                  Vote
                </button>
              ))}
          </div>
          <p
            className={`mt-2 text-xs ${
              tally.status === 'active'
                ? 'text-zinc-400'
                : tally.status === 'passed'
                  ? 'text-emerald-400'
                  : 'text-zinc-500'
            }`}
          >
            {tally.status === 'active'
              ? `${tally.votes.length} votes — needs ${tally.required}`
              : tally.status === 'passed'
                ? 'Vote passed'
                : 'Vote failed'}
          </p>
        </div>
      )}

      <ul className="mb-4 flex flex-col gap-1">
        {group.members.map((member) => (
          <li
            key={member.userId}
            className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-zinc-800/40"
          >
            <PresenceDot online={isOnline(member.username)} />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
              {displayNameOf(member.username)}
              {displayNameOf(member.username) !== member.username && (
                <span className="ml-1.5 text-xs text-zinc-500">{member.username}</span>
              )}
            </span>
            {member.isAdmin && (
              <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-400">
                admin
              </span>
            )}
            {iAmAdmin && member.userId !== group.createdBy && member.userId !== user?.userId && (
              <button
                type="button"
                onClick={() => removeMember(group.groupId, member.username)}
                className="shrink-0 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Remove
              </button>
            )}
            {activeTally === undefined &&
              member.userId !== group.createdBy &&
              member.userId !== user?.userId && (
                <button
                  type="button"
                  onClick={() => voteKick(group.groupId, member.username)}
                  className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
                >
                  Vote kick
                </button>
              )}
          </li>
        ))}
      </ul>

      {iAmAdmin && (
        <div>
          <span className="mb-2 block text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Add member
          </span>
          <input
            type="text"
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            placeholder="Add member…"
            className="mb-2 w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          {candidates.length === 0 ? (
            <p className="text-sm text-zinc-500">No users to add</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {candidates.map((name) => (
                <li
                  key={name}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-zinc-800/40"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{name}</span>
                  <PresenceBadge online={isOnline(name)} />
                  <button
                    type="button"
                    onClick={() => addMember(group.groupId, name)}
                    aria-label={`Add ${name}`}
                    className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
