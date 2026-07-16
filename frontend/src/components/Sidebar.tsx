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
    <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
      <p className="text-xs text-amber-400">{error ?? `Status: ${connectionStatus}`}</p>
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

  return (
    <div className="glass flex flex-col h-full w-72">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-zinc-800/50">
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
          className="text-indigo-400 shrink-0"
          aria-hidden="true"
        >
          <title>Lock</title>
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h1 className="text-lg font-semibold text-zinc-100">Private Chat</h1>
      </div>

      <EphemeralBanner error={error} connectionStatus={connectionStatus} />

      <div className="flex border-b border-zinc-800/50">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'users'
              ? 'text-indigo-400 border-b-2 border-indigo-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Users ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('groups')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'groups'
              ? 'text-indigo-400 border-b-2 border-indigo-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Groups ({groups.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <UserList users={users} selectedUser={selectedUser} onSelectUser={onSelectUser} />
      ) : (
        <>
          <div className="px-3 pt-3">
            <button
              type="button"
              onClick={() => setShowCreateGroup(true)}
              className="w-full bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
            >
              + Create Group
            </button>
          </div>
          <GroupList groups={groups} selectedGroup={selectedGroup} onSelectGroup={onSelectGroup} />
        </>
      )}

      <div className="border-t border-zinc-800/50 px-4 py-3 mt-auto">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100">{user?.username ?? '...'}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
            {user?.isGuest === true ? 'Guest' : 'Account'}
          </span>
        </div>
      </div>

      <CreateGroupModal isOpen={showCreateGroup} onClose={() => setShowCreateGroup(false)} />
    </div>
  );
}
