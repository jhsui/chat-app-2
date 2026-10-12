import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type SubmitEvent,
  type KeyboardEvent,
} from "react";
import type {
  Message,
  MessageImage,
  PublicUser,
  ReplyPreview,
} from "../../../shared/types";
import { errorMessage } from "../api.ts";
import {
  formatDay,
  formatTime,
  isSameDay,
  msBetween,
  nameOf,
} from "../format.ts";
import { toChatImage, type ChatImage } from "../image.ts";
import { cx, ui } from "../ui.ts";
import Avatar from "./Avatar.tsx";
import ImageViewer from "./ImageViewer.tsx";

// Downloaded the first time the picker is opened, not with the rest of the app.
const EmojiPicker = lazy(() => import("./EmojiPicker.tsx"));

const MAX_MESSAGE_LENGTH = 2000;

const GROUP_GAP_MS = 5 * 60 * 1000;
/** Size of the avatar beside each run of messages, in pixels. */
const MESSAGE_AVATAR = 28;
/** The largest a picture is shown inside the chat, in pixels. */
const MAX_THUMB = { width: 280, height: 320 };

/**
 * The sender's avatar beside the first message of a run, lined up with the
 * bubble's first line. The rest of the run gets an empty space of the same
 * width (`show` false), so the bubbles stay in a column.
 */
function MessageAvatar({ user, show }: { user: PublicUser; show: boolean }) {
  return (
    <div className="mt-1 flex flex-none" style={{ width: MESSAGE_AVATAR }}>
      {show && (
        <Avatar
          name={nameOf(user)}
          src={user.avatarUrl}
          size={MESSAGE_AVATAR}
        />
      )}
    </div>
  );
}

/**
 * A picture in the chat. Its box is sized from the stored dimensions, so the
 * list doesn't jump around as the files load.
 */
function ImageBubble({
  image,
  title,
  onOpen,
}: {
  image: MessageImage;
  title: string;
  onOpen: () => void;
}) {
  const scale = Math.min(
    1,
    MAX_THUMB.width / image.width,
    MAX_THUMB.height / image.height,
  );
  return (
    <button
      type="button"
      className="block max-w-full overflow-hidden rounded-[18px] bg-bubble"
      title={title}
      onClick={onOpen}
      aria-label="View image"
    >
      <img
        src={image.url}
        alt="Image"
        loading="lazy"
        className="block max-h-80 max-w-full object-cover"
        style={{
          width: Math.max(48, Math.round(image.width * scale)),
          aspectRatio: `${image.width} / ${image.height}`,
        }}
      />
    </button>
  );
}

