import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import type { Message } from "../../../shared/types";
import { errorMessage } from "../api.ts";
import { ui } from "../ui.ts";

interface DeleteMessageDialogProps {
  message: Message;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export default function DeleteMessageDialog({
  message,
  onDelete,
  onClose,
}: DeleteMessageDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      className="profile-dialog m-auto w-[min(420px,calc(100%-1.5rem))] animate-pop rounded-3xl border border-line bg-panel p-6 text-fg shadow-pop"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) ref.current?.close();
      }}
    >
      <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-danger/10 text-danger">
        <Trash2 className="size-6" />
      </div>
      <h2 id={titleId} className="text-xl font-bold tracking-tight">
        Delete this message?
      </h2>
      <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted">
        This removes it for both of you. It can’t be undone.
      </p>
      <blockquote className="my-5 line-clamp-3 rounded-xl border-l-2 border-line bg-panel-2 px-4 py-3 text-sm text-muted">
        {message.image ? "Photo" : message.body}
      </blockquote>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          className={`${ui.btnGhost} flex-1 text-sm whitespace-nowrap`}
          disabled={busy}
          onClick={() => ref.current?.close()}
        >
          Keep message
        </button>
        <button
          type="button"
          disabled={busy}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#bf2945] px-3 text-sm whitespace-nowrap font-semibold text-white transition hover:bg-[#a62039] disabled:opacity-60"
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await onDelete();
              onClose();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          {busy ? "Deleting…" : "Delete message"}
        </button>
      </div>
    </dialog>
  );
}
