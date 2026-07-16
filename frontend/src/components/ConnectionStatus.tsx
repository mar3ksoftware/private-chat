import { useChat } from '../context/ChatContext';

function getStatusDisplay(status: 'connecting' | 'connected' | 'disconnected') {
  switch (status) {
    case 'connected':
      return { dotColor: 'bg-green-500', label: 'Connected' } as const;
    case 'connecting':
      return { dotColor: 'bg-yellow-500', label: 'Connecting...' } as const;
    case 'disconnected':
      return { dotColor: 'bg-red-500', label: 'Disconnected' } as const;
  }
}

export function ConnectionStatus() {
  const { connectionStatus } = useChat();
  const { dotColor, label } = getStatusDisplay(connectionStatus);

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </div>
  );
}
