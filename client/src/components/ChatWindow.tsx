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
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Info,
  MoreHorizontal,
  WifiOff,
  Check,
  CheckCheck,
  ChevronLeft,
  Image as ImageIcon,
  Plus,
  Reply as ReplyIcon,
  Send,
  Smile as SmileIcon,
  Trash2 as TrashIcon,
  X,
} from "lucide-react";
import type {
  LinkPreview,
  Message,
  MessageImage,
  PublicUser,
  ReplyPreview,
} from "../../../shared/types";
import { errorMessage } from "../api.ts";
import {
  formatDateTime,
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
import FloatingMenu from "./FloatingMenu.tsx";
import DeleteMessageDialog from "./DeleteMessageDialog.tsx";
import { ThemeButton } from "../theme.tsx";

// Downloaded the first time the picker is opened, not with the rest of the app.
const EmojiPicker = lazy(() => import("./EmojiPicker.tsx"));

const MAX_MESSAGE_LENGTH = 2000;
/** How long after sending a message I can still delete it. Same as DELETE_WINDOW_MS on the server, which enforces it. */
const DELETE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
/** The reactions offered straight away on a message; "+" opens the full picker for any other emoji. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
// Look of the small round buttons beside a message (react, reply, delete).
// They show on hover. Touch screens can't hover: there only the react button
// is shown (always), and the bar it opens offers reply and delete too.
const messageAction =
  "grid size-9 flex-none place-items-center rounded-lg text-muted transition hover:bg-panel-2 hover:text-fg [@media(hover:none)]:size-11";
const onlyWithHover = "[@media(hover:none)]:hidden";
// The image and emoji buttons inside the message box.
const composerButton =
  "grid size-11 flex-none place-items-center rounded-xl text-muted transition-colors hover:enabled:bg-panel-2 hover:enabled:text-accent disabled:opacity-50";

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
      className="block max-w-full overflow-hidden rounded-[20px] bg-panel-2 shadow-bubble"
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

/**
 * The status of a message I sent, shown in its corner: one tick once the
 * server has it, two blue ticks once the other person has seen it. Hovering
 * shows when it was seen, or when it was sent if it hasn't been seen yet.
 */
function Ticks({ message }: { message: Message }) {
  const seen = message.readAt !== null;
  const label = message.readAt
    ? `Seen ${formatDateTime(message.readAt)}`
    : `Sent ${formatDateTime(message.createdAt)}`;
  const Icon = seen ? CheckCheck : Check;
  return (
    <Icon
      role="img"
      aria-label={label}
      strokeWidth={2.4}
      className={cx("size-4", seen ? "text-sky-300" : "text-white/75")}
    >
      <title>{label}</title>
    </Icon>
  );
}

// Same pattern as findFirstUrl on the server, which picks the link to preview.
const LINK_PATTERN = /https?:\/\/[^\s<>"']+/gi;

function isUrl(text: string): boolean {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/** A message's text, with the web addresses in it turned into links. */
function MessageText({ text, onAccent }: { text: string; onAccent: boolean }) {
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    // Punctuation right after a link ("see https://a.example/b.") isn't part of it.
    const url = match[0].replace(/[.,!?;:)\]}]+$/, "");
    if (!isUrl(url)) continue;
    parts.push(
      text.slice(end, match.index),
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        className={cx(
          "underline underline-offset-2",
          !onAccent && "text-accent",
        )}
      >
        {url.length > 65
          ? `${new URL(url).hostname}${new URL(url).pathname.slice(0, 35)}…`
          : url}
      </a>,
    );
    end = match.index + url.length;
  }
  parts.push(text.slice(end));
  return <>{parts}</>;
}

