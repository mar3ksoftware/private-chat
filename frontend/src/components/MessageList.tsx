import { useEffect, useRef } from 'react';
import type { DecryptedGroupMessage, DecryptedMessage, ReplyRef } from '../types';
import { MessageBubble } from './MessageBubble';

type MessageListProps = {
  readonly messages: readonly (DecryptedMessage | DecryptedGroupMessage)[];
  readonly onReply: (reply: ReplyRef) => void;
};

export function MessageList({ messages, onReply }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom when message count changes
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Start of conversation</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          showSender={'groupId' in message}
          onReply={onReply}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
