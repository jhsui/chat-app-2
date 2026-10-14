/**
 * Moves the light that the liquid-glass surfaces catch (see .liquid-glass in
 * styles.css) with the pointer: every surface's rim turns toward it, and the
 * one under the pointer gets a specular highlight right where it is.
 *
 * The values go on the surfaces themselves as non-inherited custom
 * properties, so moving the light never restyles the content inside them.
 */
const SURFACE = ".liquid-glass";

/** The glass surfaces that are on screen right now; only these get lit. */
const visible = new Set<HTMLElement>();
const visibility = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (isIntersecting) visible.add(target as HTMLElement);
    else visible.delete(target as HTMLElement);
  }
});

function watch(surface: HTMLElement) {
  visibility.observe(surface); // no-op if it's already observed
}
function unwatch(surface: HTMLElement) {
  visibility.unobserve(surface);
  visible.delete(surface);
}
/** The surfaces in a part of the page, including its root. */
function surfacesIn(node: Node): HTMLElement[] {
  if (!(node instanceof HTMLElement)) return [];
  const inside = Array.from(node.querySelectorAll<HTMLElement>(SURFACE));
  return node.matches(SURFACE) ? [node, ...inside] : inside;
}

// Keep the observed set in step with the page as React adds and removes
// surfaces (a menu opening, a day pill scrolling in with older messages…).
const changes = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "attributes") {
      const el = record.target as HTMLElement;
      if (el.matches(SURFACE)) watch(el);
      else unwatch(el);
      continue;
    }
    record.removedNodes.forEach((node) => surfacesIn(node).forEach(unwatch));
    record.addedNodes.forEach((node) => surfacesIn(node).forEach(watch));
  }
});

let pending: { x: number; y: number; target: EventTarget | null } | null =
  null;
let frame = 0;

function paint() {
  frame = 0;
  if (!pending) return;
  const { x, y, target } = pending;
  pending = null;
  // The big panes only catch the light on their rim; their highlight would
  // wander around behind the messages.
  const lit =
    target instanceof Element
      ? target.closest<HTMLElement>(`${SURFACE}:not(.glass-pane)`)
      : null;
  // All reads before any writes, so this is one layout, not one per surface.
  const measured = Array.from(
    visible,
    (surface) => [surface, surface.getBoundingClientRect()] as const,
  );
  for (const [surface, r] of measured) {
    const dx = x - (r.left + r.width / 2);
    const dy = r.top + r.height / 2 - y;
    const angle = (Math.atan2(dx, dy) * 180) / Math.PI;
    surface.style.setProperty("--light-angle", `${angle.toFixed(1)}deg`);
    if (surface === lit) {
      surface.style.setProperty("--mx", `${(x - r.left).toFixed(0)}px`);
      surface.style.setProperty("--my", `${(y - r.top).toFixed(0)}px`);
    }
  }
}

function track(event: PointerEvent) {
  pending = { x: event.clientX, y: event.clientY, target: event.target };
  frame ||= requestAnimationFrame(paint);
}

export function followPointerLight() {
  surfacesIn(document.body).forEach(watch);
  changes.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  addEventListener("pointermove", track, { passive: true });
  addEventListener("pointerdown", track, { passive: true });
}

/** How long the background keeps drifting after the last input. */
const AMBIENT_IDLE_MS = 6000;

/**
 * The drifting colour field behind the glass makes the browser redraw every
 * blurred surface on every frame. So it only drifts while someone is using
 * the page, and holds still (where it is, without a jump) once they stop.
 * styles.css pauses it whenever <html> lacks data-ambient="live".
 */
export function pauseAmbientWhenIdle() {
  const root = document.documentElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWake = 0;
  function wake() {
    // Input events can come hundreds of times a second; resetting the timer
    // a few times a second is plenty.
    const now = performance.now();
    if (now - lastWake < 250) return;
    lastWake = now;
    root.dataset.ambient = "live";
    clearTimeout(timer);
    timer = setTimeout(() => delete root.dataset.ambient, AMBIENT_IDLE_MS);
  }
  for (const type of ["pointermove", "pointerdown", "keydown", "wheel"])
    addEventListener(type, wake, { passive: true });
  wake();
}
