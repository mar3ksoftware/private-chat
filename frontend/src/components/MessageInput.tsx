import type { ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { CONSTANTS } from '../types';
import { EmojiPicker } from './EmojiPicker';

type MessageInputProps = {
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onAttach: (file: File) => Promise<boolean>;
  readonly disabled: boolean;
};

export function MessageInput({ onSend, onAttach, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAttaching, setIsAttaching] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleAttach = useCallback(
    async (file: File) => {
      if (disabled || isSending) return;

      setIsSending(true);
      setIsAttaching(true);
      setSendError(null);
      try {
        const sent = await onAttach(file);
        if (!sent) {
          setSendError('Message not sent. Please try again.');
        }
      } catch {
        setSendError('Message not sent. Please try again.');
      } finally {
        setIsAttaching(false);
        setIsSending(false);
      }
    },
    [disabled, isSending, onAttach],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      if (file === undefined) return;
      // Reset after the attempt so picking the same file twice still fires.
      void handleAttach(file).finally(() => {
        input.value = '';
      });
    },
    [handleAttach],
  );

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
      {isAttaching ? (
        <p className="text-xs text-zinc-400 px-1">Uploading…</p>
      ) : (
        sendError !== null && <p className="text-xs text-rose-400 px-1">{sendError}</p>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || isSending}
          aria-label="Attach file"
          className="text-zinc-400 hover:text-zinc-200 transition-colors p-2 disabled:opacity-50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={handleFileChange}
          disabled={disabled || isSending}
        />
        <EmojiPicker onEmojiSelect={handleEmojiSelect} />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSending}
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
