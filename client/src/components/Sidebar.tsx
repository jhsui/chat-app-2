import { useEffect, useState, type ReactNode } from 'react';
import type { Conversation, Person, PublicUser, UserWithPresence } from '../../../shared/types';
import { api } from '../api.ts';
import { formatShort } from '../format.ts';
import Avatar from './Avatar.tsx';

type Tab = 'chats' | 'people';

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

/**
 * People tab order: online first; within each group, most recent chat first;
 * people you've never chatted with go last, A–Z.
 */
function sortPeople(people: Person[], isOnline: SidebarProps['isOnline']): Person[] {
  return [...people].sort((a, b) => {
    const onlineDiff = Number(isOnline(b)) - Number(isOnline(a));
    if (onlineDiff !== 0) return onlineDiff;
    if (a.lastAt !== b.lastAt) {
      if (!a.lastAt) return 1;
      if (!b.lastAt) return -1;
      return b.lastAt.localeCompare(a.lastAt); // ISO timestamps sort as strings
    }
    return a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
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
  const [tab, setTab] = useState<Tab>('chats');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserWithPresence[]>([]);
  const [searching, setSearching] = useState(false);

  // Chats tab: debounced server-side user search.
  useEffect(() => {
    const q = query.trim();
    if (tab !== 'chats' || !q) {
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
    setQuery('');
    if (next === 'people') onShowPeople();
  }

  function pick(user: PublicUser) {
    setQuery('');
    onSelect(user);
  }

  const unreadById = new Map(conversations.map((c) => [c.id, c.id === activeId ? 0 : c.unread]));
  const onlineCount = people.filter((p) => isOnline(p)).length;
  const q = query.trim().toLowerCase();

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="me">
          <Avatar name={me.username} size={36} />
          <div>
            <strong>{me.username}</strong>
            <span className={`status ${connected ? 'ok' : ''}`}>{connected ? 'Online' : 'Reconnecting…'}</span>
          </div>
        </div>
        <button className="btn-ghost" onClick={onLogout}>
          Log out
        </button>
      </header>

      <div className="tabs" role="tablist" aria-label="Sidebar">
        <button role="tab" aria-selected={tab === 'chats'} className="tab" onClick={() => switchTab('chats')}>
          Chats
        </button>
        <button role="tab" aria-selected={tab === 'people'} className="tab" onClick={() => switchTab('people')}>
          People
          {onlineCount > 0 && (
            <span className="tab-count" aria-label={`${onlineCount} online`}>
              {onlineCount}
            </span>
          )}
        </button>
      </div>

      <div className="search">
        <input
          type="search"
          placeholder={tab === 'chats' ? 'Search people…' : 'Filter people…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={tab === 'chats' ? 'Search people by username' : 'Filter the people list'}
        />
      </div>

      <ul className="list" role="tabpanel">
        {tab === 'people' ? (
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
                <button className="list-item" onClick={() => pick(u)}>
                  <Avatar name={u.username} online={isOnline(u)} />
                  <span className="list-text">
                    <span className="list-title">{u.username}</span>
                    <span className="list-sub">Start a conversation</span>
                  </span>
                </button>
              </li>
            ))}
            {!searching && results.length === 0 && <li className="list-empty">No one found with that name.</li>}
          </>
        ) : (
          <>
            {conversations.map((c) => {
              const unread = unreadById.get(c.id) ?? 0;
              const preview = typing[c.id] ? (
                <em className="typing-text">typing…</em>
              ) : (
                `${c.lastSenderId === me.id ? 'You: ' : ''}${c.lastBody}`
              );
              return (
                <li key={c.id}>
                  <button
                    className={`list-item ${c.id === activeId ? 'active' : ''} ${unread ? 'unread' : ''}`}
                    onClick={() => onSelect(c)}
                  >
                    <Avatar name={c.username} online={isOnline(c)} />
                    <span className="list-text">
                      <span className="list-row">
                        <span className="list-title">{c.username}</span>
                        <span className="list-time">{formatShort(c.lastAt)}</span>
                      </span>
                      <span className="list-row">
                        <span className="list-sub">{preview}</span>
                        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {conversations.length === 0 && (
              <li className="list-empty">
                No conversations yet. Open <strong>People</strong> or search above to say hi.
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
  isOnline: SidebarProps['isOnline'];
  onSelect: (user: PublicUser) => void;
}

/** The People tab: everyone, split into Online and Offline sections. */
function PeopleList({ people, filtered, activeId, typing, unreadById, isOnline, onSelect }: PeopleListProps) {
  if (people.length === 0) {
    return (
      <li className="list-empty">
        {filtered ? 'No one matches that name.' : 'No one else has signed up yet. Invite a friend!'}
      </li>
    );
  }

  const online = people.filter((p) => isOnline(p));
  const offline = people.filter((p) => !isOnline(p));

  const row = (p: Person): ReactNode => {
    const unread = unreadById.get(p.id) ?? 0;
    const isOn = isOnline(p);
    return (
      <li key={p.id}>
        <button
          className={`list-item ${p.id === activeId ? 'active' : ''} ${unread ? 'unread' : ''}`}
          onClick={() => onSelect(p)}
        >
          <Avatar name={p.username} online={isOn} />
          <span className="list-text">
            <span className="list-row">
              <span className="list-title">{p.username}</span>
              {p.lastAt && <span className="list-time">{formatShort(p.lastAt)}</span>}
            </span>
            <span className="list-row">
              <span className="list-sub">
                {typing[p.id] ? <em className="typing-text">typing…</em> : isOn ? 'Online' : 'Offline'}
              </span>
              {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <>
      {online.length > 0 && <li className="list-section">Online — {online.length}</li>}
      {online.map(row)}
      {offline.length > 0 && <li className="list-section">Offline — {offline.length}</li>}
      {offline.map(row)}
    </>
  );
}
