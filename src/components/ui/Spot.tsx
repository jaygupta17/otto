import type { PointerEvent } from "react";

/**
 * DitherUI's dither spot for touch rows: ice dots grow out from where you
 * press and fade when you let go (`.spot` in styles.css). Spread `spot` on a
 * `relative isolate` element and put a <Spot /> inside it. A quick tap still
 * holds the dots long enough to be seen.
 */
const HOLD = 160;

function release(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const left = HOLD - (performance.now() - Number(el.dataset.press || 0));
  window.setTimeout(() => delete el.dataset.press, Math.max(0, left));
}

export const spot = {
  onPointerDown(e: PointerEvent<HTMLElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--sx", `${e.clientX - r.left}px`);
    el.style.setProperty("--sy", `${e.clientY - r.top}px`);
    el.dataset.press = String(performance.now());
  },
  onPointerUp: release,
  onPointerCancel: release,
  onPointerLeave: release,
};

export const Spot = () => <span aria-hidden className="spot" />;
