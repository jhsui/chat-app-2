import { useEffect, useRef } from "react";
import type { MessageImage } from "../../../shared/types";

interface ImageViewerProps {
  image: MessageImage;
  onClose: () => void;
}

/** A chat picture shown large over the app. Click anywhere or press Esc to close. */
export default function ImageViewer({ image, onClose }: ImageViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // <dialog>.showModal() gives us focus trapping, Esc to close and a backdrop for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={() => dialogRef.current?.close()}
      aria-label="Image"
      className="m-auto max-h-none max-w-none overflow-visible bg-transparent p-0 backdrop:bg-black/80"
    >
      <img
        src={image.url}
        alt=""
        width={image.width}
        height={image.height}
        className="h-auto max-h-[90dvh] w-auto max-w-[92vw] rounded-lg object-contain"
      />
      <button
        className="fixed top-3 right-4 grid size-10 place-items-center rounded-full bg-black/50 text-2xl leading-none text-white hover:bg-black/70"
        aria-label="Close"
      >
        ×
      </button>
    </dialog>
  );
}
