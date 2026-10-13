import { useRef, useState, type ReactNode } from "react";
import {
  LogOut,
  Search,
  SquarePen,
  MessageCircle,
  Users,
  ArrowUpRight,
} from "lucide-react";
import type { Conversation, Person, PublicUser } from "../../../shared/types";
import { formatShort, nameOf } from "../format.ts";
import { cx, ui } from "../ui.ts";
import Avatar from "./Avatar.tsx";
import Brand from "./Brand.tsx";
import { ThemeButton } from "../theme.tsx";

type Tab = "chats" | "people";

interface SidebarProps {
  me: PublicUser;
  conversations: Conversation[];
  people: Person[];
  /** Unsent text per chat, by the other person's id. Shown for chats that aren't open. */
  drafts: ReadonlyMap<number, string>;
  /** Called when the People tab is opened, to pick up anyone who signed up since. */
  onShowPeople: () => void;
  activeId: number | undefined;
  typing: Record<number, boolean>;
  isOnline: (user: { id: number; online?: boolean }) => boolean;
  connected: boolean;
  onSelect: (user: PublicUser) => void;
  /** Opens your own profile (from your avatar/name in the header). */
  onShowProfile: () => void;
  onLogout: () => void;
}

// Classes for the rows in both lists.
const row = {
  item: () => "conversation-row",
  text: "flex min-w-0 flex-1 flex-col gap-1",
  line: "flex items-center justify-between gap-2",
  title: "truncate font-semibold",
  sub: (unread: boolean) =>
    cx("truncate text-sm", unread ? "font-semibold text-fg" : "text-muted"),
  time: "flex-none text-xs text-muted",
  typing: "text-accent",
  section:
    "px-2.5 pt-4 pb-1.5 text-[0.7rem] font-bold tracking-widest text-muted uppercase",
  empty: "px-4 py-6 text-center text-sm text-muted",
};

