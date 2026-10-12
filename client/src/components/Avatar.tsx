import type { CSSProperties } from 'react';

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
  const style = { width: size, height: size, '--hue': hue(name) } as CSSProperties;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
      {online !== undefined && <span className={`presence-dot ${online ? 'on' : ''}`} />}
    </span>
  );
}
