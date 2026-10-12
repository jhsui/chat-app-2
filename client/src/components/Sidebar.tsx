import { useEffect, useState, type ReactNode } from "react";
import type {
  Conversation,
  Person,
  PublicUser,
  UserWithPresence,
} from "../../../shared/types";
import { api } from "../api.ts";
import { formatShort } from "../format.ts";
import { cx, ui } from "../ui.ts";
import Avatar from "./Avatar.tsx";

type Tab = "chats" | "people";

interface SidebarProps {
  me: PublicUser;
  conversations: Conversation[];
  people: Person[];
  /** Called when the People tab is opened, to pick up anyone who signed up since. */
  onShowPeople: () => void;
  activeId: number | undefined;
  typing: Record<number, boolean>;
  isOnline: (user: { id: number; online?: boolean }) => boolean;
  connected: boolean;
  onSelect: (user: PublicUser) => void;
  onLogout: () => void;
}

// Classes for the rows in both lists.
const row = {
  item: (active: boolean) =>
    cx(
      "flex w-full items-center gap-3 rounded-xl p-2.5 text-left",
      active ? "bg-accent-soft" : "hover:bg-panel-2",
    ),
  text: "flex min-w-0 flex-1 flex-col gap-0.5",
  line: "flex items-center justify-between gap-2",
  title: "truncate font-semibold",
  sub: (unread: boolean) =>
    cx("truncate text-sm", unread ? "font-semibold text-fg" : "text-muted"),
  time: "flex-none text-xs text-muted",
  typing: "text-accent",
  section:
    "px-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-muted uppercase",
  empty: "px-4 py-6 text-center text-sm text-muted",
};

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="grid h-5 min-w-5 flex-none place-items-center rounded-full bg-accent px-1.5 text-[0.72rem] font-bold text-white"
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
    return a.username.localeCompare(b.username, undefined, {
      sensitivity: "base",
    });
  });
}

export default function Sidebar({
  me,
  conversations,
  people,
  onShowPeople,
  activeId,
  typing,
  isOnline,
  connected,
  onSelect,
  onLogout,
}: SidebarProps) {
  const [tab, setTab] = useState<Tab>("chats");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserWithPresence[]>([]);
  const [searching, setSearching] = useState(false);

  // Chats tab: debounced server-side user search.
  useEffect(() => {
    const q = query.trim();
    if (tab !== "chats" || !q) {
      setResults([]);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(q);
        if (!cancelled) setResults(users);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab]);

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
  const onlineCount = people.filter((p) => isOnline(p)).length;
  const q = query.trim().toLowerCase();

  const tabClass = (selected: boolean) =>
    cx(
      "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pt-2 pb-2.5 font-semibold",
      selected
        ? "border-accent text-accent"
        : "border-transparent text-muted hover:text-fg",
    );

  return (
    // On narrow screens the sidebar hides while a chat is open.
    <aside
      className={cx(
        "flex min-h-0 flex-col border-r border-line",
        activeId !== undefined && "max-md:hidden",
      )}
    >
      <header className={cx(ui.header, "justify-between")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={me.username} size={36} />
          <div className={ui.nameBlock}>
            <strong>{me.username}</strong>
            <span className={ui.status}>
              {connected && (
                <span className="mr-1.5 inline-block size-1.75 rounded-full bg-online align-[1px]" />
              )}
              {connected ? "Online" : "Reconnecting…"}
            </span>
          </div>
        </div>
        <button className={ui.btnGhost} onClick={onLogout}>
          Log out
        </button>
      </header>

      <div
        className="flex gap-1 border-b border-line px-4 pt-2.5"
        role="tablist"
        aria-label="Sidebar"
      >
        <button
          role="tab"
          aria-selected={tab === "chats"}
          className={tabClass(tab === "chats")}
          onClick={() => switchTab("chats")}
        >
          Chats
        </button>
        <button
          role="tab"
          aria-selected={tab === "people"}
          className={tabClass(tab === "people")}
          onClick={() => switchTab("people")}
        >
          People
          {onlineCount > 0 && (
            <span
              className="inline-grid h-4.5 min-w-5 place-items-center rounded-full bg-online/20 px-1.5 text-xs font-bold text-green-700 dark:text-green-300"
              aria-label={`${onlineCount} online`}
            >
              {onlineCount}
            </span>
          )}
        </button>
      </div>

      <div className="px-4 pt-3 pb-2">
        <input
          type="search"
          className={ui.input}
          placeholder={tab === "chats" ? "Search people…" : "Filter people…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={
            tab === "chats"
              ? "Search people by username"
              : "Filter the people list"
          }
        />
      </div>

      <ul className="flex-1 overflow-y-auto px-2 pt-1 pb-4" role="tabpanel">
        {tab === "people" ? (
          <PeopleList
            people={sortPeople(
              people.filter((p) => p.username.toLowerCase().includes(q)),
              isOnline,
            )}
            filtered={q.length > 0}
            activeId={activeId}
            typing={typing}
            unreadById={unreadById}
            isOnline={isOnline}
            onSelect={pick}
          />
        ) : q ? (
          <>
            {results.map((u) => (
              <li key={u.id}>
                <button
                  className={row.item(false)}
                  data-name={u.username}
                  onClick={() => pick(u)}
                >
                  <Avatar name={u.username} online={isOnline(u)} />
                  <span className={row.text}>
                    <span className={row.title}>{u.username}</span>
                    <span className={row.sub(false)}>Start a conversation</span>
                  </span>
                </button>
              </li>
            ))}
            {!searching && results.length === 0 && (
              <li className={row.empty}>No one found with that name.</li>
            )}
          </>
        ) : (
          <>
            {conversations.map((c) => {
              const unread = unreadById.get(c.id) ?? 0;
              const preview = typing[c.id] ? (
                <em className={row.typing}>typing…</em>
              ) : (
                `${c.lastSenderId === me.id ? "You: " : ""}${c.lastBody}`
              );
              return (
                <li key={c.id}>
                  <button
                    className={row.item(c.id === activeId)}
                    data-name={c.username}
                    onClick={() => onSelect(c)}
                  >
                    <Avatar name={c.username} online={isOnline(c)} />
                    <span className={row.text}>
                      <span className={row.line}>
                        <span className={row.title}>{c.username}</span>
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
            {conversations.length === 0 && (
              <li className={row.empty}>
                No conversations yet. Open <strong>People</strong> or search
                above to say hi.
              </li>
            )}
          </>
        )}
      </ul>
    </aside>
  );
}

interface PeopleListProps {
  people: Person[];
  filtered: boolean;
  activeId: number | undefined;
  typing: Record<number, boolean>;
  unreadById: Map<number, number>;
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
    return (
      <li key={p.id}>
        <button
          className={row.item(p.id === activeId)}
          data-name={p.username}
          onClick={() => onSelect(p)}
        >
          <Avatar name={p.username} online={isOn} />
          <span className={row.text}>
            <span className={row.line}>
              <span className={row.title}>{p.username}</span>
              {p.lastAt && (
                <span className={row.time}>{formatShort(p.lastAt)}</span>
              )}
            </span>
            <span className={row.line}>
              <span className={row.sub(unread > 0)}>
                {typing[p.id] ? (
                  <em className={row.typing}>typing…</em>
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
