import { useState } from 'react';
import { useChat } from '../context/ChatContext';
import { CreateGroupModal } from './CreateGroupModal';
import { GroupList } from './GroupList';
import { UserList } from './UserList';

type SidebarProps = {
  readonly selectedUser: string | null;
  readonly onSelectUser: (username: string) => void;
  readonly selectedGroup: string | null;
  readonly onSelectGroup: (groupId: string) => void;
};

type EphemeralBannerProps = {
  readonly error: string | null;
  readonly connectionStatus: 'connecting' | 'connected' | 'disconnected';
};

function EphemeralBanner({ error, connectionStatus }: EphemeralBannerProps) {
  if (error === null && connectionStatus === 'connected') return null;

  return (
    <div className="mx-3 mt-3 shrink-0 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
      <p className="break-words text-xs text-amber-400">{error ?? `Status: ${connectionStatus}`}</p>
    </div>
  );
}

export function Sidebar({
  selectedUser,
  onSelectUser,
  selectedGroup,
  onSelectGroup,
}: SidebarProps) {
  const { user, users, groups, error, connectionStatus } = useChat();
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'groups'>('users');

  // The tab counter must match what UserList shows (it excludes the current user).
  const otherUsers =
    user === null ? users : users.filter((candidate) => candidate.username !== user.username);

  return (
    <div className="glass flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/50 px-4 py-3 sm:px-6 sm:py-4">
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
          className="shrink-0 text-indigo-400"
          aria-hidden="true"
        >
          <title>Lock</title>
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h1 className="truncate text-lg font-semibold text-zinc-100">Scattered Keyhole</h1>
      </div>

      <EphemeralBanner error={error} connectionStatus={connectionStatus} />

      <div className="flex shrink-0 border-b border-zinc-800/50">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          aria-pressed={activeTab === 'users'}
          className={`min-h-10 flex-1 touch-manipulation px-2 py-2 text-xs font-medium transition-colors ${
            activeTab === 'users'
              ? 'border-b-2 border-indigo-400 text-indigo-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Users ({otherUsers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('groups')}
          aria-pressed={activeTab === 'groups'}
          className={`min-h-10 flex-1 touch-manipulation px-2 py-2 text-xs font-medium transition-colors ${
            activeTab === 'groups'
              ? 'border-b-2 border-indigo-400 text-indigo-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Groups ({groups.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <UserList users={otherUsers} selectedUser={selectedUser} onSelectUser={onSelectUser} />
      ) : (
        <>
          <div className="shrink-0 px-3 pt-3 pb-2">
            <button
              type="button"
              onClick={() => setShowCreateGroup(true)}
              className="min-h-10 w-full touch-manipulation rounded-lg bg-indigo-600/20 px-3 py-2 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-600/30"
            >
              + Create Group
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-1">
            <GroupList
              groups={groups}
              selectedGroup={selectedGroup}
              onSelectGroup={onSelectGroup}
            />
          </div>
        </>
      )}

      <div className="mt-auto shrink-0 border-t border-zinc-800/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="min-w-0 truncate text-sm font-medium text-zinc-100"
            title={user?.username}
          >
            {user?.username ?? '...'}
          </span>
          <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {user?.isGuest === true ? 'Guest' : 'Account'}
          </span>
        </div>
      </div>

      <CreateGroupModal isOpen={showCreateGroup} onClose={() => setShowCreateGroup(false)} />
    </div>
  );
}
