import type { DecryptedGroupMessage, DecryptedMessage } from '../types';
import { LinkifiedText } from './LinkifiedText';
import { MediaAttachment } from './MediaAttachment';

type MessageBubbleProps = {
  readonly message: DecryptedMessage | DecryptedGroupMessage;
  readonly showSender?: boolean | undefined;
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function MessageBubble({ message, showSender }: MessageBubbleProps) {
  const content = message.decryptionFailed ? '[encrypted]' : message.plaintext;

  return (
    <div className={`flex flex-col gap-0.5 ${message.isOwn ? 'items-end' : 'items-start'}`}>
      {!message.isOwn && (showSender === true || 'groupId' in message) && (
        <span className="text-xs text-zinc-500 px-1">{message.fromUsername}</span>
      )}
      <div
        className={`max-w-[70%] px-4 py-2 ${
          message.isOwn
            ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md'
            : 'bg-zinc-800 text-zinc-100 rounded-2xl rounded-bl-md'
        }`}
      >
        {message.media != null && !message.decryptionFailed ? (
          <MediaAttachment descriptor={message.media} />
        ) : (
          <p className="text-sm break-words">
            {message.decryptionFailed ? content : <LinkifiedText text={content} />}
          </p>
        )}
      </div>
      <span className="text-xs text-zinc-500 px-1">{formatTime(message.timestamp)}</span>
    </div>
  );
}
