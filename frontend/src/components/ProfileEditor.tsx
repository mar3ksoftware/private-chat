import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '../context/ChatContext';
import { validateProfile } from '../lib/profile';

type ProfileEditorProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
};

export function ProfileEditor({ isOpen, onClose }: ProfileEditorProps) {
  const { user, profiles, updateProfile } = useChat();
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Re-syncing on every remote profile update would clobber in-progress
  // edits, so only seed the fields when the editor opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed fields on open only
  useEffect(() => {
    if (isOpen && user !== null) {
      const profile = profiles[user.username];
      setDisplayName(profile?.displayName ?? user.username);
      setStatus(profile?.status ?? '');
      setNameError(null);
      setStatusError(null);
    }
  }, [isOpen]);

  if (!isOpen || user === null) return null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateProfile(displayName, status);
    setNameError(validation.nameError);
    setStatusError(validation.statusError);
    if (validation.nameError !== null || validation.statusError !== null) return;
    updateProfile(validation.displayName, validation.status);
    onClose();
  };

  // The Sidebar is a `backdrop-filter` element, so portal the dialog to
  // <body> to cover the viewport (same as CreateGroupModal).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-editor-title"
        className="glass w-full max-w-md rounded-2xl p-6 border border-zinc-700/50"
      >
        <h2 id="profile-editor-title" className="text-lg font-semibold text-zinc-100 mb-4">
          {user.username}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Display name
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            {nameError !== null && <p className="text-xs text-rose-400">{nameError}</p>}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Status
            </span>
            <input
              type="text"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            {statusError !== null && <p className="text-xs text-rose-400">{statusError}</p>}
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              aria-label="Save profile"
              className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
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
        </form>
      </div>
    </div>,
    document.body,
  );
}
