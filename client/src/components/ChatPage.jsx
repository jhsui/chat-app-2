import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api.js';
import Sidebar from './Sidebar.jsx';
import ChatWindow from './ChatWindow.jsx';

export default function ChatPage({ me, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null); // { id, username } of the person we're chatting with
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState({}); // live presence updates: userId -> boolean
  const [typing, setTyping] = useState({}); // userId -> boolean
  const [connected, setConnected] = useState(true);

  // Socket handlers are registered once, so they read current values through refs.
  const socketRef = useRef(null);
  const activeRef = useRef(null);
  const conversationsRef = useRef([]);
  const typingTimers = useRef({});
  const onLogoutRef = useRef(onLogout);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    onLogoutRef.current = onLogout;
  }, [onLogout]);

  const refreshConversations = useCallback(async () => {
    try {
      const { conversations } = await api.conversations();
      setConversations(conversations);
    } catch (err) {
      if (err.status === 401) onLogoutRef.current();
    }
  }, []);

  const markRead = useCallback((userId) => {
    socketRef.current?.emit('messages:read', { from: userId });
    setConversations((prev) => prev.map((c) => (c.id === userId ? { ...c, unread: 0 } : c)));
  }, []);

  const loadMessages = useCallback(
    async (user) => {
      setLoading(true);
      try {
        const data = await api.messages(user.id);
        if (activeRef.current?.id !== user.id) return; // user switched chats while loading
        setMessages(data.messages);
        setHasMore(data.hasMore);
        setOnline((o) => ({ ...o, [user.id]: data.user.online }));
        markRead(user.id);
      } finally {
        if (activeRef.current?.id === user.id) setLoading(false);
      }
    },
    [markRead],
  );

  // --- Real-time connection -------------------------------------------------
  useEffect(() => {
    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'unauthorized') onLogoutRef.current();
    });

    // After a dropped connection, re-fetch anything we may have missed.
    socket.io.on('reconnect', () => {
      refreshConversations();
      if (activeRef.current) loadMessages(activeRef.current);
    });

    socket.on('message:new', (msg) => {
      const incoming = msg.senderId !== me.id;
      const otherId = incoming ? msg.senderId : msg.recipientId;
      const isActive = activeRef.current?.id === otherId;

      if (isActive) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (incoming && document.visibilityState === 'visible') socket.emit('messages:read', { from: otherId });
      }
      if (incoming) setTyping((t) => ({ ...t, [otherId]: false }));

      if (!conversationsRef.current.some((c) => c.id === otherId)) {
        refreshConversations(); // first message with someone new
        return;
      }
      setConversations((prev) => {
        const current = prev.find((c) => c.id === otherId);
        if (!current) return prev;
        const updated = {
          ...current,
          lastBody: msg.body,
          lastSenderId: msg.senderId,
          lastAt: msg.createdAt,
          unread: isActive ? 0 : current.unread + (incoming ? 1 : 0),
        };
        return [updated, ...prev.filter((c) => c.id !== otherId)];
      });
    });

    socket.on('messages:read', ({ readerId, senderId, upToId }) => {
      if (senderId === me.id && activeRef.current?.id === readerId) {
        // The other person read our messages: show "Seen".
        const now = new Date().toISOString();
        setMessages((prev) =>
          prev.map((m) => (m.senderId === me.id && m.id <= upToId && !m.readAt ? { ...m, readAt: now } : m)),
        );
      }
      if (readerId === me.id) {
        // We read them in another tab.
        setConversations((prev) => prev.map((c) => (c.id === senderId ? { ...c, unread: 0 } : c)));
      }
    });

    socket.on('presence', ({ userId, online }) => {
      setOnline((o) => ({ ...o, [userId]: online }));
      if (!online) setTyping((t) => ({ ...t, [userId]: false }));
    });

    socket.on('typing', ({ from, typing }) => {
      clearTimeout(typingTimers.current[from]);
      setTyping((t) => ({ ...t, [from]: typing }));
      // Safety net in case the "stopped typing" event never arrives.
      if (typing) {
        typingTimers.current[from] = setTimeout(() => setTyping((t) => ({ ...t, [from]: false })), 5000);
      }
    });

    refreshConversations();

    const timers = typingTimers.current;
    return () => {
      socket.disconnect();
      Object.values(timers).forEach(clearTimeout);
    };
  }, [me.id, refreshConversations, loadMessages]);

  // Mark messages read when the user comes back to the tab.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && activeRef.current) markRead(activeRef.current.id);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markRead]);

  // --- Actions ----------------------------------------------------------------
  function openConversation(user) {
    if (activeRef.current?.id === user.id) return;
    const next = { id: user.id, username: user.username };
    activeRef.current = next;
    setActive(next);
    setMessages([]);
    setHasMore(false);
    loadMessages(next);
  }

  function closeConversation() {
    activeRef.current = null;
    setActive(null);
  }

  async function loadOlder() {
    if (!active || !messages.length || loading) return;
    const userId = active.id;
    setLoading(true);
    try {
      const data = await api.messages(userId, messages[0].id);
      if (activeRef.current?.id !== userId) return;
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(body) {
    const socket = socketRef.current;
    if (!socket?.connected) throw new Error("You're offline — message not sent");
    let res;
    try {
      res = await socket.timeout(5000).emitWithAck('message:send', { to: active.id, body });
    } catch {
      throw new Error('Message timed out — try again');
    }
    if (res.error) throw new Error(res.error);
  }

  function sendTyping(isTyping) {
    if (active) socketRef.current?.emit('typing', { to: active.id, typing: isTyping });
  }

  async function handleLogout() {
    socketRef.current?.disconnect();
    onLogout();
  }

  const isOnline = (user) => online[user.id] ?? user.online ?? false;

  return (
    <div className={`chat-layout ${active ? 'has-active' : ''}`}>
      <Sidebar
        me={me}
        conversations={conversations}
        activeId={active?.id}
        typing={typing}
        isOnline={isOnline}
        connected={connected}
        onSelect={openConversation}
        onLogout={handleLogout}
      />
      {active ? (
        <ChatWindow
          key={active.id}
          me={me}
          user={active}
          online={isOnline(active)}
          typing={Boolean(typing[active.id])}
          messages={messages}
          hasMore={hasMore}
          loading={loading}
          onLoadOlder={loadOlder}
          onSend={sendMessage}
          onTyping={sendTyping}
          onBack={closeConversation}
        />
      ) : (
        <section className="empty-chat">
          <div>
            <img src="/favicon.svg" alt="" width="56" height="56" />
            <h2>Your messages</h2>
            <p className="muted">Pick a conversation, or search for a username to start a new one.</p>
          </div>
        </section>
      )}
    </div>
  );
}
