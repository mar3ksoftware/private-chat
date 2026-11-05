import { useState } from 'react';
import { ConnectionStatus } from './ConnectionStatus';
import { GuestJoinForm } from './GuestJoinForm';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

type AuthTab = 'login' | 'register' | 'guest';

const tabs: readonly { readonly key: AuthTab; readonly label: string }[] = [
  { key: 'login', label: 'Sign In' },
  { key: 'register', label: 'Register' },
  { key: 'guest', label: 'Guest' },
];

export function AuthScreen() {
  const [activeTab, setActiveTab] = useState<AuthTab>('login');

  return (
    <div className="auth-shell bg-[#09090b]">
      <div className="flex min-h-full flex-col px-4 py-6 sm:py-8">
        <div className="glass m-auto w-full max-w-sm rounded-2xl p-5 sm:p-8">
          <div className="mb-6 text-center sm:mb-8">
            <h1 className="text-2xl font-bold text-zinc-50">Private Chat</h1>
            <p className="mt-1 text-sm text-zinc-400">End-to-end encrypted</p>
          </div>

          <div className="mb-6 flex gap-1 rounded-lg bg-zinc-800/50 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-pressed={activeTab === tab.key}
                className={`min-h-10 min-w-0 flex-1 touch-manipulation whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium transition-colors sm:text-sm ${
                  activeTab === tab.key
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'login' && <LoginForm />}
          {activeTab === 'register' && <RegisterForm />}
          {activeTab === 'guest' && <GuestJoinForm />}

          <div className="mt-6">
            <ConnectionStatus />
          </div>
        </div>
      </div>
    </div>
  );
}
