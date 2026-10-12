const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Yesterday", or a date like "Mon, Oct 5". */
export function formatDay(iso) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** Compact timestamp for the conversation list. */
export function formatShort(iso) {
  const d = new Date(iso);
  if (sameDay(d, new Date())) return formatTime(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function isSameDay(isoA, isoB) {
  return sameDay(new Date(isoA), new Date(isoB));
}
