import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const WIDTH_KEY = "chat-sidebar-width";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 260;
const MAX_WIDTH = 480;
/** How far one arrow key press moves the edge. */
const KEY_STEP = 16;

const clamp = (px: number) =>
  Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));

function storedWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (value) return clamp(value);
  } catch {
    /* Resizing still works without local storage, just isn't remembered. */
  }
  return DEFAULT_WIDTH;
}

/** Remembers the width, or forgets it (null) to go back to the default. */
function saveWidth(px: number | null) {
  try {
    if (px === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(px));
  } catch {
    /* Optional, like above. */
  }
}

/**
 * The handle on the sidebar's right edge: drag it, or focus it and use the
 * arrow keys (Home and End for the narrowest and widest), to resize the
 * sidebar. The width is remembered; double-click puts it back to the default.
 * Wide screens only: on a phone the sidebar and the chat take turns.
 *
 * Render it directly inside .app-shell, the grid whose first column is the
 * sidebar: it sets that column's width on its parent.
 */
export default function SidebarResizer() {
  const [width, setWidth] = useState(storedWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  // The grid reads the width from a CSS variable (see .app-shell in
  // styles.css), so a drag re-lays out the page without re-rendering the
  // sidebar and the chat: only this handle re-renders. It goes through the
  // handle's own element because a parent's ref isn't attached yet when a
  // child's layout effect first runs, and this has to happen before the
  // first paint, or a remembered width would jump into place.
  useLayoutEffect(() => {
    handleRef.current?.parentElement?.style.setProperty(
      "--sidebar-w",
      `${width}px`,
    );
  }, [width]);

  // While dragging, the resize cursor shows everywhere and text can't be
  // selected by accident (styles.css, :root[data-resizing]).
  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    root.dataset.resizing = "";
    return () => {
      delete root.dataset.resizing;
    };
  }, [dragging]);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Keep getting the pointer's moves even when it outruns the thin handle.
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (drag.current)
      setWidth(clamp(drag.current.startWidth + e.clientX - drag.current.startX));
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    saveWidth(width);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next =
      e.key === "ArrowLeft"
        ? width - KEY_STEP
        : e.key === "ArrowRight"
          ? width + KEY_STEP
          : e.key === "Home"
            ? MIN_WIDTH
            : e.key === "End"
              ? MAX_WIDTH
              : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(clamp(next));
    saveWidth(clamp(next));
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls="sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      className="sidebar-resizer max-md:hidden"
      data-dragging={dragging || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => {
        setWidth(DEFAULT_WIDTH);
        saveWidth(null);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
