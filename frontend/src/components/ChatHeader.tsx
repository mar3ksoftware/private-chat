type ChatHeaderProps = {
  readonly username: string | null;
  readonly subtitle?: string | undefined;
  readonly onLogout: () => void;
  readonly onBack?: (() => void) | undefined;
  readonly showBack?: boolean | undefined;
};

export function ChatHeader({ username, subtitle, onLogout, onBack, showBack }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50">
      <div className="flex items-center gap-3">
        {showBack === true && onBack !== undefined && (
          <button
            type="button"
            onClick={onBack}
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors md:hidden"
          >
            &larr; Back
          </button>
        )}
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">{username ?? 'Private Chat'}</h1>
          {subtitle !== undefined && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
      >
        Logout
      </button>
    </div>
  );
}
