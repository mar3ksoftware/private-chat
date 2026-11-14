import type { ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { formatVoiceTime } from '../lib/time';
import type { ReplyRef } from '../types';
import { CONSTANTS } from '../types';
import { EmojiPicker } from './EmojiPicker';

type MessageInputProps = {
  readonly onSend: (text: string, reply: ReplyRef | null) => Promise<boolean>;
  readonly onAttach: (file: File) => Promise<boolean>;
  readonly onSendPoll: (question: string, options: readonly string[]) => Promise<boolean>;
  readonly onSendVoice: (file: File, durationSeconds: number) => Promise<boolean>;
  readonly disabled: boolean;
  readonly reply: ReplyRef | null;
  readonly onClearReply: () => void;
  // Group members power the `@` autocomplete; omitted for DMs (C8).
  readonly mentionSuggestions?: readonly string[] | undefined;
  readonly onTyping: () => void;
  readonly onStopTyping: () => void;
};

const MAX_POLL_OPTIONS = 10;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_QUESTION = 200;
const MAX_POLL_OPTION = 60;
// Voice cap: the recorder stops and sends itself at this point (C6).
const MAX_VOICE_SECONDS = 300;

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
  onSendPoll,
  onSendVoice,
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

  // ── Poll composer (C1) ──
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<{ id: number; value: string }[]>([
    { id: 0, value: '' },
    { id: 1, value: '' },
  ]);
  const nextPollOptionIdRef = useRef(2);
  const [pollSending, setPollSending] = useState(false);

  // ── Voice recorder (C6) ──
  const [recording, setRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSendRef = useRef(false);

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

  // ── Poll composer ──

  const trimmedQuestion = pollQuestion.trim();
  const trimmedOptions = pollOptions.map((row) => row.value.trim());
  const pollValid =
    trimmedQuestion.length >= 1 &&
    trimmedQuestion.length <= MAX_POLL_QUESTION &&
    trimmedOptions.length >= MIN_POLL_OPTIONS &&
    trimmedOptions.length <= MAX_POLL_OPTIONS &&
    trimmedOptions.every((option) => option.length >= 1 && option.length <= MAX_POLL_OPTION) &&
    new Set(trimmedOptions).size === trimmedOptions.length;

  const closePollPanel = useCallback(() => {
    setPollOpen(false);
    setPollQuestion('');
    nextPollOptionIdRef.current = 2;
    setPollOptions([
      { id: 0, value: '' },
      { id: 1, value: '' },
    ]);
  }, []);

  const handlePollSend = useCallback(async () => {
    if (!pollValid || pollSending || disabled) return;
    setPollSending(true);
    setSendError(null);
    try {
      const sent = await onSendPoll(trimmedQuestion, trimmedOptions);
      if (sent) {
        closePollPanel();
        onStopTyping();
      } else {
        setSendError('Message not sent. Please try again.');
      }
    } catch {
      setSendError('Message not sent. Please try again.');
    } finally {
      setPollSending(false);
    }
  }, [
    pollValid,
    pollSending,
    disabled,
    onSendPoll,
    trimmedQuestion,
    trimmedOptions,
    closePollPanel,
    onStopTyping,
  ]);

  // ── Voice recorder ──

  const clearRecordingTimers = useCallback(() => {
    if (recordTickRef.current !== null) {
      clearInterval(recordTickRef.current);
      recordTickRef.current = null;
    }
    if (autoStopRef.current !== null) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const releaseRecorder = useCallback(() => {
    clearRecordingTimers();
    const stream = streamRef.current;
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    recorderRef.current = null;
    setRecording(false);
    setRecordElapsed(0);
  }, [clearRecordingTimers]);

  const sendVoice = useCallback(
    async (file: File, durationSeconds: number) => {
      setIsSending(true);
      setSendError(null);
      try {
        const sent = await onSendVoice(file, durationSeconds);
        if (sent) {
          onStopTyping();
        } else {
          setSendError('Message not sent. Please try again.');
        }
      } catch {
        setSendError('Message not sent. Please try again.');
      } finally {
        setIsSending(false);
      }
    },
    [onSendVoice, onStopTyping],
  );

  const stopRecording = useCallback(
    (send: boolean) => {
      const recorder = recorderRef.current;
      if (recorder === null) return;
      pendingSendRef.current = send;
      clearRecordingTimers();
      if (recorder.state !== 'inactive') recorder.stop();
    },
    [clearRecordingTimers],
  );

  const startRecording = useCallback(async () => {
    if (disabled || isSending || recorderRef.current !== null) return;
    setSendError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setSendError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm';
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      for (const track of stream.getTracks()) track.stop();
      setSendError('Voice recording is not supported in this browser.');
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    const startedAt = Date.now();
    recorder.onstop = () => {
      const durationSeconds = (Date.now() - startedAt) / 1000;
      const shouldSend = pendingSendRef.current;
      pendingSendRef.current = false;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      releaseRecorder();
      if (!shouldSend || durationSeconds <= 0 || chunks.length === 0) return;
      const extension = mimeType === 'audio/mp4' ? 'm4a' : 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      const file = new File([blob], `voice.${extension}`, { type: mimeType });
      void sendVoice(file, Math.min(durationSeconds, MAX_VOICE_SECONDS));
    };

    recorder.start();
    recorderRef.current = recorder;
    streamRef.current = stream;
    setRecording(true);
    setRecordElapsed(0);
    recordTickRef.current = setInterval(() => {
      setRecordElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    autoStopRef.current = setTimeout(() => {
      stopRecording(true);
    }, MAX_VOICE_SECONDS * 1000);
  }, [disabled, isSending, releaseRecorder, sendVoice, stopRecording]);

  const cancelRecording = useCallback(() => {
    stopRecording(false);
  }, [stopRecording]);

  // Stop the microphone if the composer unmounts mid-recording.
  useEffect(() => {
    return () => {
      pendingSendRef.current = false;
      if (recordTickRef.current !== null) clearInterval(recordTickRef.current);
      if (autoStopRef.current !== null) clearTimeout(autoStopRef.current);
      const recorder = recorderRef.current;
      if (recorder !== null && recorder.state !== 'inactive') recorder.stop();
      const stream = streamRef.current;
      if (stream !== null) {
        for (const track of stream.getTracks()) track.stop();
      }
    };
  }, []);

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
      {pollOpen && (
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/70 p-3">
          <p className="mb-2 text-sm font-semibold text-zinc-200">Create poll</p>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={pollQuestion}
              onChange={(event) => setPollQuestion(event.target.value)}
              placeholder="Question"
              maxLength={MAX_POLL_QUESTION}
              disabled={pollSending}
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            {pollOptions.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.value}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPollOptions((previous) =>
                      previous.map((entry) => (entry.id === row.id ? { ...entry, value } : entry)),
                    );
                  }}
                  placeholder={`Option ${index + 1}`}
                  maxLength={MAX_POLL_OPTION}
                  disabled={pollSending}
                  className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                {pollOptions.length > MIN_POLL_OPTIONS && (
                  <button
                    type="button"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() =>
                      setPollOptions((previous) => previous.filter((entry) => entry.id !== row.id))
                    }
                    disabled={pollSending}
                    className="shrink-0 rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700/60 hover:text-zinc-200 disabled:opacity-50"
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
                )}
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setPollOptions((previous) => [
                    ...previous,
                    { id: nextPollOptionIdRef.current++, value: '' },
                  ])
                }
                disabled={pollOptions.length >= MAX_POLL_OPTIONS || pollSending}
                className="rounded-lg border border-zinc-600/70 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800/70 disabled:opacity-40"
              >
                Add option
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closePollPanel}
                  disabled={pollSending}
                  className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handlePollSend()}
                  disabled={!pollValid || pollSending}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isAttaching ? (
        <p className="text-xs text-zinc-400 px-1">Uploading…</p>
      ) : (
        sendError !== null && <p className="text-xs text-rose-400 px-1">{sendError}</p>
      )}
      {recording ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
          <span className="text-sm tabular-nums text-zinc-100">
            {formatVoiceTime(recordElapsed)}
          </span>
          <span className="text-xs text-zinc-400">Recording…</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
            >
              Send
            </button>
            <button
              type="button"
              onClick={cancelRecording}
              aria-label="Cancel recording"
              className="rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
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
          <button
            type="button"
            onClick={() => setPollOpen((open) => !open)}
            disabled={disabled || isSending}
            aria-label="Create poll"
            aria-expanded={pollOpen}
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
              <path d="M4 20h16" />
              <path d="M7 16V9" />
              <path d="M12 16V4" />
              <path d="M17 16v-5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={disabled || isSending}
            aria-label="Record voice message"
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
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <path d="M12 19v3" />
            </svg>
          </button>
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
      )}
    </div>
  );
}
