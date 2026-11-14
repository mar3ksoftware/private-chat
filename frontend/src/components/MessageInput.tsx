import type { ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import type { ReplyRef } from '../types';
import { CONSTANTS } from '../types';
import { EmojiPicker } from './EmojiPicker';

type MessageInputProps = {
  readonly onSend: (text: string, reply: ReplyRef | null) => Promise<boolean>;
  readonly onAttach: (file: File) => Promise<boolean>;
  readonly disabled: boolean;
  readonly reply: ReplyRef | null;
  readonly onClearReply: () => void;
  // Group members power the `@` autocomplete; omitted for DMs (C8).
  readonly mentionSuggestions?: readonly string[] | undefined;
  readonly onTyping: () => void;
  readonly onStopTyping: () => void;
};

// The caret sits inside an `@…` token when the text right before it starts
// with `@` at a word boundary.
function mentionTokenBefore(text: string, caret: number): { query: string; start: number } | null {
  const head = text.slice(0, caret);
  const match = /(?:^|\s)@([A-Za-z0-9_-]*)$/.exec(head);
  if (match === null) return null;
  const query = match[1] ?? '';
  return { query, start: caret - query.length - 1 };
}

export function MessageInput({
  onSend,
  onAttach,
  disabled,
  reply,
  onClearReply,
  mentionSuggestions,
  onTyping,
  onStopTyping,
}: MessageInputProps) {
  const { displayNameOf } = useChat();
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAttaching, setIsAttaching] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (mentionSuggestions === undefined) return [];
    const caret = inputRef.current?.selectionStart ?? text.length;
    const token = mentionTokenBefore(text, caret);
    if (token === null) return [];
    const query = token.query.toLowerCase();
    return mentionSuggestions.filter((name) => name.toLowerCase().startsWith(query)).slice(0, 6);
  }, [text, mentionSuggestions]);

  const applySuggestion = useCallback(
    (name: string) => {
      const caret = inputRef.current?.selectionStart ?? text.length;
      const token = mentionTokenBefore(text, caret);
      if (token === null) return;
      const next = `${text.slice(0, token.start)}@${name} ${text.slice(caret)}`;
      setText(next);
      setActiveSuggestion(0);
      requestAnimationFrame(() => {
        const position = token.start + name.length + 2;
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(position, position);
      });
    },
    [text],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setText(value);
      setActiveSuggestion(0);
      if (value.trim().length === 0) {
        onStopTyping();
      } else {
        onTyping();
      }
    },
    [onTyping, onStopTyping],
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || disabled || isSending) return;

    setIsSending(true);
    setSendError(null);
    try {
      const sent = await onSend(trimmed, reply);
      if (sent) {
        setText('');
        onClearReply();
        onStopTyping();
      } else {
        setSendError('Message not sent. Please try again.');
      }
    } catch {
      setSendError('Message not sent. Please try again.');
    } finally {
      setIsSending(false);
    }
  }, [text, disabled, isSending, onSend, reply, onClearReply, onStopTyping]);

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
        } else {
          onStopTyping();
        }
      } catch {
        setSendError('Message not sent. Please try again.');
      } finally {
        setIsAttaching(false);
        setIsSending(false);
      }
    },
    [disabled, isSending, onAttach, onStopTyping],
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
    (event: KeyboardEvent<HTMLInputElement>) => {
      const popupOpen = suggestions.length > 0;
      if (popupOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setActiveSuggestion((index) => {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const next = (index + delta + suggestions.length) % suggestions.length;
          return next;
        });
        return;
      }
      if (popupOpen && (event.key === 'Enter' || event.key === 'Tab')) {
        const picked = suggestions[activeSuggestion];
        if (picked !== undefined) {
          event.preventDefault();
          applySuggestion(picked);
        }
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [suggestions, activeSuggestion, applySuggestion, handleSend],
  );

  const handleBlur = useCallback(() => {
    // The popup may be re-opened by the next keystroke; the burst itself
    // stops when the composer loses focus (C1).
    onStopTyping();
  }, [onStopTyping]);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      setText((prev) => prev + emoji);
      onTyping();
      inputRef.current?.focus();
    },
    [onTyping],
  );

  const isDisabled = disabled || isSending || text.trim().length === 0;

  return (
    <div className="flex flex-col gap-1 p-4 border-t border-zinc-800/50">
      {reply !== null && (
        <div className="flex items-start gap-2 rounded-lg border-l-2 border-indigo-400 bg-zinc-800/40 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-indigo-300">{displayNameOf(reply.u)}</p>
            <p className="truncate text-xs text-zinc-400">{reply.e}</p>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            aria-label="Cancel reply"
            className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700/60 hover:text-zinc-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      )}
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
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={disabled || isSending}
            maxLength={CONSTANTS.MAX_MESSAGE_LENGTH}
            placeholder={disabled ? 'Disconnected...' : 'Type a message...'}
            className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          {suggestions.length > 0 && (
            <ul className="absolute bottom-full left-0 z-40 mb-2 w-56 max-h-48 overflow-y-auto rounded-lg border border-zinc-700/70 bg-zinc-900 p-1 shadow-xl">
              {suggestions.map((name, index) => (
                <li key={name}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySuggestion(name);
                    }}
                    className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                      index === activeSuggestion
                        ? 'bg-indigo-600/40 text-white'
                        : 'text-zinc-300 hover:bg-zinc-800/70'
                    }`}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
