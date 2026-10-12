import { useEffect, useState } from "react";
import type { PublicUser } from "../../shared/types";
import { api } from "./api.ts";
import AuthPage from "./components/AuthPage.tsx";
import ChatPage from "./components/ChatPage.tsx";

export default function App() {
  // undefined = still checking the session, null = signed out
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);

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

  if (user === undefined)
    return (
      <div className="grid h-full place-items-center text-muted">Loading…</div>
    );
  if (!user) return <AuthPage onAuthenticated={setUser} />;
  return (
    <ChatPage
      key={user.id}
      me={user}
      onMeChange={setUser}
      onLogout={handleLogout}
    />
  );
}
