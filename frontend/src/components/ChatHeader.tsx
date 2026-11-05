type ChatHeaderProps = {
  readonly username: string | null;
  readonly subtitle?: string | undefined;
  readonly onLogout: () => void;
  readonly onBack?: (() => void) | undefined;
  readonly showBack?: boolean | undefined;
};

export function ChatHeader({ username, subtitle, onLogout, onBack, showBack }: ChatHeaderProps) {
  return (
    <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-zinc-800/50 px-4 py-3 sm:px-6 sm:py-4">
      {showBack === true && onBack !== undefined && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="-ml-2 inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200 active:bg-zinc-800 md:hidden"
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
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-zinc-100 sm:text-lg">
          {username ?? 'Private Chat'}
        </h1>
        {subtitle !== undefined && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="inline-flex min-h-10 shrink-0 touch-manipulation items-center rounded-lg px-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        Logout
      </button>
    </header>
  );
}
