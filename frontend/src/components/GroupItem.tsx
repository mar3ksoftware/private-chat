import type { GroupInfo } from '../types';

type GroupItemProps = {
  readonly group: GroupInfo;
  readonly isSelected: boolean;
  readonly onSelect: (groupId: string) => void;
};

export function GroupItem({ group, isSelected, onSelect }: GroupItemProps) {
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
    </button>
  );
}
