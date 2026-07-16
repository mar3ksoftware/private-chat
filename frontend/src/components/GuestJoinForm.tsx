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
          className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 w-full"
        />
      </div>

      <p className="text-xs text-zinc-500">
        Guest sessions have no account. Your identity won't persist.
      </p>

      {displayError !== null && <p className="text-sm text-red-400 mt-2">{displayError}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg px-4 py-3 w-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
      >
        {loading ? 'Joining...' : 'Join as Guest'}
      </button>
    </form>
  );
}
