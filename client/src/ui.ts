/**
 * Shared Tailwind class strings for elements used in several components.
 * One-off styling lives directly in each component's JSX.
 */

/** Joins class names, skipping falsy values: cx('a', cond && 'b') */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const primaryBase =
  "bg-linear-to-br from-fill to-fill-2 font-semibold text-white shadow-bubble transition-all duration-200 hover:enabled:brightness-110 active:enabled:scale-[0.97] disabled:opacity-45";
const fieldBase =
  "w-full border border-line bg-panel-2 outline-none transition placeholder:text-muted focus:border-accent focus:bg-panel focus:ring-3 focus:ring-accent-soft";

export const ui = {
  /** Filled accent button (shape not included). */
  primaryBase,
  btnPrimary: `${primaryBase} min-h-11 rounded-xl px-5 py-2.5`,
  btnGhost:
    "min-h-11 rounded-xl px-3 py-2 text-muted transition-colors hover:enabled:bg-panel-2 hover:enabled:text-fg",
  /** Round button holding just an icon (size not included). */
  iconBtn:
    "grid flex-none place-items-center rounded-xl text-muted transition-all hover:enabled:bg-panel-2 hover:enabled:text-fg active:enabled:scale-95 disabled:opacity-50",
  /** Text input / textarea look (shape not included). */
  fieldBase,
  input: `${fieldBase} rounded-xl px-3 py-2.5`,
  /** Top bar of the sidebar and of the chat window. */
  header:
    "chat-header relative z-10 flex min-h-22 items-center gap-3 border-b border-line px-7 py-4 max-md:min-h-19 max-md:px-4",
  /** A name with a status line underneath (used in both headers). */
  nameBlock: "flex min-w-0 flex-col",
  status: "text-xs text-muted",
  error: "text-sm text-danger",
} as const;
