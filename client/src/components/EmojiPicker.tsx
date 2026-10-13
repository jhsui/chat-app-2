import { useAppearance } from "../theme.tsx";
import type { CSSProperties } from "react";
import Picker, { EmojiStyle, Theme } from "emoji-picker-react";

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
}

// The picker's colors, pointed at the app's own theme tokens (styles.css) so it
// matches in light and dark mode. Defined once: the picker re-renders whenever
// it's given a new style object.
const style = {
  "--epr-bg-color": "var(--panel)",
  "--epr-category-label-bg-color": "var(--panel)",
  "--epr-text-color": "var(--fg)",
  "--epr-category-label-text-color": "var(--muted)",
  "--epr-picker-border-color": "var(--line)",
  "--epr-search-input-bg-color": "var(--panel-2)",
  "--epr-search-input-bg-color-active": "var(--panel-2)",
  "--epr-search-input-text-color": "var(--fg)",
  "--epr-search-input-placeholder-color": "var(--muted)",
  "--epr-search-border-color": "var(--line)",
  "--epr-search-border-color-active": "var(--accent)",
  "--epr-hover-bg-color": "var(--accent-soft)",
  "--epr-focus-bg-color": "var(--accent-soft)",
  "--epr-highlight-color": "var(--accent)",
  "--epr-category-icon-active-color": "var(--accent)",
  "--epr-skin-tone-picker-menu-color": "var(--panel)",
  "--epr-picker-border-radius": "16px",
} as CSSProperties;

/**
 * The emoji picker shown above the message box. It's a thin wrapper around the
 * emoji-picker-react library, kept in its own file so ChatWindow can load it
 * (and the emoji data that comes with it) only when it's first opened.
 */
export default function EmojiPicker({ onPick }: EmojiPickerProps) {
  const { resolvedTheme } = useAppearance();
  return (
    <Picker
      onEmojiClick={(data) => onPick(data.emoji)}
      // The device's own emoji font, not images downloaded from a CDN.
      emojiStyle={EmojiStyle.NATIVE}
      theme={resolvedTheme === "dark" ? Theme.DARK : Theme.LIGHT}
      width="100%"
      height="min(380px, calc(100dvh - 170px))"
      previewConfig={{ showPreview: false }}
      autoFocusSearch={false}
      style={style}
    />
  );
}
