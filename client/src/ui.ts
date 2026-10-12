/**
 * Shared Tailwind class strings for elements used in several components.
 * One-off styling lives directly in each component's JSX.
 */

/** Joins class names, skipping falsy values: cx('a', cond && 'b') */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const primaryBase =
  "bg-accent font-semibold text-white transition-colors hover:enabled:bg-accent-hover disabled:opacity-50";
const fieldBase =
  "w-full border border-line bg-panel-2 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent-soft";

export const ui = {
  /** Filled accent button (shape not included). */
  primaryBase,
  btnPrimary: `${primaryBase} rounded-[10px] px-4 py-2.5`,
  btnGhost:
    "rounded-lg px-3 py-1.5 text-muted hover:enabled:bg-panel-2 hover:enabled:text-fg",
  /** Text input / textarea look (shape not included). */
  fieldBase,
  input: `${fieldBase} rounded-[10px] px-3 py-2.5`,
  /** Top bar of the sidebar and of the chat window. */
  header:
    "flex min-h-[66px] items-center gap-3 border-b border-line px-4 py-3.5",
  /** A name with a status line underneath (used in both headers). */
  nameBlock: "flex min-w-0 flex-col",
  status: "text-xs text-muted",
  error: "text-sm text-danger",
} as const;
