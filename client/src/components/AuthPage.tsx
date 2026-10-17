import { useState, type SubmitEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import Brand from "./Brand.tsx";
import { ThemeButton } from "../theme.tsx";
import type { PublicUser } from "../../../shared/types";
import { api, errorMessage } from "../api.ts";
import { cx, ui } from "../ui.ts";

/** A few made-up messages in the chat's own bubbles, for the sign-in page. */
function ConversationPreview() {
  return (
    <div
      className="m-auto flex w-full max-w-80 flex-col px-2 py-10"
      aria-hidden="true"
    >
      <div className="bubble bubble-theirs self-start">
        Are we still on for Saturday?
      </div>
      <div className="bubble bubble-theirs bubble-tail mt-0.5 self-start">
        Found a trail by the lake 🌲
      </div>
      <div className="bubble bubble-mine bubble-tail mt-2.5 self-end">
        Yes! Leave at 9?
      </div>
      <div className="mt-1 self-end px-1 text-[11px] text-muted tabular-nums">
        <span className="font-semibold">Read</span> 9:41 AM
      </div>
      <div className="bubble bubble-theirs bubble-tail mt-2 flex gap-1 self-start px-3.5 py-3">
        {["0s", "0.15s", "0.3s"].map((delay) => (
          <span
            key={delay}
            className="size-2 animate-blink rounded-full bg-muted"
            style={{ animationDelay: delay }}
          />
        ))}
      </div>
    </div>
  );
}

interface AuthPageProps {
  onAuthenticated: (user: PublicUser) => void;
}

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    <main className="grid min-h-full bg-chat md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Wide screens only: the app's colour and a glimpse of a conversation. */}
      <aside className="auth-panel hidden flex-col p-10 md:flex">
        <div className="flex items-center gap-2.5">
          <Brand size={32} />
          <span className="text-lg font-semibold tracking-[-0.01em]">Natter</span>
        </div>
        <ConversationPreview />
        <p className="max-w-80 text-sm text-muted">
          Real-time messages with read receipts, replies, reactions, photos
          and link previews.
        </p>
      </aside>
      <section className="relative grid place-items-center px-4 py-12">
        <div className="absolute top-3 right-3">
          <ThemeButton />
        </div>
        <div className="w-full max-w-85">
          <div className="mb-8 flex flex-col items-center text-center md:items-start md:text-left">
            <span className="mb-4 md:hidden">
              <Brand size={52} />
            </span>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
              {isLogin ? "Sign in to Natter" : "Create your account"}
            </h1>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                aria-label="Username"
                autoComplete="username"
                autoFocus
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
                title="Letters, numbers or underscores"
                className={cx(ui.input, "h-10 font-normal")}
              />
              {!isLogin && (
                <span className="text-xs font-normal text-muted">
                  3–20 letters, numbers or underscores.
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Password
              <span className="relative">
                <input
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  maxLength={72}
                  className={cx(ui.input, "h-10 pr-10 font-normal")}
                />
                <button
                  type="button"
                  className={cx(ui.iconBtn, "absolute top-1 right-1 size-8")}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </span>
              {!isLogin && (
                <span className="text-xs font-normal text-muted">
                  At least 6 characters.
                </span>
              )}
            </label>
            {error && (
              <p className={ui.error} role="alert">
                {error}
              </p>
            )}
            <button
              className={cx(ui.btnPrimary, "mt-1 text-sm")}
              type="submit"
              disabled={busy}
            >
              {busy
                ? isLogin
                  ? "Signing in…"
                  : "Creating account…"
                : isLogin
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-muted md:text-left">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={switchMode}
            >
              {isLogin ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
