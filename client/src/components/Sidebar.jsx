import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatShort } from '../format.js';
import Avatar from './Avatar.jsx';

export default function Sidebar({ me, conversations, activeId, typing, isOnline, connected, onSelect, onLogout }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Debounced user search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
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
  }, [query]);

  function pick(user) {
    setQuery('');
    onSelect(user);
  }

  const isSearching = query.trim().length > 0;

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

      <div className="search">
        <input
          type="search"
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search people by username"
        />
      </div>

      <ul className="list">
        {isSearching ? (
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
              const unread = c.id === activeId ? 0 : c.unread;
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
              <li className="list-empty">No conversations yet. Search for a username above to say hi.</li>
            )}
          </>
        )}
      </ul>
    </aside>
  );
}
