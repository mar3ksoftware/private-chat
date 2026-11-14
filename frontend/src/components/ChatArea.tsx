import { useEffect, useMemo, useState } from 'react';
import { useChat } from '../context/ChatContext';
import type { ConversationTarget, ReplyRef } from '../types';
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
    user,
    typing,
    profiles,
    displayNameOf,
    sendTyping,
    stopTyping,
  } = useChat();
  const [showMembers, setShowMembers] = useState(false);
  const [reply, setReply] = useState<ReplyRef | null>(null);

  useEffect(() => {
    // The drawer hides itself whenever no group is selected, so only a switch
    // between conversations needs an actual reset.
    if (selectedGroup !== null) {
      setShowMembers(false);
    }
  }, [selectedGroup]);

  // Conversation switched (C1): drop any live typing burst and pending reply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on conversation switch
  useEffect(() => {
    setReply(null);
    stopTyping();
  }, [selectedUser, selectedGroup, stopTyping]);

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

  const conversationTarget: ConversationTarget | null =
    selectedUser !== null
      ? { kind: 'dm', username: selectedUser }
      : selectedGroup !== null
        ? { kind: 'group', groupId: selectedGroup }
        : null;

  const handleSend = (text: string, pendingReply: ReplyRef | null): Promise<boolean> => {
    if (selectedUser !== null) {
      return sendMessage(selectedUser, text, pendingReply);
    }
    if (selectedGroup !== null) {
      return sendGroupMessage(selectedGroup, text, pendingReply);
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

  const handleTyping = () => {
    if (conversationTarget !== null) sendTyping(conversationTarget);
  };

  // Typing line names use the display-name fallback (spec D).
  const typingNames = useMemo(() => {
    const names: string[] = [];
    if (selectedUser !== null) {
      if (`dm:${selectedUser}` in typing) names.push(displayNameOf(selectedUser));
    } else if (selectedGroup !== null && selectedGroupInfo !== undefined) {
      for (const member of selectedGroupInfo.members) {
        if (member.username === user?.username) continue;
        if (`group:${selectedGroup}:${member.username}` in typing) {
          names.push(displayNameOf(member.username));
        }
      }
    }
    return names;
  }, [typing, selectedUser, selectedGroup, selectedGroupInfo, user, displayNameOf]);

  // DM header: display name with username fallback; status as subtitle when
  // non-empty (C9). Group header keeps the group name.
  const dmDisplayName = selectedUser !== null ? displayNameOf(selectedUser) : null;
  const dmStatus = selectedUser !== null ? (profiles[selectedUser]?.status ?? '') : '';
  const displayName = selectedGroupInfo?.name ?? dmDisplayName;
  const subtitle =
    selectedGroupInfo !== undefined ? 'Group' : dmStatus.length > 0 ? dmStatus : undefined;

  const mentionSuggestions =
    selectedGroupInfo !== undefined ? selectedGroupInfo.members.map((m) => m.username) : undefined;

  return (
    <div className="relative flex flex-col h-full bg-zinc-950">
      <ChatHeader
        username={displayName}
        subtitle={subtitle}
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
          <MessageList messages={filteredMessages} onReply={setReply} />
          <div className="min-h-6 px-5 pt-1 text-xs text-zinc-500" aria-live="polite">
            {typingNames.length > 0 && `${typingNames.join(', ')} is typing…`}
          </div>
          <MessageInput
            onSend={handleSend}
            onAttach={handleAttach}
            disabled={connectionStatus !== 'connected'}
            reply={reply}
            onClearReply={() => setReply(null)}
            mentionSuggestions={mentionSuggestions}
            onTyping={handleTyping}
            onStopTyping={stopTyping}
          />
        </>
      )}
      {showMembers && selectedGroupInfo !== undefined && (
        <GroupMembersPanel group={selectedGroupInfo} onClose={() => setShowMembers(false)} />
      )}
    </div>
  );
}
