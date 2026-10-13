import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface FloatingMenuProps {
  anchor: HTMLElement;
  label: string;
  children: ReactNode;
  width?: number;
  onClose: () => void;
}

/** A viewport-contained menu, outside scrollable panes, with keyboard navigation. */
export default function FloatingMenu({
  anchor,
  label,
  children,
  width = 344,
  onClose,
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    function positionMenu() {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = anchor.getBoundingClientRect();
      if (!anchor.isConnected || (rect.width === 0 && rect.height === 0)) {
        closeRef.current();
        return;
      }
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      menu.style.maxWidth = `${Math.max(0, viewportWidth - 24)}px`;
      menu.style.maxHeight = `${Math.max(0, viewportHeight - 24)}px`;
      const menuWidth = menu.offsetWidth;
      const menuHeight = menu.offsetHeight;
      const below = rect.bottom + 8;
      const top =
        below + menuHeight <= topEdge + viewportHeight - 12
          ? below
          : rect.top - menuHeight - 8;
      setPosition({
        left: Math.max(
          leftEdge + 12,
          Math.min(
            rect.right - menuWidth,
            leftEdge + viewportWidth - menuWidth - 12,
          ),
        ),
        top: Math.max(
          topEdge + 12,
          Math.min(top, topEdge + viewportHeight - menuHeight - 12),
        ),
      });
    }
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("scroll", positionMenu);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("scroll", positionMenu);
    };
  }, [anchor]);

  useEffect(() => {
    const menu = menuRef.current;
    const frame = requestAnimationFrame(() => {
      (
        menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        menu?.querySelector<HTMLElement>("button:not(:disabled)")
      )?.focus({ preventScroll: true });
    });
    function outside(event: Event) {
      if (
        event.target instanceof Node &&
        !menu?.contains(event.target) &&
        !anchor.contains(event.target)
      )
        closeRef.current();
    }
    function scroll(event: Event) {
      if (event.target instanceof Node && !menu?.contains(event.target))
        closeRef.current();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="floating-menu"
      style={{
        width,
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          anchor.focus({ preventScroll: true });
          onClose();
          return;
        }
        if (
          ![
            "ArrowDown",
            "ArrowUp",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
          ].includes(event.key)
        )
          return;
        event.preventDefault();
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const current = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (current +
                  (event.key === "ArrowUp" || event.key === "ArrowLeft"
                    ? -1
                    : 1) +
                  items.length) %
                items.length;
        items[next]?.focus({ preventScroll: true });
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
