import type { UserInfo } from '../types';
import { UserItem } from './UserItem';

type UserListProps = {
  readonly users: readonly UserInfo[];
  readonly selectedUser: string | null;
  readonly onSelectUser: (username: string) => void;
};

export function UserList({ users, selectedUser, onSelectUser }: UserListProps) {
  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Online</span>
        <span className="text-xs font-medium text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
          {users.length}
        </span>
      </div>
      {users.length === 0 ? (
        <p className="px-3 py-4 text-sm text-zinc-500">No other users online</p>
      ) : (
        <div className="flex flex-col gap-1 px-2">
          {users.map((user) => (
            <UserItem
              key={user.userId}
              user={user}
              isSelected={selectedUser === user.username}
              onSelect={onSelectUser}
            />
          ))}
        </div>
      )}
    </div>
  );
}