/** The card under a message for the web page it links to. Clicking it opens the page. */
function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const [imageFailed, setImageFailed] = useState(false);
  const host = isUrl(preview.url)
    ? new URL(preview.url).hostname.replace(/^www\./, "")
    : "";
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="link-card block w-80 max-w-full overflow-hidden rounded-[18px] border border-line bg-panel shadow-bubble"
    >
      {/* A fixed height, so the chat doesn't jump when the picture loads. The
          picture comes straight from the other site; no-referrer keeps this
          app's address out of that request. */}
      {preview.imageUrl && !imageFailed && (
        <img
          src={preview.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-36 w-full border-b border-line bg-panel-2 object-cover"
          onError={() => setImageFailed(true)}
        />
      )}
      <span className="block p-3.5">
        <span className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-medium text-muted">
          <span className="truncate">{host}</span>
          <ArrowUpRight className="size-3.5 flex-none" />
        </span>
        <span className="line-clamp-2 text-sm leading-snug font-semibold">
          {preview.title}
        </span>
        {preview.description && preview.description !== preview.title && (
          <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
            {preview.description}
          </span>
        )}
      </span>
    </a>
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
          {reply.deleted
            ? "Deleted message"
            : reply.imageUrl
              ? "Photo"
              : reply.body}
        </span>
      </span>
    </button>
  );
}

