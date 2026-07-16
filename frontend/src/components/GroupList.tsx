import type { GroupInfo } from '../types';
import { GroupItem } from './GroupItem';

type GroupListProps = {
  readonly groups: readonly GroupInfo[];
  readonly selectedGroup: string | null;
  readonly onSelectGroup: (groupId: string) => void;
};

export function GroupList({ groups, selectedGroup, onSelectGroup }: GroupListProps) {
  if (groups.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-xs text-zinc-500">No groups yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      {groups.map((group) => (
        <GroupItem
          key={group.groupId}
          group={group}
          isSelected={group.groupId === selectedGroup}
          onSelect={onSelectGroup}
        />
      ))}
    </div>
  );
}
