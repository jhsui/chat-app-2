/**
 * Shared Tailwind class strings for elements used in several components.
 * One-off styling lives directly in each component's JSX.
 */

/** Joins class names, skipping falsy values: cx('a', cond && 'b') */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const primaryBase =
  "bg-fill font-semibold text-white transition-colors hover:enabled:bg-fill-hover disabled:opacity-40";
const fieldBase =
  "w-full rounded-lg border border-line bg-field outline-none transition placeholder:text-muted focus:border-accent focus:ring-3 focus:ring-accent-soft";

export const ui = {
  /** Filled accent button (shape not included). */
  primaryBase,
  btnPrimary: `${primaryBase} min-h-10 rounded-lg px-4 py-2`,
  /** Quiet button; takes the surrounding text colour unless given one. */
  btnGhost:
    "min-h-10 rounded-lg px-3 py-2 transition-colors hover:enabled:bg-panel-2 disabled:opacity-50",
  /** Round button holding just an icon (size not included). */
  iconBtn:
    "grid flex-none place-items-center rounded-full text-muted transition-colors hover:enabled:bg-panel-2 hover:enabled:text-fg disabled:opacity-50",
  /** Text input / textarea look (shape not included). */
  fieldBase,
  input: `${fieldBase} px-3 py-2`,
  error: "text-sm text-danger",
} as const;