/** Preview line for a chat you've typed in but not sent. */
function DraftPreview({ text }: { text: string }) {
  return (
    <>
      <span className="text-danger">Draft:</span> {text.trim()}
    </>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="grid h-5 min-w-5 flex-none place-items-center rounded-full bg-linear-to-br from-fill to-fill-2 px-1.5 text-xs font-bold text-white"
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * People tab order: online first; within each group, most recent chat first;
 * people you've never chatted with go last, A–Z.
 */
function sortPeople(
  people: Person[],
  isOnline: SidebarProps["isOnline"],
): Person[] {
  return [...people].sort((a, b) => {
    const onlineDiff = Number(isOnline(b)) - Number(isOnline(a));
    if (onlineDiff !== 0) return onlineDiff;
    if (a.lastAt !== b.lastAt) {
      if (!a.lastAt) return 1;
      if (!b.lastAt) return -1;
      return b.lastAt.localeCompare(a.lastAt); // ISO timestamps sort as strings
    }
    return nameOf(a).localeCompare(nameOf(b), undefined, {
      sensitivity: "base",
    });
  });
}

export default function Sidebar({
  me,
  conversations,
  people,
  drafts,
  onShowPeople,
  activeId,
  typing,
  isOnline,
  connected,
  onSelect,
  onShowProfile,
  onLogout,
}: SidebarProps) {
  const [tab, setTab] = useState<Tab>("chats");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  function switchTab(next: Tab) {
    setTab(next);
    setQuery("");
    if (next === "people") onShowPeople();
  }

  function pick(user: PublicUser) {
    setQuery("");
    onSelect(user);
  }

  const unreadById = new Map(
    conversations.map((c) => [c.id, c.id === activeId ? 0 : c.unread]),
  );
  // The open chat's draft is already on screen, in its text box.
  const draftOf = (userId: number) =>
    userId === activeId ? undefined : drafts.get(userId);
  const onlineCount = people.filter((p) => isOnline(p)).length;
  const q = query.trim().toLowerCase();

  const filteredConversations = conversations.filter((c) =>
    `${c.username} ${c.displayName ?? ""}`.toLowerCase().includes(q),
  );
  const tabClass = (selected: boolean) =>
    cx(
      "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold transition-all",
      selected ? "bg-panel text-fg shadow-bubble" : "text-muted hover:text-fg",
    );

  return (
    // On narrow screens the sidebar hides while a chat is open.
    <aside
      className={cx(
        "sidebar flex min-h-0 min-w-0 flex-col border-line md:border-r",
        activeId !== undefined && "max-md:hidden",
      )}
    >
      <header className="flex min-h-22 items-center justify-between px-6">
        <Brand />
        <ThemeButton />
      </header>
      <div className="flex items-center justify-between px-6 pt-5 pb-5">
        <div>
          <h1 className="text-[27px] leading-tight font-bold tracking-tight">
            Messages
          </h1>
          <p className="mt-1 text-xs text-muted">
            A little closer, wherever you are.
          </p>
        </div>
        <button
          type="button"
          className={cx(
            ui.primaryBase,
            "grid size-11 place-items-center rounded-[14px]",
          )}
          onClick={() => {
            switchTab("people");
            searchRef.current?.focus();
          }}
          aria-label="New chat"
          title="New chat"
        >
          <SquarePen className="size-5" />
        </button>
      </div>
      <div className="relative mx-5 mb-5">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          type="search"
          className={cx(ui.input, "h-11 pl-10 text-[13px]")}
          placeholder={
            tab === "chats" ? "Search conversations" : "Find someone to talk to"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={
            tab === "chats" ? "Search conversations" : "Search people"
          }
        />
      </div>
      <div
        className="mx-5 flex gap-1 rounded-[13px] bg-panel-2 p-1"
        role="tablist"
        aria-label="Sidebar"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          const next =
            e.key === "Home"
              ? "chats"
              : e.key === "End"
                ? "people"
                : tab === "chats"
                  ? "people"
                  : "chats";
          switchTab(next);
          e.currentTarget
            .querySelector<HTMLButtonElement>(`#tab-${next}`)
            ?.focus();
        }}
      >
        <button
          id="tab-chats"
          role="tab"
          aria-controls="sidebar-list"
          aria-selected={tab === "chats"}
          tabIndex={tab === "chats" ? 0 : -1}
          className={tabClass(tab === "chats")}
          onClick={() => switchTab("chats")}
        >
          <MessageCircle className="size-4" /> Chats
          <span className="rounded-md bg-panel-2 px-1.5 text-[11px] text-muted">
            {conversations.length}
          </span>
        </button>
        <button
          id="tab-people"
          role="tab"
          aria-controls="sidebar-list"
          aria-selected={tab === "people"}
          tabIndex={tab === "people" ? 0 : -1}
          className={tabClass(tab === "people")}
          onClick={() => switchTab("people")}
        >
          <Users className="size-4" /> People
          {onlineCount > 0 && (
            <span
              className="size-1.5 rounded-full bg-online"
              aria-label={`${onlineCount} online`}
            />
          )}
        </button>
      </div>
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <span className="eyebrow">
          {tab === "chats" ? "Your conversations" : "Your community"}
        </span>
        <span className="text-[11px] text-muted">
          {tab === "chats" ? filteredConversations.length : people.length}
        </span>
      </div>
      <ul
        id="sidebar-list"
        aria-labelledby={`tab-${tab}`}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pt-1 pb-4"
        role="tabpanel"
      >
        {tab === "people" ? (
          <PeopleList
            people={sortPeople(
              people.filter((p) =>
                `${p.username} ${p.displayName ?? ""}`
                  .toLowerCase()
                  .includes(q),
              ),
              isOnline,
            )}
            filtered={q.length > 0}
            activeId={activeId}
            typing={typing}
            unreadById={unreadById}
            draftOf={draftOf}
            isOnline={isOnline}
            onSelect={pick}
          />
        ) : (
          <>
            {filteredConversations.map((c) => {
              const unread = unreadById.get(c.id) ?? 0;
              const draft = draftOf(c.id);
              const preview = typing[c.id] ? (
                <em className={row.typing}>typing…</em>
              ) : draft ? (
                <DraftPreview text={draft} />
              ) : (
                `${c.lastSenderId === me.id ? "You: " : ""}${c.lastIsDeleted ? "Message deleted" : c.lastIsImage ? "📷 Photo" : c.lastBody}`
              );
              return (
                <li key={c.id}>
                  <button
                    className={row.item()}
                    data-active={c.id === activeId}
                    aria-current={c.id === activeId ? "true" : undefined}
                    data-name={c.username}
                    onClick={() => onSelect(c)}
                  >
                    <Avatar
                      name={nameOf(c)}
                      src={c.avatarUrl}
                      online={isOnline(c)}
                      size={44}
                    />
                    <span className={row.text}>
                      <span className={row.line}>
                        <span className={row.title}>{nameOf(c)}</span>
                        <span className={row.time}>
                          {formatShort(c.lastAt)}
                        </span>
                      </span>
                      <span className={row.line}>
                        <span className={row.sub(unread > 0)}>{preview}</span>
                        <UnreadBadge count={unread} />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {filteredConversations.length === 0 && (
              <li className={row.empty}>
                <MessageCircle className="mx-auto mb-3 size-7 text-accent" />
                <p className="font-semibold text-fg">
                  {q
                    ? "No conversations found"
                    : "Your next conversation starts here"}
                </p>
                <p className="mt-1">
                  {q
                    ? "Try another name, or find someone in People."
                    : "Find someone and send your first hello."}
                </p>
                <button
                  className="mt-4 inline-flex items-center gap-1 font-semibold text-accent"
                  onClick={() => switchTab("people")}
                >
                  Explore people <ArrowUpRight className="size-4" />
                </button>
              </li>
            )}
          </>
        )}
      </ul>
      <footer className="mx-4 flex items-center gap-2 border-t border-line py-4">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left transition hover:bg-panel-2"
          onClick={onShowProfile}
          aria-label="Your profile"
        >
          <Avatar name={nameOf(me)} src={me.avatarUrl} size={38} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <strong className="truncate text-[13px]">{nameOf(me)}</strong>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className={cx(
                  "size-1.5 rounded-full",
                  connected ? "bg-online" : "bg-danger",
                )}
              />
              {connected ? "Online" : "Reconnecting…"}
            </span>
          </span>
        </button>
        <button
          className={cx(ui.iconBtn, "size-11")}
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut className="size-[18px]" />
        </button>
      </footer>
    </aside>
  );
}

interface PeopleListProps {
  people: Person[];
  filtered: boolean;
  activeId: number | undefined;
  typing: Record<number, boolean>;
  unreadById: Map<number, number>;
  draftOf: (userId: number) => string | undefined;
  isOnline: SidebarProps["isOnline"];
  onSelect: (user: PublicUser) => void;
}

/** The People tab: everyone, split into Online and Offline sections. */
function PeopleList({
  people,
  filtered,
  activeId,
  typing,
  unreadById,
  draftOf,
  isOnline,
  onSelect,
}: PeopleListProps) {
  if (people.length === 0) {
    return (
      <li className={row.empty}>
        {filtered
          ? "No one matches that name."
          : "No one else has signed up yet. Invite a friend!"}
      </li>
    );
  }

  const online = people.filter((p) => isOnline(p));
  const offline = people.filter((p) => !isOnline(p));

  const renderPerson = (p: Person): ReactNode => {
    const unread = unreadById.get(p.id) ?? 0;
    const isOn = isOnline(p);
    const draft = draftOf(p.id);
    return (
      <li key={p.id}>
        <button
          className={row.item()}
          data-active={p.id === activeId}
          aria-current={p.id === activeId ? "true" : undefined}
          data-name={p.username}
          onClick={() => onSelect(p)}
        >
          <Avatar name={nameOf(p)} src={p.avatarUrl} online={isOn} size={44} />
          <span className={row.text}>
            <span className={row.line}>
              <span className={row.title}>{nameOf(p)}</span>
              {p.lastAt && (
                <span className={row.time}>{formatShort(p.lastAt)}</span>
              )}
            </span>
            <span className={row.line}>
              <span className={row.sub(unread > 0)}>
                {typing[p.id] ? (
                  <em className={row.typing}>typing…</em>
                ) : draft ? (
                  <DraftPreview text={draft} />
                ) : isOn ? (
                  "Online"
                ) : (
                  "Offline"
                )}
              </span>
              <UnreadBadge count={unread} />
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <>
      {online.length > 0 && (
        <li className={row.section}>Online — {online.length}</li>
      )}
      {online.map(renderPerson)}
      {offline.length > 0 && (
        <li className={row.section}>Offline — {offline.length}</li>
      )}
      {offline.map(renderPerson)}
    </>
  );
}
