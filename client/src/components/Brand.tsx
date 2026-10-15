import { MessageCircle } from "lucide-react";

/** The app's icon: a white speech bubble on the accent colour, like the favicon. */
export default function Brand({ size = 48 }: { size?: number }) {
  const glyph = Math.round(size * 0.55);
  return (
    <span
      className="grid flex-none place-items-center rounded-[22%] bg-fill text-white"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <MessageCircle
        style={{ width: glyph, height: glyph }}
        fill="currentColor"
        strokeWidth={1.5}
      />
    </span>
  );
}
