import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '../context/ChatContext';
import { replyExcerptFor } from '../lib/envelope';
import { splitMentions } from '../lib/mentions';
import type {
  ConversationTarget,
  DecryptedGroupMessage,
  DecryptedMessage,
  ReplyRef,
} from '../types';
import { REACTION_EMOJIS } from '../types';
import { LinkifiedText } from './LinkifiedText';
import { MediaAttachment } from './MediaAttachment';

type MessageBubbleProps = {
  readonly message: DecryptedMessage | DecryptedGroupMessage;
  readonly showSender?: boolean | undefined;
  readonly onReply: (reply: ReplyRef) => void;
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

type DeleteConfirmDialogProps = {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

function DeleteConfirmDialog({ onConfirm, onCancel }: DeleteConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete message for everyone?"
        className="glass w-full max-w-sm rounded-2xl p-6 border border-zinc-700/50"
      >
        <p className="text-base font-semibold text-zinc-100 mb-5">Delete message for everyone?</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="bg-rose-600 hover:bg-rose-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MessageBubble({ message, showSender, onReply }: MessageBubbleProps) {
  const {
    user,
    users,
    directory,
    reactions,
    readUpTo,
    displayNameOf,
    toggleReaction,
    editMessage,
    deleteMessage,
  } = useChat();

  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const isGroup = 'groupId' in message;
  const isDeleted = message.deleted;
  const isOwn = message.isOwn;
  const isMedia = message.media != null && !message.decryptionFailed;

  // The inline editor replaces the bubble body — focus it once it mounts.
  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  const target: ConversationTarget = isGroup
    ? { kind: 'group', groupId: message.groupId }
    : { kind: 'dm', username: isOwn ? message.toUsername : message.fromUsername };

  // Close the hover menu / quick picker when clicking away or pressing Escape.
  useEffect(() => {
    if (!menuOpen && !pickerOpen) return;
    const onDocumentPointer = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocumentPointer);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentPointer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, pickerOpen]);

  const canEdit = isOwn && !isDeleted && !isMedia && !message.decryptionFailed;
  const canDelete = isOwn && !isDeleted;
  const canReply = !isDeleted;
  const canReact = !isDeleted;

  const reactionAgg = reactions[message.id] ?? {};
  const pills = REACTION_EMOJIS.filter((emoji) => (reactionAgg[emoji] ?? []).length > 0);

  const knownUsernames = new Set(directory);
  for (const active of users) knownUsernames.add(active.username);
  const myUsername = user?.username ?? '';

  // Read ticks are DM-only: single check while sent, double check in accent
  // color once the peer's receipt covers this bubble (C2).
  let readState: 'sent' | 'read' | null = null;
  if (!isGroup && isOwn) {
    const upTo = readUpTo[message.toUsername] ?? 0;
    readState = upTo >= message.timestamp ? 'read' : 'sent';
  }

  const handleReply = () => {
    onReply({
      id: message.id,
      u: message.fromUsername,
      e: replyExcerptFor(message.body, message.media ?? null),
    });
    setMenuOpen(false);
    setPickerOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    toggleReaction(target, message.id, emoji);
    setPickerOpen(false);
    setMenuOpen(false);
  };

  const handlePillClick = (emoji: string) => {
    // Tapping an existing pill removes that reaction (C5); adding goes
    // through the quick picker.
    const reactors = reactionAgg[emoji] ?? [];
    if (reactors.includes(myUsername)) {
      toggleReaction(target, message.id, emoji);
    }
  };

  const startEdit = () => {
    setDraft(message.body);
    setEditing(true);
    setMenuOpen(false);
  };

  const submitEdit = async () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    const ok = await editMessage(target, message.id, trimmed, message.reply);
    if (ok) setEditing(false);
  };

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitEdit();
    } else if (event.key === 'Escape') {
      setEditing(false);
    }
  };

  const segments = isDeleted
    ? []
    : splitMentions(message.body, Array.from(knownUsernames), myUsername, isGroup);

  const menuItems = (
    <>
      <button
        type="button"
        onClick={handleReply}
        disabled={!canReply}
        className="w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 rounded-md disabled:opacity-40"
      >
        Reply
      </button>
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          setPickerOpen(true);
        }}
        disabled={!canReact}
        className="w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 rounded-md disabled:opacity-40"
      >
        React
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={startEdit}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 rounded-md"
        >
          Edit
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            setConfirmingDelete(true);
          }}
          className="w-full px-3 py-1.5 text-left text-sm text-rose-400 hover:bg-zinc-800/70 rounded-md"
        >
          Delete
        </button>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      className={`group flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}
    >
      {!isOwn && (showSender === true || isGroup) && (
        <span className="text-xs text-zinc-500 px-1">{message.fromUsername}</span>
      )}
      <div
        className={`max-w-[70%] px-4 py-2 ${
          isOwn
            ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md'
            : 'bg-zinc-800 text-zinc-100 rounded-2xl rounded-bl-md'
        }`}
      >
        {isDeleted ? (
          <p className="text-sm italic text-zinc-400/80">This message was deleted</p>
        ) : editing ? (
          <div className="min-w-56 flex flex-col gap-2">
            <textarea
              ref={editorRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={3}
              className="w-full resize-none rounded-lg bg-zinc-900/60 border border-zinc-600/60 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                aria-label="Cancel"
                className="rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700/60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitEdit()}
                aria-label="Save"
                className="flex items-center rounded-md bg-indigo-500 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-400 transition-colors"
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
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
            </div>
          </div>
        ) : isMedia ? (
          <MediaAttachment descriptor={message.media} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {message.reply !== null && (
              <div className="border-l-2 border-indigo-300/60 pl-2 text-xs text-zinc-300/80">
                <span className="font-medium">{displayNameOf(message.reply.u)}</span>
                <p className="line-clamp-2 break-words">{message.reply.e}</p>
              </div>
            )}
            <p className="text-sm break-words">
              {message.decryptionFailed
                ? '[encrypted]'
                : segments.map((segment) =>
                    segment.kind === 'mention' ? (
                      <span key={segment.start} className="text-sky-400 font-medium">
                        {segment.text}
                      </span>
                    ) : (
                      <LinkifiedText key={segment.start} text={segment.text} />
                    ),
                  )}
            </p>
          </div>
        )}
      </div>

      {/* Reaction pills sit directly below the bubble content (C5). */}
      {!isDeleted && pills.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {pills.map((emoji) => {
            const count = (reactionAgg[emoji] ?? []).length;
            const mine = (reactionAgg[emoji] ?? []).includes(myUsername);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => handlePillClick(emoji)}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
                  mine
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                    : 'border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700/80'
                }`}
              >
                <span role="img" aria-label={emoji}>
                  {emoji}
                </span>
                {count > 1 && <span className="text-[10px] font-medium">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative flex items-center gap-1.5 px-1 text-xs text-zinc-500">
        <span>
          {formatTime(message.timestamp)}
          {message.edited ? ' (edited)' : ''}
        </span>
        {readState === 'sent' && <span className="text-zinc-500">✓</span>}
        {readState === 'read' && <span className="text-sky-400">✓✓</span>}
        {!isDeleted && (
          <button
            type="button"
            aria-label="Message options"
            onClick={() => {
              setPickerOpen(false);
              setMenuOpen((open) => !open);
            }}
            className="rounded p-0.5 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-800/70 hover:text-zinc-300 focus:opacity-100 group-hover:opacity-100"
          >
            <MenuIcon />
          </button>
        )}
        {menuOpen && (
          <div
            role="menu"
            className={`absolute bottom-full z-30 mb-1 w-36 rounded-lg border border-zinc-700/70 bg-zinc-900 p-1 shadow-xl ${
              isOwn ? 'right-0' : 'left-0'
            }`}
          >
            {menuItems}
          </div>
        )}
        {pickerOpen && (
          <div
            role="menu"
            aria-label="Reactions"
            className={`absolute bottom-full z-30 mb-1 flex flex-wrap gap-1 rounded-lg border border-zinc-700/70 bg-zinc-900 p-2 shadow-xl ${
              isOwn ? 'right-0' : 'left-0'
            }`}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handlePickEmoji(emoji)}
                className="rounded-md px-1.5 py-1 text-base transition-colors hover:bg-zinc-800"
              >
                <span role="img" aria-label={emoji}>
                  {emoji}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {confirmingDelete && (
        <DeleteConfirmDialog
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            deleteMessage(target, message.id);
            setConfirmingDelete(false);
          }}
        />
      )}
    </div>
  );
}
