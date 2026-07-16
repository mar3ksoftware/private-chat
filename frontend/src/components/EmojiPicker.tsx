import type { Emoji } from 'frimousse';
import { EmojiPicker as FrimoussePicker } from 'frimousse';
import { useCallback, useRef, useState } from 'react';

type EmojiPickerProps = {
  readonly onEmojiSelect: (emoji: string) => void;
};

export function EmojiPicker({ onEmojiSelect }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEmojiSelect = useCallback(
    (emoji: Emoji) => {
      onEmojiSelect(emoji.emoji);
      setIsOpen(false);
    },
    [onEmojiSelect],
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-zinc-400 hover:text-zinc-200 transition-colors p-2"
        aria-label="Toggle emoji picker"
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
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" x2="9.01" y1="9" y2="9" />
          <line x1="15" x2="15.01" y1="9" y2="9" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute bottom-full mb-2 left-0 z-50">
          <FrimoussePicker.Root onEmojiSelect={handleEmojiSelect}>
            <FrimoussePicker.Search placeholder="Search emoji..." />
            <FrimoussePicker.Viewport className="h-72 w-72 overflow-auto rounded-lg border border-zinc-700/50 bg-zinc-900" />
          </FrimoussePicker.Root>
        </div>
      )}
    </div>
  );
}
