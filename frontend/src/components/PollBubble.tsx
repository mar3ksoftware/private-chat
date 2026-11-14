import { useChat } from '../context/ChatContext';
import type { ConversationTarget, DecryptedGroupMessage, DecryptedMessage } from '../types';

type PollBubbleProps = {
  readonly message: DecryptedMessage | DecryptedGroupMessage;
  readonly target: ConversationTarget;
};

// Spec D: `0 votes` / `1 vote` / `N votes`.
function formatVoteCount(total: number): string {
  if (total === 1) return '1 vote';
  return `${total} votes`;
}

export function PollBubble({ message, target }: PollBubbleProps) {
  const { user, polls, votePoll, closePoll } = useChat();

  const poll = message.poll;
  if (poll === null) return null;

  const state = polls[message.id] ?? { tallies: {}, closed: false };
  const { tallies, closed } = state;
  const total = Object.keys(tallies).length;
  const myVote = user !== null ? tallies[user.username] : undefined;
  // Tombstoned polls never render here; a closed one keeps its tallies but
  // disables every voting control (C3/C4).
  const canVote = !closed && !message.deleted;
  const canClose = message.isOwn && !closed && !message.deleted;

  return (
    <div className="flex min-w-56 flex-col gap-2">
      <p className="text-sm font-semibold break-words">{poll.question}</p>

      <div className="flex flex-col gap-1.5">
        {poll.options.map((option, index) => {
          let votes = 0;
          for (const choice of Object.values(tallies)) {
            if (choice === index) votes += 1;
          }
          const percent = total === 0 ? 0 : Math.round((votes / total) * 100);
          const mine = myVote === index;
          return (
            <button
              key={option}
              type="button"
              onClick={() => votePoll(target, message.id, index)}
              disabled={!canVote}
              className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default ${
                mine
                  ? 'border-indigo-300/80 bg-indigo-400/30'
                  : 'border-white/10 bg-black/20 hover:border-white/25 hover:bg-black/30'
              } ${closed ? 'opacity-75' : ''}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className={`min-w-0 break-words text-sm ${mine ? 'font-medium' : ''}`}>
                  {option}
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums">{percent}%</span>
              </span>
              <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-black/30">
                <span
                  className="block h-full rounded-full bg-indigo-300/90"
                  style={{ width: `${percent}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-0.5 text-xs">
        <span>{formatVoteCount(total)}</span>
        {/* An extra footer line — the vote count above stays (C4). */}
        {closed && <span className="font-medium">Poll closed</span>}
      </div>

      {canClose && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => closePoll(target, message.id)}
            className="rounded-md border border-white/25 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/10"
          >
            Close poll
          </button>
        </div>
      )}
    </div>
  );
}
