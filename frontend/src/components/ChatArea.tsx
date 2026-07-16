import { useChat } from '../context/ChatContext';
import { ChatHeader } from './ChatHeader';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';

type ChatAreaProps = {
  readonly selectedUser: string | null;
  readonly selectedGroup: string | null;
  readonly onBack?: (() => void) | undefined;
  readonly showBack?: boolean | undefined;
};

export function ChatArea({ selectedUser, selectedGroup, onBack, showBack }: ChatAreaProps) {
  const { users, messages, sendMessage, groupMessages, groups, sendGroupMessage, logout } =
    useChat();

  const selectedUserInfo =
    selectedUser !== null ? users.find((u) => u.username === selectedUser) : undefined;
  const selectedUserId = selectedUserInfo?.userId;

  const selectedGroupInfo =
    selectedGroup !== null ? groups.find((g) => g.groupId === selectedGroup) : undefined;

  const filteredMessages =
    selectedUser !== null && selectedUserId !== undefined
      ? messages.filter((m) => m.fromUsername === selectedUser || m.to === selectedUserId)
      : selectedGroup !== null
        ? groupMessages.filter((m) => m.groupId === selectedGroup)
        : [];

  const handleSend = (text: string) => {
    if (selectedUser !== null) {
      void sendMessage(selectedUser, text);
    } else if (selectedGroup !== null) {
      void sendGroupMessage(selectedGroup, text);
    }
  };

  const displayName = selectedGroupInfo?.name ?? selectedUser;

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <ChatHeader
        username={displayName}
        subtitle={selectedGroupInfo !== null ? 'Group' : undefined}
        onLogout={logout}
        onBack={onBack}
        showBack={showBack}
      />
      {displayName === undefined ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-zinc-500 text-sm">Select a conversation</p>
        </div>
      ) : (
        <>
          <MessageList messages={filteredMessages} selectedUser={selectedUser} />
          <MessageInput onSend={handleSend} disabled={false} />
        </>
      )}
    </div>
  );
}
