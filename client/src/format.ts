/** The name to show for someone: their display name if set, else the username. */
export function nameOf(user: {
  username: string;
  displayName: string | null;
}): string {
  return user.displayName || user.username;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A full timestamp with the date as year-month-day, like "2026-10-12 15:04:05" (local time). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${d.toLocaleTimeString()}`;
}

/** "Today", "Yesterday", or a date like "Mon, Oct 5". */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Compact timestamp for the conversation list. */
export function formatShort(iso: string): string {
  const d = new Date(iso);
  if (sameDay(d, new Date())) return formatTime(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function isSameDay(isoA: string, isoB: string): boolean {
  return sameDay(new Date(isoA), new Date(isoB));
}

/** Milliseconds between two ISO timestamps (b − a). */
export function msBetween(isoA: string, isoB: string): number {
  return new Date(isoB).getTime() - new Date(isoA).getTime();
}
