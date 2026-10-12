import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, formatTime, isSameDay } from '../format.js';
import Avatar from './Avatar.jsx';

const GROUP_GAP_MS = 5 * 60 * 1000;

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
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const scrollState = useRef({ firstId: null, lastId: null, height: 0, nearBottom: true });
  const typingState = useRef({ active: false, timer: null });

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
      if (s.nearBottom || mine || s.lastId === null) el.scrollTop = el.scrollHeight;
    }
    scrollState.current = { ...s, firstId, lastId, height: el.scrollHeight };
  }, [messages, me.id]);

  // Show the typing bubble without hiding the latest message.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (typing && el && scrollState.current.nearBottom) el.scrollTop = el.scrollHeight;
  }, [typing]);

  useEffect(() => {
    inputRef.current?.focus();
    const t = typingState.current;
    return () => clearTimeout(t.timer);
  }, []);

  function handleScroll() {
    const el = listRef.current;
    scrollState.current.nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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

  function handleChange(e) {
    setDraft(e.target.value);
    setError('');
    const t = typingState.current;
    if (!t.active) {
      t.active = true;
      onTyping(true);
    }
    clearTimeout(t.timer);
    t.timer = setTimeout(stopTyping, 2000);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    // Clear right away so fast typers can keep going; put the text back if it fails.
    setDraft('');
    stopTyping();
    inputRef.current?.focus();
    try {
      await onSend(body);
    } catch (err) {
      setError(err.message);
      setDraft((current) => current || body);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // My most recent message shows "Sent" or "Seen".
  const lastMineId = [...messages].reverse().find((m) => m.senderId === me.id)?.id;

  return (
    <section className="chat">
      <header className="chat-header">
        <button className="btn-ghost back" onClick={onBack} aria-label="Back to conversations">
          ←
        </button>
        <Avatar name={user.username} online={online} size={38} />
        <div>
          <strong>{user.username}</strong>
          <span className="status">{typing ? 'typing…' : online ? 'Online' : 'Offline'}</span>
        </div>
      </header>

      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {hasMore && (
          <button className="btn-ghost load-older" onClick={onLoadOlder} disabled={loading}>
            {loading ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {!loading && messages.length === 0 && (
          <p className="chat-intro muted">
            This is the start of your conversation with <strong>{user.username}</strong>. Say hi!
          </p>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const mine = m.senderId === me.id;
          const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt);
          const groupedWithPrev =
            !newDay && prev?.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < GROUP_GAP_MS;
          const groupedWithNext =
            next &&
            next.senderId === m.senderId &&
            isSameDay(m.createdAt, next.createdAt) &&
            new Date(next.createdAt) - new Date(m.createdAt) < GROUP_GAP_MS;

          return (
            <div key={m.id}>
              {newDay && (
                <div className="day-divider">
                  <span>{formatDay(m.createdAt)}</span>
                </div>
              )}
              <div className={`msg ${mine ? 'mine' : 'theirs'} ${groupedWithPrev ? 'grouped' : ''}`}>
                <div className="bubble" title={new Date(m.createdAt).toLocaleString()}>
                  {m.body}
                </div>
                {!groupedWithNext && (
                  <div className="meta">
                    {formatTime(m.createdAt)}
                    {mine && m.id === lastMineId && (m.readAt ? ' · Seen' : ' · Sent')}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {typing && (
          <div className="msg theirs">
            <div className="bubble typing-bubble" aria-label={`${user.username} is typing`}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        {error && (
          <p className="error composer-error" role="alert">
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
          placeholder={`Message ${user.username}`}
          maxLength={2000}
          aria-label={`Message ${user.username}`}
        />
        <button className="btn-primary send" type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
