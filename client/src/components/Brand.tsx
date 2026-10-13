import { MessagesSquare } from "lucide-react";

export default function Brand() {
  return (
    <div className="flex items-center gap-2.5" aria-label="Chat">
      <span className="brand-mark">
        <MessagesSquare className="size-5" strokeWidth={2.2} />
      </span>
      <span className="text-[23px] font-extrabold tracking-[-1.2px]">
        chat<span className="text-accent">.</span>
      </span>
    </div>
  );
}
