import { useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';

export function GuestJoinForm() {
  const { joinAsGuest, error: serverError } = useChat();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const displayError = clientError ?? serverError;

  useEffect(() => {
    if (serverError !== null) {
      setLoading(false);
    }
  }, [serverError]);

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setClientError(null);

    if (username.trim() === '') {
      setClientError('Username is required');
      return;
    }

    setLoading(true);
    joinAsGuest(username);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="guest-username" className="text-sm font-medium text-zinc-300 mb-1.5 block">
          Username
        </label>
        <input
          id="guest-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Pick a username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
          className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-4 py-3 text-base text-zinc-100 placeholder-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none"
        />
      </div>

      <p className="text-xs text-zinc-500">
        Guest sessions have no account. Your identity won't persist.
      </p>

      {displayError !== null && <p className="text-sm text-red-400 mt-2">{displayError}</p>}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 w-full touch-manipulation rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Joining...' : 'Join as Guest'}
      </button>
    </form>
  );
}
