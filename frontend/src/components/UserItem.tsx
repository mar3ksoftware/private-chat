import type { UserInfo } from '../types';

type UserItemProps = {
  readonly user: UserInfo;
  readonly isSelected: boolean;
  readonly onSelect: (username: string) => void;
};

export function UserItem({ user, isSelected, onSelect }: UserItemProps) {
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
      <span className="text-sm font-medium text-zinc-100 truncate">{user.username}</span>
    </button>
  );
}
