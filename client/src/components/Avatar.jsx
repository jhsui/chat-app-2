function hue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export default function Avatar({ name, online, size = 40 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, '--hue': hue(name) }} aria-hidden="true">
      {name[0].toUpperCase()}
      {online !== undefined && <span className={`presence-dot ${online ? 'on' : ''}`} />}
    </span>
  );
}
