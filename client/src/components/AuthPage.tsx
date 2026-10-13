import { useState, type SubmitEvent } from "react";
import { MessageCircleMore } from "lucide-react";
import type { PublicUser } from "../../../shared/types";
import { api, errorMessage } from "../api.ts";
import { ui } from "../ui.ts";

interface AuthPageProps {
  onAuthenticated: (user: PublicUser) => void;
}

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isLogin = mode === "login";

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { user } = isLogin
        ? await api.login(username, password)
        : await api.register(username, password);
      onAuthenticated(user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isLogin ? "register" : "login");
    setError("");
  }

  return (
    <main className="grid min-h-full place-items-center p-6">
      <form
        className="flex w-full max-w-95 flex-col gap-4 rounded-3xl border border-line bg-panel p-8 shadow-card"
        onSubmit={handleSubmit}
      >
        <div
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-2xl bg-linear-to-br from-fill to-fill-2 text-white shadow-bubble"
        >
          <MessageCircleMore className="size-6.5" />
        </div>
        <h1 className="mt-1 text-2xl leading-tight font-bold tracking-tight">
          {isLogin ? "Welcome back" : "Create your account"}
        </h1>
        <p className="-mt-2 mb-1 text-muted">
          {isLogin
            ? "Sign in to keep chatting."
            : "Pick a username people can find you by."}
        </p>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            maxLength={20}
            pattern="[a-zA-Z0-9_]+"
            title="Letters, numbers or underscores"
            className={ui.input}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={6}
            maxLength={72}
            className={ui.input}
          />
        </label>

        {error && (
          <p className={ui.error} role="alert">
            {error}
          </p>
        )}

        <button className={ui.btnPrimary} type="submit" disabled={busy}>
          {busy ? "Please wait…" : isLogin ? "Sign in" : "Sign up"}
        </button>

        <p className="text-center text-sm text-muted">
          {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-semibold text-accent"
            onClick={switchMode}
          >
            {isLogin ? "Sign up" : "Sign in"}
          </button>
        </p>
      </form>
    </main>
  );
}