/** The quoted message at the top of a reply. Clicking it jumps to the original. */
function ReplyQuote({
  reply,
  name,
  onAccent,
  onJump,
}: {
  reply: ReplyPreview;
  /** Who wrote the quoted message. */
  name: string;
  /** True inside one of my own (accent-colored) bubbles. */
  onAccent: boolean;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onJump}
      className={cx(
        "flex w-full items-center gap-2 rounded-lg border-l-3 px-2 py-1 text-left text-sm whitespace-normal",
        onAccent
          ? "border-white/70 bg-white/15"
          : "border-accent bg-black/5 dark:bg-white/10",
      )}
    >
      {reply.imageUrl && (
        <img
          src={reply.imageUrl}
          alt=""
          className="size-9 flex-none rounded-md object-cover"
        />
      )}
      <span className="min-w-0">
        <span className="block font-semibold">{name}</span>
        <span className="line-clamp-2 opacity-80">
          {reply.imageUrl ? "Photo" : reply.body}
        </span>
      </span>
    </button>
  );
}

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
  onSend: (body: string, replyTo?: number) => Promise<void>;
  /** Same, for a picture. */
  onSendImage: (image: ChatImage, replyTo?: number) => Promise<void>;
  /** Text typed here earlier and not sent, to start the box with. */
  initialDraft: string;
  /** Called with the unsent text whenever it changes, so it can be kept for next time. */
  onDraftChange: (text: string) => void;
  /** The message that was being replied to here earlier, if the reply wasn't sent. */
  initialReplyTo: Message | null;
  /** Called when a reply is started, sent or cancelled, so it can be kept the same way. */
  onReplyChange: (message: Message | null) => void;
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
  onSendImage,
  initialDraft,
  onDraftChange,
  initialReplyTo,
  onReplyChange,
  onTyping,
  onBack,
  onShowProfile,
}: ChatWindowProps) {
  const [draft, setDraft] = useState(initialDraft);
  // The latest draft, readable after an await (state in a closure would be stale).
  const draftRef = useRef(initialDraft);
  // The message being replied to, shown above the text box.
  const [replyingTo, setReplyingTo] = useState(initialReplyTo);
  const replyRef = useRef(initialReplyTo);
  const [highlightId, setHighlightId] = useState<number | null>(null); // message just jumped to
  const [error, setError] = useState("");
  // The picture waiting to be sent, shown above the text box.
  const [attachment, setAttachment] = useState<{
    image: ChatImage;
    previewUrl: string;
  } | null>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const [viewing, setViewing] = useState<MessageImage | null>(null); // picture opened large
  const [emojiOpen, setEmojiOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  // Where to put the cursor once an inserted emoji is in the text box.
  const caretRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
    const input = inputRef.current;
    input?.focus();
    // Continue a restored draft from its end.
    input?.setSelectionRange(input.value.length, input.value.length);
    const t = typingState.current;
    return () => clearTimeout(t.timer);
  }, []);

  /** Sets the text box and reports it, so the draft survives switching chats. */
  function updateDraft(text: string) {
    draftRef.current = text;
    setDraft(text);
    onDraftChange(text);
  }

  // Free the preview's memory when the attachment is replaced, sent or removed.
  useEffect(() => {
    if (!attachment) return;
    return () => URL.revokeObjectURL(attachment.previewUrl);
  }, [attachment]);

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

  /** Starts or cancels (null) a reply, and reports it like the draft. */
  function updateReply(message: Message | null) {
    replyRef.current = message;
    setReplyingTo(message);
    onReplyChange(message);
  }

  /** Scrolls to a quoted message and highlights it briefly, if it's among the loaded messages. */
  function jumpTo(messageId: number) {
    const el = listRef.current?.querySelector(
      `[data-message-id="${messageId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(messageId);
  }

  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightId]);

  /** Tells the other person we're typing, until 2 seconds pass without a change. */
  function noteTyping() {
    const t = typingState.current;
    if (!t.active) {
      t.active = true;
      onTyping(true);
    }
    clearTimeout(t.timer);
    t.timer = setTimeout(stopTyping, 2000);
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    updateDraft(e.target.value);
    setError("");
    noteTyping();
  }

  /** Puts an emoji where the cursor is in the text box, replacing any selected text. */
  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    const text = draftRef.current;
    // The text box remembers its cursor even while the picker has the focus.
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    if (text.length - (end - start) + emoji.length > MAX_MESSAGE_LENGTH) return;
    updateDraft(text.slice(0, start) + emoji + text.slice(end));
    caretRef.current = start + emoji.length;
    setError("");
    noteTyping();
  }

  // Changing the text from code sends the cursor to the end, so after an emoji
  // is inserted put it back right behind the emoji.
  useLayoutEffect(() => {
    if (caretRef.current === null) return;
    inputRef.current?.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  }, [draft]);

  // Close the emoji picker with Esc, or by clicking anywhere outside the message box.
  useEffect(() => {
    if (!emojiOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!composerRef.current?.contains(e.target as Node)) setEmojiOpen(false);
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      setEmojiOpen(false);
      inputRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [emojiOpen]);

  /** Attaches a picked or pasted picture; it's sent with the Send button. */
  async function attach(file: File) {
    setError("");
    try {
      const image = await toChatImage(file);
      setAttachment({ image, previewUrl: URL.createObjectURL(image.blob) });
    } catch (err) {
      setError(errorMessage(err));
    }
    inputRef.current?.focus();
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still triggers a change
    if (file) void attach(file);
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(e.clipboardData.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (!file) return; // plain text: let the browser paste it
    e.preventDefault();
    void attach(file);
  }

  async function handleSubmit(e?: SubmitEvent<HTMLFormElement>) {
    e?.preventDefault();
    const body = draft.trim();
    const pending = attachment;
    if ((!body && !pending) || sendingImage) return;
    // The reply goes with the first message sent; null once that's done.
    let reply = replyingTo;
    // Clear right away so fast typers can keep going; put the text back if it fails.
    updateDraft("");
    updateReply(null);
    stopTyping();
    setEmojiOpen(false);
    inputRef.current?.focus();
    try {
      // A picture and text go out as two messages, picture first.
      if (pending) {
        setSendingImage(true);
        await onSendImage(pending.image, reply?.id);
        reply = null;
        // Unless it was swapped for another picture while this one was uploading.
        setAttachment((current) => (current === pending ? null : current));
      }
      if (body) await onSend(body, reply?.id);
    } catch (err) {
      setError(errorMessage(err));
      // Unless something new was typed meanwhile. This also works if the chat
      // was closed in the meantime: the text is there when it's opened again.
      updateDraft(draftRef.current || body);
      if (reply) updateReply(replyRef.current ?? reply);
    } finally {
      setSendingImage(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    } else if (e.key === "Escape" && replyingTo && !emojiOpen) {
      updateReply(null);
    }
  }

  const nameFor = (senderId: number) =>
    senderId === me.id ? "You" : nameOf(user);

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
          const bubbleTone = mine
            ? "rounded-br-md bg-accent text-white"
            : "rounded-bl-md bg-bubble";
          const quote = m.replyTo && (
            <ReplyQuote
              reply={m.replyTo}
              name={nameFor(m.replyTo.senderId)}
              onAccent={mine}
              onJump={() => jumpTo(m.replyTo!.id)}
            />
          );

          return (
            <div key={m.id}>
              {newDay && (
                <div className="mt-4 mb-2 flex justify-center">
                  <span className="rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs font-semibold text-muted">
                    {formatDay(m.createdAt)}
                  </span>
                </div>
              )}
              {/* Avatar on the outside, then the bubble, then the reply button:
                  mine on the right, theirs on the left. */}
              <div
                data-message-id={m.id}
                className={cx(
                  "group -mx-2 flex items-start gap-2 rounded-xl px-2 transition-colors duration-500",
                  groupedWithPrev ? "mt-0.5" : "mt-2.5",
                  mine && "flex-row-reverse",
                  m.id === highlightId && "bg-accent-soft",
                )}
              >
                <MessageAvatar
                  user={mine ? me : user}
                  show={!groupedWithPrev}
                />
                <div
                  className={cx(
                    "flex max-w-[min(75%,560px)] min-w-0 flex-col max-md:max-w-[85%]",
                    mine ? "items-end" : "items-start",
                  )}
                >
                  {m.image ? (
                    <>
                      {quote && (
                        <div
                          className={cx(
                            "mb-0.5 max-w-full rounded-[18px] p-1.5",
                            bubbleTone,
                          )}
                        >
                          {quote}
                        </div>
                      )}
                      <ImageBubble
                        image={m.image}
                        title={new Date(m.createdAt).toLocaleString()}
                        onOpen={() => setViewing(m.image)}
                      />
                    </>
                  ) : (
                    <div
                      className={cx(
                        "rounded-[18px] px-3 py-2 whitespace-pre-wrap wrap-anywhere",
                        bubbleTone,
                      )}
                      title={new Date(m.createdAt).toLocaleString()}
                    >
                      {quote && <div className="mb-1.5">{quote}</div>}
                      {m.body}
                    </div>
                  )}
                  {!groupedWithNext && (
                    <div className="mt-0.5 px-1 text-xs text-muted">
                      {formatTime(m.createdAt)}
                      {mine &&
                        m.id === lastMineId &&
                        (m.readAt ? " · Seen" : " · Sent")}
                    </div>
                  )}
                </div>
                {/* Shown on hover; always visible on touch screens, which can't hover. */}
                <button
                  type="button"
                  className="mt-1.5 grid size-7 flex-none place-items-center rounded-full text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-panel hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-70"
                  onClick={() => {
                    updateReply(m);
                    inputRef.current?.focus();
                  }}
                  aria-label="Reply"
                  title="Reply"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 14-5-5 5-5" />
                    <path d="M4 9h11a5 5 0 0 1 5 5v5" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}

        {typing && (
          <div className="mt-2.5 flex items-center gap-2 self-start">
            <Avatar
              name={nameOf(user)}
              src={user.avatarUrl}
              size={MESSAGE_AVATAR}
            />
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

      {/* The picker sits outside the <form>, so Enter in its search box doesn't send the message. */}
      <div ref={composerRef} className="relative">
        {emojiOpen && (
          <div className="absolute bottom-full left-3 z-10 mb-2 w-[min(350px,calc(100%-1.5rem))] rounded-2xl shadow-[0_10px_40px_rgb(0_0_0/0.18)]">
            <Suspense
              fallback={
                <div className="grid h-[380px] place-items-center rounded-2xl border border-line bg-panel text-muted">
                  Loading…
                </div>
              }
            >
              <EmojiPicker onPick={insertEmoji} />
            </Suspense>
          </div>
        )}
        <form
          className="flex flex-wrap items-end gap-2.5 border-t border-line bg-panel px-4 py-3"
          onSubmit={handleSubmit}
        >
          {error && (
            <p className={cx(ui.error, "basis-full")} role="alert">
              {error}
            </p>
          )}
          {replyingTo && (
            <div className="flex basis-full items-center gap-2 rounded-xl border-l-3 border-accent bg-panel-2 py-1.5 pr-1.5 pl-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-accent">
                  Replying to{" "}
                  {replyingTo.senderId === me.id ? "yourself" : nameOf(user)}
                </div>
                <div className="truncate text-muted">
                  {replyingTo.image ? "📷 Photo" : replyingTo.body}
                </div>
              </div>
              <button
                type="button"
                className={cx(ui.btnGhost, "text-xl leading-none")}
                onClick={() => updateReply(null)}
                aria-label="Cancel reply"
              >
                ×
              </button>
            </div>
          )}
          {attachment && (
            <div className="basis-full">
              <div className="relative inline-block">
                <img
                  src={attachment.previewUrl}
                  alt="Image to send"
                  className="block h-20 max-w-40 rounded-xl border border-line object-cover"
                />
                {sendingImage ? (
                  <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/50 text-xs font-semibold text-white">
                    Sending…
                  </span>
                ) : (
                  <button
                    type="button"
                    className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-line bg-panel leading-none text-muted hover:text-fg"
                    onClick={() => setAttachment(null)}
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
            aria-label="Choose an image to send"
          />
          <button
            type="button"
            className="grid size-10.5 flex-none place-items-center rounded-full text-muted hover:enabled:bg-panel-2 hover:enabled:text-fg disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={sendingImage}
            aria-label="Attach an image"
            title="Attach an image"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <circle cx="8.5" cy="9.5" r="1.5" />
              <path d="m21 15-4.5-4.5L7 20" />
            </svg>
          </button>
          <button
            type="button"
            className={cx(
              "grid size-10.5 flex-none place-items-center rounded-full hover:bg-panel-2 hover:text-fg",
              emojiOpen ? "bg-panel-2 text-fg" : "text-muted",
            )}
            onClick={() => setEmojiOpen((open) => !open)}
            aria-label="Emoji"
            aria-expanded={emojiOpen}
            title="Emoji"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
              <path d="M9 9.75h.01M15 9.75h.01" strokeWidth="2.6" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={stopTyping}
            placeholder={`Message ${nameOf(user)}`}
            maxLength={MAX_MESSAGE_LENGTH}
            aria-label={`Message ${nameOf(user)}`}
            className={cx(
              ui.fieldBase,
              "field-sizing-content max-h-40 min-h-10.5 flex-1 resize-none rounded-[21px] px-4 py-2",
            )}
          />
          <button
            className={cx(ui.primaryBase, "h-10.5 rounded-[21px] px-4")}
            type="submit"
            disabled={(!draft.trim() && !attachment) || sendingImage}
          >
            Send
          </button>
        </form>
      </div>
      {viewing && (
        <ImageViewer image={viewing} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}
