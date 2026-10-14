/**
 * Shared Tailwind class strings for elements used in several components.
 * One-off styling lives directly in each component's JSX.
 */

/** Joins class names, skipping falsy values: cx('a', cond && 'b') */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const primaryBase = "liquid-accent font-semibold disabled:opacity-45";
const fieldBase =
  "glass-input w-full border border-line bg-panel-2 outline-none transition placeholder:text-muted focus:border-accent focus:bg-panel focus:ring-3 focus:ring-accent-soft";

export const ui = {
  /** Filled accent button (shape not included). */
  primaryBase,
  btnPrimary: `${primaryBase} min-h-11 rounded-full px-5 py-2.5`,
  btnGhost:
    "min-h-11 rounded-full px-4 py-2 text-muted transition hover:enabled:bg-panel-2 hover:enabled:text-fg active:enabled:scale-[0.96]",
  /** Round button holding just an icon (size not included). */
  iconBtn:
    "glass-control grid flex-none place-items-center text-muted hover:enabled:text-fg disabled:opacity-50",
  /** Text input / textarea look (shape not included). */
  fieldBase,
  input: `${fieldBase} rounded-xl px-3 py-2.5`,
  /** Floating glass bar at the top of the chat window. */
  header:
    "chat-header liquid-glass relative flex min-h-18 items-center gap-3 px-5 py-3 max-md:min-h-16 max-md:px-3",
  /** A name with a status line underneath (used in both headers). */
  nameBlock: "flex min-w-0 flex-col",
  status: "text-xs text-muted",
  error: "text-sm text-danger",
} as const;
