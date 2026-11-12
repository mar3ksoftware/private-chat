import { useCallback, useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { ChatArea } from './ChatArea';
import { Sidebar } from './Sidebar';

export function ChatLayout() {
  const { setOpenConversation } = useChat();
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

  // Unread/read-receipt logic keys off the conversation that is actually on
  // screen, so mirror the visible selection here.
  useEffect(() => {
    if (mobileView !== 'chat') {
      setOpenConversation(null);
    } else if (selectedUser !== null) {
      setOpenConversation({ kind: 'dm', username: selectedUser });
    } else if (selectedGroup !== null) {
      setOpenConversation({ kind: 'group', groupId: selectedGroup });
    } else {
      setOpenConversation(null);
    }
  }, [mobileView, selectedUser, selectedGroup, setOpenConversation]);

  return (
    <div className="app-shell flex bg-zinc-950">
      <div
        className={`${
          mobileView === 'sidebar' ? 'flex' : 'hidden'
        } min-h-0 w-full shrink-0 flex-col border-r border-zinc-800/50 md:flex md:w-72`}
      >
        <Sidebar
          selectedUser={selectedUser}
          onSelectUser={handleSelectUser}
          selectedGroup={selectedGroup}
          onSelectGroup={handleSelectGroup}
        />
      </div>
      <div
        className={`${
          mobileView === 'chat' ? 'flex' : 'hidden'
        } min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex`}
      >
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
