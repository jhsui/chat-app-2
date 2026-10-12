import { useEffect, useState } from 'react';
import { api } from './api.js';
import AuthPage from './components/AuthPage.jsx';
import ChatPage from './components/ChatPage.jsx';

export default function App() {
  // undefined = still checking the session, null = signed out
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  async function handleLogout() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  if (user === undefined) return <div className="splash">Loading…</div>;
  if (!user) return <AuthPage onAuthenticated={setUser} />;
  return <ChatPage key={user.id} me={user} onLogout={handleLogout} />;
}
