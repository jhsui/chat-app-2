import { useLayoutEffect, useRef, type RefObject } from "react";

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Quick to start, gentle to settle. */
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** The upward glide each lifted item is on, so only that one lands it. */
const lifts = new WeakMap<HTMLElement, Animation>();

/**
 * Animates a list's items (the elements with a data-glide-id) from where they
 * were before a re-render to where they are now: an item that moved, such as
 * a chat jumping to the top when a message comes in, glides to its new place
 * while the others slide out of its way, and a new item fades in. (The FLIP
 * technique: measure, let React move things, then animate the difference.)
 *
 * An item moving up passes over the others, so while it travels it carries
 * data-gliding="up", which styles.css uses to give it a solid background.
 *
 * Changing `resetKey` (e.g. switching to another tab's list) starts over, so
 * items don't fly in from where they sat in the previous list.
 */
export function useListGlide(
  listRef: RefObject<HTMLElement | null>,
  resetKey: unknown,
) {
  const positions = useRef<Map<string, number> | null>(null);
  const lastKey = useRef(resetKey);

  // No dependency list: positions are compared after every render.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const before = lastKey.current === resetKey ? positions.current : null;
    lastKey.current = resetKey;
    const after = new Map<string, number>();
    const items = list.querySelectorAll<HTMLElement>("[data-glide-id]");
    // offsetTop is where the layout puts an item, ignoring scrolling and any
    // transform still running from a previous glide, so it's a stable ruler.
    for (const item of items) after.set(item.dataset.glideId!, item.offsetTop);
    positions.current = after;
    if (!before || reducedMotion()) return;

    for (const item of items) {
      const was = before.get(item.dataset.glideId!);
      const now = after.get(item.dataset.glideId!)!;
      if (was === now) continue;
      // A glide still running from an earlier change: start over from here.
      item.getAnimations().forEach((animation) => animation.cancel());
      delete item.dataset.gliding;
      if (was === undefined) {
        item.animate(
          [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1 }],
          { duration: 250, easing: EASE },
        );
        continue;
      }
      const up = was > now;
      const glide = item.animate(
        up
          ? [
              { transform: `translateY(${was - now}px)` },
              { transform: `translateY(${(was - now) / 2}px) scale(1.02)` },
              { transform: "none" },
            ]
          : [{ transform: `translateY(${was - now}px)` }, { transform: "none" }],
        { duration: up ? 380 : 320, easing: EASE },
      );
      if (!up) continue;
      item.dataset.gliding = "up";
      lifts.set(item, glide);
      const land = () => {
        if (lifts.get(item) === glide) delete item.dataset.gliding;
      };
      glide.onfinish = land;
      glide.oncancel = land;
    }
  });
}
