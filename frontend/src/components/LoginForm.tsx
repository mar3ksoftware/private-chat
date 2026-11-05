import { useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';

export function LoginForm() {
  const { login, error: serverError } = useChat();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
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
    if (password === '') {
      setClientError('Password is required');
      return;
    }

    setLoading(true);
    login(username, password, pin.length > 0 ? pin : undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="login-username" className="text-sm font-medium text-zinc-300 mb-1.5 block">
          Username
        </label>
        <input
          id="login-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
          className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-4 py-3 text-base text-zinc-100 placeholder-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="text-sm font-medium text-zinc-300 mb-1.5 block">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          autoComplete="current-password"
          maxLength={128}
          className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-4 py-3 text-base text-zinc-100 placeholder-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="login-pin" className="text-sm font-medium text-zinc-300 mb-1.5 block">
          PIN <span className="text-zinc-500">(optional, 4-6 digits)</span>
        </label>
        <input
          id="login-pin"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter PIN"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-4 py-3 text-base text-zinc-100 placeholder-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none"
        />
      </div>

      {displayError !== null && <p className="text-sm text-red-400 mt-2">{displayError}</p>}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 w-full touch-manipulation rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
