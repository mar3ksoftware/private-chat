import { useChat } from '../context/ChatContext';
import type { UserInfo } from '../types';

type UserItemProps = {
  readonly user: UserInfo;
  readonly isSelected: boolean;
  readonly onSelect: (username: string) => void;
};

export function UserItem({ user, isSelected, onSelect }: UserItemProps) {
  const { unread, displayNameOf } = useChat();
  const entry = unread[`dm:${user.username}`];
  const count = entry?.count ?? 0;
  const displayName = displayNameOf(user.username);

  return (
    <button
      type="button"
      onClick={() => onSelect(user.username)}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${
        isSelected
          ? 'bg-indigo-600/20 border-indigo-500/30'
          : 'hover:bg-zinc-800/50 border-transparent'
      }`}
    >
      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-zinc-100 truncate">{displayName}</span>
        {displayName !== user.username && (
          <span className="block text-xs text-zinc-500 truncate">{user.username}</span>
        )}
      </span>
      {count > 0 && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white ${
            entry?.mention === true ? 'bg-sky-500' : 'bg-indigo-500'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
