import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Message } from "../../../shared/types";
import { errorMessage } from "../api.ts";
import { cx, ui } from "../ui.ts";

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
      className="dialog m-auto w-[min(360px,calc(100%-1.5rem))] animate-pop p-5"
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
      <h2 id={titleId} className="font-semibold">
        Delete message?
      </h2>
      <p id={descriptionId} className="mt-1 text-sm text-muted">
        It will be removed for both of you. This can’t be undone.
      </p>
      <blockquote className="my-4 line-clamp-3 rounded-lg bg-panel-2 px-3 py-2 text-sm text-muted">
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
          className={cx(ui.btnGhost, "border border-line text-sm")}
          disabled={busy}
          onClick={() => ref.current?.close()}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-danger-fill px-4 text-sm font-semibold text-white transition-opacity hover:enabled:opacity-90 disabled:opacity-60"
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
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </dialog>
  );
}
