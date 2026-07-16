import { AuthScreen } from './components/AuthScreen';
import { ChatLayout } from './components/ChatLayout';
import { ChatProvider, useChat } from './context/ChatContext';

function AppShell() {
  const { user } = useChat();
  return user !== null ? <ChatLayout /> : <AuthScreen />;
}

export function App() {
  return (
    <ChatProvider>
      <AppShell />
    </ChatProvider>
  );
}
