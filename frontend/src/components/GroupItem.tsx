import { useChat } from '../context/ChatContext';
import type { GroupInfo } from '../types';

type GroupItemProps = {
  readonly group: GroupInfo;
  readonly isSelected: boolean;
  readonly onSelect: (groupId: string) => void;
};

export function GroupItem({ group, isSelected, onSelect }: GroupItemProps) {
  const { unread } = useChat();
  const entry = unread[`group:${group.groupId}`];
  const count = entry?.count ?? 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(group.groupId)}
      className={`flex items-center gap-3 px-4 py-2.5 text-left transition-colors rounded-lg mx-2 ${
        isSelected
          ? 'bg-indigo-600/20 text-indigo-300'
          : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100'
      }`}
    >
      <span className="text-lg">#</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{group.name}</p>
        <p className="text-xs text-zinc-500">{group.members.length} members</p>
      </div>
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
