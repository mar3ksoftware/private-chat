import { useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { ChatHeader } from './ChatHeader';
import { GroupMembersPanel } from './GroupMembersPanel';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';

type ChatAreaProps = {
  readonly selectedUser: string | null;
  readonly selectedGroup: string | null;
  readonly onBack?: (() => void) | undefined;
  readonly showBack?: boolean | undefined;
};

export function ChatArea({ selectedUser, selectedGroup, onBack, showBack }: ChatAreaProps) {
  const {
    messages,
    sendMessage,
    sendMediaMessage,
    groupMessages,
    groups,
    sendGroupMessage,
    sendGroupMediaMessage,
    logout,
    connectionStatus,
  } = useChat();
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    // The drawer hides itself whenever no group is selected, so only a switch
    // between conversations needs an actual reset.
    if (selectedGroup !== null) {
      setShowMembers(false);
    }
  }, [selectedGroup]);

  const selectedGroupInfo =
    selectedGroup !== null ? groups.find((g) => g.groupId === selectedGroup) : undefined;

  // The peer may be offline, so match by username instead of requiring them to
  // be present in the active user list.
  const filteredMessages =
    selectedUser !== null
      ? messages.filter((m) => m.fromUsername === selectedUser || m.toUsername === selectedUser)
      : selectedGroup !== null
        ? groupMessages.filter((m) => m.groupId === selectedGroup)
        : [];

  const handleSend = (text: string): Promise<boolean> => {
    if (selectedUser !== null) {
      return sendMessage(selectedUser, text);
    }
    if (selectedGroup !== null) {
      return sendGroupMessage(selectedGroup, text);
    }
    return Promise.resolve(false);
  };

  const handleAttach = (file: File): Promise<boolean> => {
    if (selectedUser !== null) {
      return sendMediaMessage(selectedUser, file);
    }
    if (selectedGroup !== null) {
      return sendGroupMediaMessage(selectedGroup, file);
    }
    return Promise.resolve(false);
  };

  const displayName = selectedGroupInfo?.name ?? selectedUser;

  return (
    <div className="relative flex flex-col h-full bg-zinc-950">
      <ChatHeader
        username={displayName}
        subtitle={selectedGroupInfo !== undefined ? 'Group' : undefined}
        onLogout={logout}
        onBack={onBack}
        showBack={showBack}
        onMembersClick={
          selectedGroupInfo !== undefined ? () => setShowMembers((v) => !v) : undefined
        }
      />
      {displayName == null ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-zinc-500 text-sm">Select a conversation</p>
        </div>
      ) : (
        <>
          <MessageList messages={filteredMessages} />
          <MessageInput
            onSend={handleSend}
            onAttach={handleAttach}
            disabled={connectionStatus !== 'connected'}
          />
        </>
      )}
      {showMembers && selectedGroupInfo !== undefined && (
        <GroupMembersPanel group={selectedGroupInfo} onClose={() => setShowMembers(false)} />
      )}
    </div>
  );
}
