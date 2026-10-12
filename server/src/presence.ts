export interface Presence {
  /** Returns true if this was the user's first connection. */
  connect(userId: number): boolean;
  /** Returns true if this was the user's last connection. */
  disconnect(userId: number): boolean;
  isOnline(userId: number): boolean;
}

/**
 * Tracks how many open sockets each user has, so a user with two tabs open
 * only goes "offline" once both are closed.
 */
export function createPresence(): Presence {
  const counts = new Map<number, number>();

  return {
    connect(userId) {
      const n = (counts.get(userId) ?? 0) + 1;
      counts.set(userId, n);
      return n === 1;
    },
    disconnect(userId) {
      const n = (counts.get(userId) ?? 1) - 1;
      if (n <= 0) {
        counts.delete(userId);
        return true;
      }
      counts.set(userId, n);
      return false;
    },
    isOnline: (userId) => counts.has(userId),
  };
}
