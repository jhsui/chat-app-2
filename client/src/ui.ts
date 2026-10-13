/**
 * Shared Tailwind class strings for elements used in several components.
 * One-off styling lives directly in each component's JSX.
 */

/** Joins class names, skipping falsy values: cx('a', cond && 'b') */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const primaryBase =
  "bg-linear-to-br from-fill to-fill-2 font-semibold text-white shadow-bubble transition hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:opacity-45";
const fieldBase =
  "w-full border border-line bg-panel-2 outline-none transition placeholder:text-muted focus:border-accent focus:bg-panel focus:ring-3 focus:ring-accent-soft";

export const ui = {
  /** Filled accent button (shape not included). */
  primaryBase,
  btnPrimary: `${primaryBase} rounded-xl px-4 py-2.5`,
  btnGhost:
    "rounded-lg px-3 py-1.5 text-muted transition-colors hover:enabled:bg-panel-2 hover:enabled:text-fg",
  /** Round button holding just an icon (size not included). */
  iconBtn:
    "grid flex-none place-items-center rounded-full text-muted transition-colors hover:enabled:bg-panel-2 hover:enabled:text-fg disabled:opacity-50",
  /** Text input / textarea look (shape not included). */
  fieldBase,
  input: `${fieldBase} rounded-xl px-3 py-2.5`,
  /** Top bar of the sidebar and of the chat window. */
  header:
    "flex min-h-[68px] items-center gap-3 border-b border-line bg-panel px-4 py-3.5",
  /** A name with a status line underneath (used in both headers). */
  nameBlock: "flex min-w-0 flex-col",
  status: "text-xs text-muted",
  error: "text-sm text-danger",
} as const;
