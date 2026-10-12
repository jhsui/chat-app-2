import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
  type KeyboardEvent,
} from "react";
import type { Message, PublicUser } from "../../../shared/types";
import { errorMessage } from "../api.ts";
import {
  formatDay,
  formatTime,
  isSameDay,
  msBetween,
  nameOf,
} from "../format.ts";
import { cx, ui } from "../ui.ts";
import Avatar from "./Avatar.tsx";

const GROUP_GAP_MS = 5 * 60 * 1000;

interface ChatWindowProps {
  me: PublicUser;
  user: PublicUser;
  online: boolean;
  typing: boolean;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  onLoadOlder: () => void;
  /** Resolves when the server accepts the message; rejects with a readable error. */
  onSend: (body: string) => Promise<void>;
  onTyping: (typing: boolean) => void;
  onBack: () => void;
  /** Opens this person's profile. */
  onShowProfile: () => void;
}

interface ScrollState {
  firstId: number | null;
  lastId: number | null;
  height: number;
  nearBottom: boolean;
}

export default function ChatWindow({
  me,
  user,
  online,
  typing,
  messages,
  hasMore,
  loading,
  onLoadOlder,
  onSend,
  onTyping,
  onBack,
  onShowProfile,
}: ChatWindowProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollState = useRef<ScrollState>({
    firstId: null,
    lastId: null,
    height: 0,
    nearBottom: true,
  });
  const typingState = useRef<{
    active: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }>({ active: false });

  // Keep the view pinned to the newest message, but don't yank the user down
  // if they've scrolled up to read history. When older messages are added on
  // top, keep the same message in view.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const s = scrollState.current;
    const firstId = messages[0]?.id ?? null;
    const lastId = messages.at(-1)?.id ?? null;

    if (s.firstId !== null && firstId !== s.firstId && lastId === s.lastId) {
      el.scrollTop += el.scrollHeight - s.height;
    } else if (lastId !== s.lastId) {
      const mine = messages.at(-1)?.senderId === me.id;
      if (s.nearBottom || mine || s.lastId === null)
        el.scrollTop = el.scrollHeight;
    }
    scrollState.current = { ...s, firstId, lastId, height: el.scrollHeight };
  }, [messages, me.id]);

  // Show the typing bubble without hiding the latest message.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (typing && el && scrollState.current.nearBottom)
      el.scrollTop = el.scrollHeight;
  }, [typing]);

  useEffect(() => {
    inputRef.current?.focus();
    const t = typingState.current;
    return () => clearTimeout(t.timer);
  }, []);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    scrollState.current.nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    scrollState.current.height = el.scrollHeight;
    if (el.scrollTop < 40 && hasMore && !loading) onLoadOlder();
  }

  function stopTyping() {
    const t = typingState.current;
    clearTimeout(t.timer);
    if (t.active) {
      t.active = false;
      onTyping(false);
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    setError("");
    const t = typingState.current;
    if (!t.active) {
      t.active = true;
      onTyping(true);
    }
    clearTimeout(t.timer);
    t.timer = setTimeout(stopTyping, 2000);
  }

  async function handleSubmit(e?: SubmitEvent<HTMLFormElement>) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    // Clear right away so fast typers can keep going; put the text back if it fails.
    setDraft("");
    stopTyping();
    inputRef.current?.focus();
    try {
      await onSend(body);
    } catch (err) {
      setError(errorMessage(err));
      setDraft((current) => current || body);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  // My most recent message shows "Sent" or "Seen".
  const lastMineId = messages.findLast((m) => m.senderId === me.id)?.id;

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className={ui.header}>
        <button
          className={cx(ui.btnGhost, "text-xl md:hidden")}
          onClick={onBack}
          aria-label="Back to conversations"
        >
          ←
        </button>
        <button
          className="-m-1.5 flex min-w-0 items-center gap-3 rounded-xl p-1.5 text-left hover:bg-panel-2"
          onClick={onShowProfile}
          aria-label={`View ${nameOf(user)}'s profile`}
        >
          <Avatar
            name={nameOf(user)}
            src={user.avatarUrl}
            online={online}
            size={38}
          />
          <div className={ui.nameBlock}>
            <strong className="truncate">{nameOf(user)}</strong>
            <span className={ui.status}>
              {typing ? "typing…" : online ? "Online" : "Offline"}
            </span>
          </div>
        </button>
      </header>

      {/* The first child's auto top margin keeps short conversations pinned to the bottom. */}
      <div
        className="flex flex-1 flex-col overflow-y-auto bg-panel-2 px-5 py-4 *:first:mt-auto"
        ref={listRef}
        onScroll={handleScroll}
      >
        {hasMore && (
          <button
            className={cx(ui.btnGhost, "mb-3 self-center text-sm")}
            onClick={onLoadOlder}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load older messages"}
          </button>
        )}
        {!loading && messages.length === 0 && (
          <p className="px-4 py-8 text-center text-muted">
            This is the start of your conversation with{" "}
            <strong>{nameOf(user)}</strong>. Say hi!
          </p>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const mine = m.senderId === me.id;
          const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt);
          const groupedWithPrev =
            !newDay &&
            prev?.senderId === m.senderId &&
            msBetween(prev.createdAt, m.createdAt) < GROUP_GAP_MS;
          const groupedWithNext =
            !!next &&
            next.senderId === m.senderId &&
            isSameDay(m.createdAt, next.createdAt) &&
            msBetween(m.createdAt, next.createdAt) < GROUP_GAP_MS;

          return (
            <div key={m.id}>
              {newDay && (
                <div className="mt-4 mb-2 flex justify-center">
                  <span className="rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs font-semibold text-muted">
                    {formatDay(m.createdAt)}
                  </span>
                </div>
              )}
              <div
                className={cx(
                  "flex max-w-[min(75%,560px)] flex-col max-md:max-w-[85%]",
                  groupedWithPrev ? "mt-0.5" : "mt-2.5",
                  mine ? "items-end self-end" : "items-start self-start",
                )}
              >
                <div
                  className={cx(
                    "rounded-[18px] px-3 py-2 whitespace-pre-wrap wrap-anywhere",
                    mine
                      ? "rounded-br-md bg-accent text-white"
                      : "rounded-bl-md bg-bubble",
                  )}
                  title={new Date(m.createdAt).toLocaleString()}
                >
                  {m.body}
                </div>
                {!groupedWithNext && (
                  <div className="mt-0.5 px-1 text-xs text-muted">
                    {formatTime(m.createdAt)}
                    {mine &&
                      m.id === lastMineId &&
                      (m.readAt ? " · Seen" : " · Sent")}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {typing && (
          <div className="mt-2.5 flex self-start">
            <div
              className="flex gap-1 rounded-[18px] rounded-bl-md bg-bubble px-3.5 py-3"
              aria-label={`${nameOf(user)} is typing`}
            >
              {["0s", "0.15s", "0.3s"].map((delay) => (
                <span
                  key={delay}
                  className="size-1.75 animate-blink rounded-full bg-muted"
                  style={{ animationDelay: delay }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-2.5 border-t border-line bg-panel px-4 py-3"
        onSubmit={handleSubmit}
      >
        {error && (
          <p className={cx(ui.error, "basis-full")} role="alert">
            {error}
          </p>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={stopTyping}
          placeholder={`Message ${nameOf(user)}`}
          maxLength={2000}
          aria-label={`Message ${nameOf(user)}`}
          className={cx(
            ui.fieldBase,
            "field-sizing-content max-h-40 min-h-10.5 flex-1 resize-none rounded-[21px] px-4 py-2",
          )}
        />
        <button
          className={cx(ui.primaryBase, "h-10.5 rounded-[21px] px-4")}
          type="submit"
          disabled={!draft.trim()}
        >
          Send
        </button>
      </form>
    </section>
  );
}
