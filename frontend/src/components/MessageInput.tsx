import type { KeyboardEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { CONSTANTS } from '../types';
import { EmojiPicker } from './EmojiPicker';

type MessageInputProps = {
  readonly onSend: (text: string) => Promise<boolean>;
  readonly disabled: boolean;
};

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || disabled || isSending) return;

    setIsSending(true);
    setSendError(null);
    try {
      const sent = await onSend(trimmed);
      if (sent) {
        setText('');
      } else {
        setSendError('Message not sent. Please try again.');
      }
    } catch {
      setSendError('Message not sent. Please try again.');
    } finally {
      setIsSending(false);
    }
  }, [text, disabled, isSending, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleEmojiSelect = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
    inputRef.current?.focus();
  }, []);

  const isDisabled = disabled || isSending || text.trim().length === 0;

  return (
    <div className="flex flex-col gap-1 p-4 border-t border-zinc-800/50">
      {sendError !== null && <p className="text-xs text-rose-400 px-1">{sendError}</p>}
      <div className="flex items-end gap-2">
        <EmojiPicker onEmojiSelect={handleEmojiSelect} />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={CONSTANTS.MAX_MESSAGE_LENGTH}
          placeholder={disabled ? 'Disconnected...' : 'Type a message...'}
          className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 flex-1"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={isDisabled}
          className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-4 py-3 transition-colors disabled:opacity-50 text-sm font-medium"
        >
          Send
        </button>
      </div>
    </div>
  );
}
