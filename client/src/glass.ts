/**
 * Moves the light that the liquid-glass surfaces catch (see .liquid-glass in
 * styles.css) with the pointer: every surface's rim turns toward it, and the
 * one under the pointer gets a specular highlight right where it is.
 *
 * The values go on the surfaces themselves as non-inherited custom
 * properties, so moving the light never restyles the content inside them.
 */
const SURFACE = ".liquid-glass";

let pending: { x: number; y: number; target: EventTarget | null } | null =
  null;
let frame = 0;

function paint() {
  frame = 0;
  if (!pending) return;
  const { x, y, target } = pending;
  pending = null;
  const surfaces = Array.from(document.querySelectorAll<HTMLElement>(SURFACE));
  // The big panes only catch the light on their rim; their highlight would
  // wander around behind the messages.
  const lit =
    target instanceof Element
      ? target.closest<HTMLElement>(`${SURFACE}:not(.glass-pane)`)
      : null;
  // All reads before any writes, so this is one layout, not one per surface.
  const measured = surfaces.map(
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
  addEventListener("pointermove", track, { passive: true });
  addEventListener("pointerdown", track, { passive: true });
}
