export function EphemeralBanner() {
  return (
    <div className="glass rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
        <span>{String.fromCodePoint(0x1f512)}</span>
        <span>Session Ephemeral</span>
      </div>
      <p className="mt-1 text-xs text-zinc-400">Messages are never stored</p>
    </div>
  );
}
