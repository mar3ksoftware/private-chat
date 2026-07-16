import { useCallback, useState } from 'react';
import { useChat } from '../context/ChatContext';

type CreateGroupModalProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
};

export function CreateGroupModal({ isOpen, onClose }: CreateGroupModalProps) {
  const { users, user, createGroup } = useChat();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleMember = useCallback((username: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || selected.size === 0) return;
    createGroup(trimmed, Array.from(selected));
    setName('');
    setSelected(new Set());
    onClose();
  }, [name, selected, createGroup, onClose]);

  if (!isOpen) return null;

  const otherUsers = users.filter((u) => u.username !== user?.username);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass w-full max-w-md mx-4 rounded-2xl p-6 border border-zinc-700/50">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">Create Group</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 mb-4"
        />
        <div className="max-h-48 overflow-y-auto mb-4">
          {otherUsers.length === 0 ? (
            <p className="text-sm text-zinc-500">No other users online</p>
          ) : (
            otherUsers.map((u) => (
              <label
                key={u.userId}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(u.username)}
                  onChange={() => toggleMember(u.username)}
                  className="rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500/50"
                />
                <span className="text-sm text-zinc-300">{u.username}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={name.trim().length === 0 || selected.size === 0}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
