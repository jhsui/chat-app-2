import type { CSSProperties } from "react";
import { cx } from "../ui.ts";

function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

interface AvatarProps {
  name: string;
  /** Pass a boolean to show a presence dot; leave undefined to hide it. */
  online?: boolean;
  size?: number;
}

export default function Avatar({ name, online, size = 40 }: AvatarProps) {
  // Each name gets its own hue; the light/dark shades are picked in the classes below.
  const style = {
    width: size,
    height: size,
    "--hue": hue(name),
  } as CSSProperties;
  return (
    <span
      className={cx(
        "relative inline-grid flex-none place-items-center rounded-full font-bold",
        "bg-[hsl(var(--hue)_70%_88%)] text-[hsl(var(--hue)_55%_30%)]",
        "dark:bg-[hsl(var(--hue)_35%_28%)] dark:text-[hsl(var(--hue)_70%_85%)]",
      )}
      style={style}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
      {online !== undefined && (
        <span
          className={cx(
            "absolute -right-px -bottom-px size-3 rounded-full border-2 border-panel",
            online ? "bg-online" : "bg-muted opacity-0",
          )}
        />
      )}
    </span>
  );
}
