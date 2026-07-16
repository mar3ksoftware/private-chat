import type { KeyboardEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { EmojiPicker } from './EmojiPicker';

type MessageInputProps = {
  readonly onSend: (text: string) => void;
  readonly disabled: boolean;
};

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || disabled) return;
    onSend(trimmed);
    setText('');
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleEmojiSelect = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
    inputRef.current?.focus();
  }, []);

  const isDisabled = disabled || text.trim().length === 0;

  return (
    <div className="flex items-end gap-2 p-4 border-t border-zinc-800/50">
      <EmojiPicker onEmojiSelect={handleEmojiSelect} />
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Type a message..."
        className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 flex-1"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={isDisabled}
        className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-4 py-3 transition-colors disabled:opacity-50 text-sm font-medium"
      >
        Send
      </button>
    </div>
  );
}
