import { useCallback, useState } from 'react';
import { ChatArea } from './ChatArea';
import { Sidebar } from './Sidebar';

export function ChatLayout() {
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'sidebar' | 'chat'>('sidebar');

  const handleSelectUser = useCallback((username: string) => {
    setSelectedUser(username);
    setSelectedGroup(null);
    setMobileView('chat');
  }, []);

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroup(groupId);
    setSelectedUser(null);
    setMobileView('chat');
  }, []);

  const handleBack = useCallback(() => {
    setMobileView('sidebar');
  }, []);

  return (
    <div className="flex h-screen bg-zinc-950">
      <div
        className={`${mobileView === 'sidebar' ? 'flex' : 'hidden'} md:flex w-72 border-r border-zinc-800/50 shrink-0`}
      >
        <Sidebar
          selectedUser={selectedUser}
          onSelectUser={handleSelectUser}
          selectedGroup={selectedGroup}
          onSelectGroup={handleSelectGroup}
        />
      </div>
      <div className={`${mobileView === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 min-w-0`}>
        <ChatArea
          selectedUser={selectedUser}
          selectedGroup={selectedGroup}
          onBack={handleBack}
          showBack={mobileView === 'chat'}
        />
      </div>
    </div>
  );
}
