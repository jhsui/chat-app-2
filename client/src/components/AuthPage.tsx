import { useState, type SubmitEvent } from "react";
import { ArrowRight, CheckCheck, Eye, EyeOff, Sparkles } from "lucide-react";
import Brand from "./Brand.tsx";
import { ThemeButton } from "../theme.tsx";
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
    <main className="auth-layout">
      <section className="auth-story">
        <div className="relative z-10">
          <Brand />
        </div>
        <div className="relative z-10 my-auto py-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-blue-200">
            <Sparkles className="size-3.5" /> Less distance. More connection.
          </span>
          <h1 className="mt-7 text-[clamp(40px,4.6vw,64px)] leading-[1.05] font-semibold tracking-[-0.055em]">
            Your people.
            <br />
            Your moments.
            <br />
            <span className="text-[#8fb0ff]">Your space.</span>
          </h1>
          <p className="mt-6 max-w-80 text-base leading-relaxed text-slate-300">
            The everyday hellos. The big ideas. The things that are better
            shared.
          </p>
          <div className="auth-preview" aria-hidden="true">
            <div className="mr-12 rounded-2xl rounded-bl-md border border-white/15 bg-white/8 p-4 shadow-xl backdrop-blur-sm">
              <div className="mb-2 flex items-center gap-2 text-xs text-blue-200">
                <span className="grid size-6 place-items-center rounded-full bg-blue-300/20">
                  J
                </span>{" "}
                Jamie
              </div>
              <p className="text-sm">Got a minute? I have an idea ✨</p>
            </div>
            <div className="mt-3 ml-16 rounded-2xl rounded-br-md border border-white/15 bg-[#3866ed] p-4 shadow-xl">
              <p className="text-sm">Always. Tell me everything.</p>
              <CheckCheck className="mt-2 ml-auto size-4 text-blue-100" />
            </div>
          </div>
        </div>
        <p className="relative z-10 text-xs text-slate-400">
          Real-time conversations. A little more human.
        </p>
      </section>
      <section className="relative flex min-h-[calc(100dvh-56px)] flex-col px-6 max-md:min-h-[calc(100dvh-48px)] max-md:px-0">
        <div className="flex items-center justify-between py-2">
          <span className="md:invisible">
            <Brand />
          </span>
          <ThemeButton />
        </div>
        <form
          className="auth-form mx-auto my-auto flex w-full max-w-95 flex-col gap-5 py-12"
          onSubmit={handleSubmit}
        >
          <div className="mb-3">
            <p className="eyebrow mb-3">
              {isLogin
                ? "Pick up where you left off"
                : "Something good starts here"}
            </p>
            <h2 className="text-[34px] leading-tight font-bold tracking-[-1px]">
              {isLogin ? "Welcome back." : "Make yourself at home."}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {isLogin
                ? "Your conversations are waiting for you."
                : "Create an account and find your people."}
            </p>
          </div>
          <label className="flex flex-col gap-2 text-[13px] font-semibold">
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
              placeholder="Your username"
              className={`${ui.input} h-12 font-normal`}
            />
            {!isLogin && (
              <span className="text-xs font-normal text-muted">
                3–20 characters. Letters, numbers and underscores.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-2 text-[13px] font-semibold">
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
                placeholder={
                  isLogin ? "Enter your password" : "At least 6 characters"
                }
                className={`${ui.input} h-12 pr-12 font-normal`}
              />
              <button
                type="button"
                className={`${ui.iconBtn} absolute top-0.5 right-0.5 size-11`}
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="size-4.5" />
                ) : (
                  <Eye className="size-4.5" />
                )}
              </button>
            </span>
          </label>
          {error && (
            <p
              className="rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            className={`${ui.btnPrimary} mt-2 flex h-12 items-center justify-center gap-2 text-sm`}
            type="submit"
            disabled={busy}
          >
            {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
            <ArrowRight className="size-4" />
          </button>
          <p className="mt-2 text-center text-[13px] text-muted">
            {isLogin ? "New around here?" : "Already part of the conversation?"}{" "}
            <button
              type="button"
              className="font-semibold text-accent hover:underline"
              onClick={switchMode}
            >
              {isLogin ? "Create an account" : "Sign in"}
            </button>
          </p>
        </form>
        <p className="pb-3 text-center text-xs text-muted">
          A space for the conversations that matter.
        </p>
      </section>
    </main>
  );
}