interface ChatWindowProps {
  me: PublicUser;
  user: PublicUser;
  online: boolean;
  connected: boolean;
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
  /** Sets my reaction to a message (null removes it); rejects with a readable error. */
  onReact: (messageId: number, emoji: string | null) => Promise<void>;
  /** Deletes one of my messages for both people; rejects with a readable error. */
  onDelete: (messageId: number) => Promise<void>;
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
  connected,
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
  onReact,
  onDelete,
  onTyping,
  onBack,
  onShowProfile,
}: ChatWindowProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [showJump, setShowJump] = useState(false);
  // The latest draft, readable after an await (state in a closure would be stale).
  const draftRef = useRef(initialDraft);
  // The message being replied to, shown above the text box.
  const [replyingTo, setReplyingTo] = useState(initialReplyTo);
  const replyRef = useRef(initialReplyTo);
  const [highlightId, setHighlightId] = useState<number | null>(null); // message just jumped to
  const [actionAnchor, setActionAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
  const deleteAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [reactingId, setReactingId] = useState<number | null>(null); // message whose reaction bar is open
  const [error, setError] = useState("");
  // The picture waiting to be sent, shown above the text box.
  const [attachment, setAttachment] = useState<{
    image: ChatImage;
    previewUrl: string;
  } | null>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const [viewing, setViewing] = useState<MessageImage | null>(null); // picture opened large
  // What the emoji picker is open for: the text box ("draft"), a reaction to a
  // message (its id), or null when it's closed.
  const [emojiTarget, setEmojiTarget] = useState<"draft" | number | null>(null);
  const emojiOpen = emojiTarget !== null;
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
    } else if (s.nearBottom && el.scrollHeight > s.height) {
      // Same messages but taller, e.g. a reaction added under the last one.
      el.scrollTop = el.scrollHeight;
    }
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight >= 80);
    scrollState.current = { ...s, firstId, lastId, height: el.scrollHeight };
  }, [messages, me.id]);

  // Same when the list itself gets shorter or taller: the reply bar or a
  // picture appearing above the text box, the window being resized.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (scrollState.current.nearBottom) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    setShowJump(!scrollState.current.nearBottom);
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

  function startReply(message: Message) {
    updateReply(message);
    inputRef.current?.focus();
  }

  /** Scrolls to a quoted message and highlights it briefly, if it's among the loaded messages. */
  function jumpTo(messageId: number) {
    const el = listRef.current?.querySelector(
      `[data-message-id="${messageId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    setHighlightId(messageId);
  }

  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // If the message being replied to gets deleted, there's nothing left to reply to.
  useEffect(() => {
    if (
      replyingTo &&
      messages.some((m) => m.id === replyingTo.id && m.deletedAt)
    ) {
      replyRef.current = null;
      setReplyingTo(null);
    }
  }, [messages, replyingTo]);

  /** Sets my reaction to a message; picking the one it already has takes it back. */
  async function react(message: Message, emoji: string) {
    setReactingId(null);
    const current = message.reactions.find((r) => r.userId === me.id)?.emoji;
    try {
      await onReact(message.id, current === emoji ? null : emoji);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

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
      if (!composerRef.current?.contains(e.target as Node))
        setEmojiTarget(null);
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      setEmojiTarget(null);
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
    setEmojiTarget(null);
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

  /** An emoji was chosen in the picker: it's a reaction, or goes into the text box. */
  function handleEmojiPick(emoji: string) {
    if (emojiTarget === "draft") return insertEmoji(emoji);
    const message = messages.find((m) => m.id === emojiTarget);
    setEmojiTarget(null);
    if (message) void react(message, emoji);
  }

  const now = new Date().toISOString();
  const nameFor = (senderId: number) =>
    senderId === me.id ? "You" : nameOf(user);

  return (
    <section className="chat-conversation relative flex min-h-0 min-w-0 flex-col bg-chat">
      <header className={ui.header}>
        <button
          className={cx(ui.iconBtn, "-ml-1.5 size-11 md:hidden")}
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ChevronLeft className="size-6" />
        </button>
        <button
          className="-m-1.5 flex min-w-0 items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-panel-2"
          onClick={onShowProfile}
          aria-label={`View ${nameOf(user)}'s profile`}
        >
          <Avatar
            name={nameOf(user)}
            src={user.avatarUrl}
            online={online}
            size={40}
          />
          <div className={ui.nameBlock}>
            <strong className="truncate text-[15px] font-bold tracking-tight">
              {nameOf(user)}
            </strong>
            <span
              className={cx(
                "text-xs",
                typing
                  ? "font-medium text-accent"
                  : online
                    ? "text-green-600 dark:text-green-400"
                    : "text-muted",
              )}
            >
              {typing ? "Typing a message…" : online ? "Online now" : "Offline"}
            </span>
          </div>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-3 hidden rounded-full border border-line px-3 py-1.5 text-[11px] font-medium text-muted lg:inline-flex">
            Direct message
          </span>
          <span className="md:hidden">
            <ThemeButton />
          </span>
          <button
            type="button"
            className={cx(ui.iconBtn, "size-11")}
            onClick={onShowProfile}
            aria-label="Conversation details"
            title="Conversation details"
          >
            <Info className="size-5" />
          </button>
        </div>
      </header>
      {!connected && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-line bg-accent-soft px-4 py-2 text-xs text-accent"
        >
          <WifiOff className="size-4" /> Reconnecting. Your draft is safe here.
        </div>
      )}

      {/* The first child's auto top margin keeps short conversations pinned to the bottom. */}
      <div
        className="message-list flex flex-1 flex-col overflow-y-auto *:first:mt-auto"
        aria-label="Conversation messages"
        aria-busy={loading}
        ref={listRef}
        onScroll={handleScroll}
      >
        {loading && messages.length === 0 && (
          <div
            role="status"
            className="my-auto flex flex-col gap-5 py-6"
            aria-label="Loading messages"
          >
            <div className="skeleton h-12 w-48 max-w-[70%] rounded-2xl" />
            <div className="skeleton h-18 w-64 max-w-[75%] self-end rounded-2xl" />
            <div className="skeleton h-12 w-40 max-w-[65%] rounded-2xl" />
            <span className="sr-only">Loading messages…</span>
          </div>
        )}
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
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <Avatar name={nameOf(user)} src={user.avatarUrl} size={64} />
            <h2 className="mt-4 text-xl font-bold tracking-tight">
              Say hello to {nameOf(user)}
            </h2>
            <p className="mt-2 max-w-64 text-sm text-muted">
              Every great conversation starts somewhere. Make the first move.
            </p>
          </div>
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
            ? "message-bubble-own rounded-br-md bg-linear-to-br from-fill to-fill-2 text-white"
            : "message-bubble rounded-bl-md bg-bubble shadow-bubble";
          const canDelete =
            mine && msBetween(m.createdAt, now) < DELETE_WINDOW_MS;
          const quote = m.replyTo && (
            <ReplyQuote
              reply={m.replyTo}
              name={nameFor(m.replyTo.senderId)}
              onAccent={mine}
              onJump={() => jumpTo(m.replyTo!.id)}
            />
          );

          return (
            <div key={m.id} className="message-entry">
              {newDay && (
                <div className="mt-6 mb-5 flex items-center gap-4 before:h-px before:flex-1 before:bg-line/70 after:h-px after:flex-1 after:bg-line/70">
                  <span className="px-2 text-[11px] font-medium text-muted">
                    {formatDay(m.createdAt)}
                  </span>
                </div>
              )}
              {/* Avatar on the outside, then the bubble, then the react and
                  reply buttons: mine on the right, theirs on the left. */}
              <div
                data-message-id={m.id}
                className={cx(
                  "group relative flex w-fit max-w-full items-start gap-2 rounded-xl transition-colors duration-300",
                  groupedWithPrev
                    ? m.linkPreview || prev?.linkPreview
                      ? "mt-2"
                      : "mt-1"
                    : "mt-5",
                  mine && "ml-auto flex-row-reverse",
                  (m.id === highlightId || m.id === emojiTarget) &&
                    "bg-accent-soft",
                )}
              >
                <MessageAvatar
                  user={mine ? me : user}
                  show={!groupedWithPrev}
                />
                <div
                  className={cx(
                    "flex max-w-[min(65vw,560px)] min-w-0 flex-col max-md:max-w-[calc(100vw-108px)]",
                    mine ? "items-end" : "items-start",
                  )}
                >
                  {m.deletedAt ? (
                    <div
                      className="rounded-[20px] border border-dashed border-line px-3.5 py-2 text-sm text-muted italic"
                      title={`Deleted ${formatDateTime(m.deletedAt)}`}
                    >
                      {mine
                        ? "You deleted this message"
                        : "This message was deleted"}
                    </div>
                  ) : m.image ? (
                    <>
                      {quote && (
                        <div
                          className={cx(
                            "mb-0.5 max-w-full rounded-[20px] p-1.5",
                            bubbleTone,
                          )}
                        >
                          {quote}
                        </div>
                      )}
                      <div className="relative max-w-full">
                        <ImageBubble
                          image={m.image}
                          title={formatDateTime(m.createdAt)}
                          onOpen={() => setViewing(m.image)}
                        />
                        {mine && (
                          <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/50 px-1 py-0.5">
                            <Ticks message={m} />
                          </span>
                        )}
                      </div>
                    </>
                  ) : m.linkPreview &&
                    m.body.trim() === m.linkPreview.url &&
                    !quote ? null : (
                    <div
                      className={cx(
                        "relative rounded-[18px] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap wrap-anywhere",
                        bubbleTone,
                      )}
                      title={formatDateTime(m.createdAt)}
                    >
                      {quote && <div className="mb-1.5">{quote}</div>}
                      <MessageText text={m.body} onAccent={mine} />
                      {mine && (
                        <>
                          {/* An empty space at the end of the text keeps the last
                              line clear of the ticks, which sit in the corner. */}
                          <span className="inline-block w-5" />
                          <span className="absolute right-2.5 bottom-2.5">
                            <Ticks message={m} />
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  {m.linkPreview && (
                    <div
                      className={cx(
                        "relative max-w-full",
                        (m.body.trim() !== m.linkPreview.url || quote) &&
                          "mt-2",
                      )}
                    >
                      <LinkPreviewCard preview={m.linkPreview} />
                      {mine &&
                        m.body.trim() === m.linkPreview.url &&
                        !quote && (
                          <span className="mt-1 flex w-fit items-center rounded-full bg-fill px-1.5 py-0.5 ml-auto">
                            <Ticks message={m} />
                          </span>
                        )}
                    </div>
                  )}
                  {m.reactions.length > 0 && (
                    <div className="mt-1 flex gap-1">
                      {/* One chip per emoji; clicking it gives (or takes back) the same reaction. */}
                      {[...new Set(m.reactions.map((r) => r.emoji))].map(
                        (emoji) => {
                          const by = m.reactions.filter(
                            (r) => r.emoji === emoji,
                          );
                          const byMe = by.some((r) => r.userId === me.id);
                          const who = by
                            .map((r) => nameFor(r.userId))
                            .join(" and ");
                          return (
                            <button
                              key={emoji}
                              type="button"
                              className={cx(
                                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm shadow-bubble transition-transform hover:scale-105",
                                byMe
                                  ? "border-accent/60 bg-accent-soft"
                                  : "border-transparent bg-panel",
                              )}
                              onClick={() => void react(m, emoji)}
                              title={who}
                              aria-label={`${emoji} from ${who}`}
                              aria-pressed={byMe}
                            >
                              {emoji}
                              {by.length > 1 && (
                                <span className="text-xs font-semibold text-muted">
                                  {by.length}
                                </span>
                              )}
                            </button>
                          );
                        },
                      )}
                    </div>
                  )}
                  {!groupedWithNext && (
                    <div className="mt-1.5 px-1 text-xs text-muted">
                      {formatTime(m.createdAt)}
                    </div>
                  )}
                </div>
                {/* Nothing can be done with a deleted message. */}
                {!m.deletedAt && (
                  <>
                    <div
                      className={cx(
                        "message-actions flex flex-none items-center",
                        mine && "flex-row-reverse",
                      )}
                    >
                      <button
                        type="button"
                        data-reaction-bar
                        className={cx(
                          messageAction,
                          reactingId === m.id && "bg-accent-soft text-accent",
                        )}
                        onClick={(event) => {
                          setActionAnchor(event.currentTarget);
                          setReactingId((id) => (id === m.id ? null : m.id));
                        }}
                        aria-haspopup="menu"
                        aria-label="Message actions"
                        aria-expanded={reactingId === m.id}
                        title="Reactions and actions"
                      >
                        <MoreHorizontal className="size-4.5" />
                      </button>
                      <button
                        type="button"
                        className={cx(messageAction, onlyWithHover)}
                        onClick={() => startReply(m)}
                        aria-label="Reply"
                        title="Reply"
                      >
                        <ReplyIcon className="size-4.5" />
                      </button>
                      {/* Only while it's recent enough to delete. */}
                      {canDelete && (
                        <button
                          type="button"
                          className={cx(
                            messageAction,
                            onlyWithHover,
                            "hover:text-danger",
                          )}
                          onClick={(event) => {
                            deleteAnchorRef.current = event.currentTarget;
                            setDeletingMessage(m);
                          }}
                          aria-label="Delete"
                          title="Delete"
                        >
                          <TrashIcon className="size-4.5" />
                        </button>
                      )}
                    </div>
                    {reactingId === m.id && actionAnchor && (
                      <FloatingMenu
                        anchor={actionAnchor}
                        label="Message actions"
                        onClose={() => setReactingId(null)}
                      >
                        <p className="eyebrow px-3 pt-2 pb-3">
                          A little reaction goes a long way
                        </p>
                        <div
                          role="group"
                          aria-label="Quick reactions"
                          className="grid grid-cols-6 gap-0.5 px-1 pb-2"
                        >
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={m.reactions.some(
                                (r) => r.userId === me.id && r.emoji === emoji,
                              )}
                              aria-label={`React with ${emoji}`}
                              className={cx(
                                "grid min-h-11 place-items-center rounded-xl text-xl transition hover:scale-110 hover:bg-panel-2",
                                m.reactions.some(
                                  (r) =>
                                    r.userId === me.id && r.emoji === emoji,
                                ) && "bg-accent-soft",
                              )}
                              onClick={() => {
                                actionAnchor.focus({ preventScroll: true });
                                void react(m, emoji);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                        <div
                          role="separator"
                          className="mx-2 mb-1 border-t border-line"
                        />
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-action"
                          onClick={() => {
                            setReactingId(null);
                            startReply(m);
                          }}
                        >
                          <ReplyIcon className="size-[18px]" />
                          Reply to message
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-action"
                          onClick={() => {
                            setReactingId(null);
                            setEmojiTarget(m.id);
                            inputRef.current?.focus();
                          }}
                        >
                          <Plus className="size-[18px]" />
                          More reactions
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-action text-danger"
                            onClick={() => {
                              deleteAnchorRef.current = actionAnchor;
                              setReactingId(null);
                              setDeletingMessage(m);
                            }}
                          >
                            <TrashIcon className="size-[18px]" />
                            Delete message
                          </button>
                        )}
                      </FloatingMenu>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {typing && (
          <div className="mt-3 flex items-center gap-2 self-start">
            <Avatar
              name={nameOf(user)}
              src={user.avatarUrl}
              size={MESSAGE_AVATAR}
            />
            <div
              className="flex gap-1 rounded-[20px] rounded-bl-md bg-bubble px-4 py-3.5 shadow-bubble"
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
        {showJump && (
          <button
            type="button"
            className="absolute right-6 bottom-full z-10 mb-3 flex min-h-11 animate-pop items-center gap-2 rounded-full border border-line bg-panel px-4 text-xs font-semibold text-fg shadow-pop transition hover:bg-panel-2"
            onClick={() => {
              listRef.current?.scrollTo({
                top: listRef.current.scrollHeight,
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
              });
            }}
          >
            <ArrowDown className="size-4" /> Latest messages
          </button>
        )}
        {emojiOpen && (
          <div className="absolute bottom-full left-3 z-10 mb-2 w-[min(350px,calc(100%-1.5rem))] animate-pop">
            {emojiTarget !== "draft" && (
              <p className="mb-1.5 w-fit rounded-full bg-linear-to-br from-fill to-fill-2 px-3 py-1 text-xs font-semibold text-white shadow-pop">
                Pick a reaction for the highlighted message
              </p>
            )}
            <div className="rounded-2xl shadow-pop">
              <Suspense
                fallback={
                  <div className="grid h-95 place-items-center rounded-2xl border border-line bg-panel text-muted">
                    Loading…
                  </div>
                }
              >
                <EmojiPicker onPick={handleEmojiPick} />
              </Suspense>
            </div>
          </div>
        )}
        <form
          className="composer flex flex-wrap items-end gap-2"
          onSubmit={handleSubmit}
        >
          {error && (
            <p className={cx(ui.error, "basis-full")} role="alert">
              {error}
            </p>
          )}
          {replyingTo && (
            <div className="flex basis-full items-center gap-2 rounded-xl border-l-3 border-accent bg-accent-soft/60 py-1.5 pr-1.5 pl-3 text-sm">
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
                className={cx(ui.iconBtn, "size-11")}
                onClick={() => updateReply(null)}
                aria-label="Cancel reply"
              >
                <X className="size-4.5" />
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
                    <X className="size-3.5" strokeWidth={2.5} />
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
          {/* The text box and its two buttons share one rounded field. */}
          <div className="composer-field flex min-w-0 basis-full items-end gap-1">
            <button
              type="button"
              className={composerButton}
              onClick={() => fileRef.current?.click()}
              disabled={sendingImage}
              aria-label="Attach an image"
              title="Attach an image"
            >
              <ImageIcon className="size-5.5" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className={cx(
                composerButton,
                emojiTarget === "draft" && "bg-accent-soft text-accent",
              )}
              onClick={() =>
                setEmojiTarget((target) =>
                  target === "draft" ? null : "draft",
                )
              }
              aria-label="Emoji"
              aria-expanded={emojiTarget === "draft"}
              title="Emoji"
            >
              <SmileIcon className="size-5.5" strokeWidth={1.9} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={stopTyping}
              placeholder="Write a message…"
              maxLength={MAX_MESSAGE_LENGTH}
              aria-label={`Message ${nameOf(user)}`}
              className="field-sizing-content max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-muted"
            />
            <button
              className={cx(
                ui.primaryBase,
                "send-button grid size-11 flex-none place-items-center rounded-[13px]",
              )}
              type="submit"
              disabled={(!draft.trim() && !attachment) || sendingImage}
              aria-label="Send"
              title="Send"
            >
              <Send className="size-5 -translate-x-px translate-y-px" />
            </button>
          </div>
          <div className="flex basis-full items-center justify-between px-1 text-[11px] text-muted max-md:hidden">
            <span>
              <span className="font-medium">Enter</span> to send{" "}
              <span className="mx-1.5 opacity-40">·</span> Shift + Enter for a
              new line
            </span>
            <span>
              {draft.length > 1600
                ? `${draft.length} / ${MAX_MESSAGE_LENGTH}`
                : "Make it a conversation."}
            </span>
          </div>
        </form>
      </div>
      {deletingMessage && (
        <DeleteMessageDialog
          message={deletingMessage}
          onDelete={() => onDelete(deletingMessage.id)}
          onClose={() => {
            setDeletingMessage(null);
            (deleteAnchorRef.current?.isConnected
              ? deleteAnchorRef.current
              : inputRef.current
            )?.focus({ preventScroll: true });
          }}
        />
      )}
      {viewing && (
        <ImageViewer image={viewing} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}
