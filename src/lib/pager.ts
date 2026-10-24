/**
 * Gestures for full-screen pagers (the image viewer, a subagent's siblings):
 * which way a drag is going, and where it lands when it's let go.
 */

export type Axis = "x" | "y" | "none";

/** Below this a touch is still a tap. */
export const SLOP = 8;
/** A drag from this close to the left edge is the system "back", not a page turn. */
export const EDGE = 24;

/** Which way a drag is going, once it has gone far enough to say. Up is nothing: only down dismisses. */
export function axisOf(dx: number, dy: number): Axis | null {
  if (Math.hypot(dx, dy) < SLOP) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return "x";
  return dy > 0 ? "y" : "none";
}

/** Past the first or last page a drag still moves, but grudgingly. */
export function resist(dx: number, at: number, count: number): number {
  return (at === 0 && dx > 0) || (at === count - 1 && dx < 0) ? dx * 0.35 : dx;
}

export type Landing = { close: true } | { close: false; to: number };

/**
 * Where a let-go drag lands: a page over (far enough, or flicked), back where
 * it was, or closed (pulled down, or swiped in from the left edge).
 */
export function settle(g: { axis: Axis | null; edge: boolean; dx: number; dy: number; vx: number; vy: number; width: number; at: number; count: number }): Landing {
  const stay = { close: false as const, to: g.at };
  if (g.axis === "y") return g.dy > 110 || (g.vy > 600 && g.dy > 24) ? { close: true } : stay;
  if (g.axis !== "x") return stay;
  if (g.edge && g.dx > 0) return g.dx > 80 || g.vx > 500 ? { close: true } : stay;
  const far = Math.abs(g.dx) > g.width * 0.2 || Math.abs(g.vx) > 400;
  if (!far) return stay;
  const to = g.dx < 0 ? g.at + 1 : g.at - 1;
  return to < 0 || to >= g.count ? stay : { close: false, to };
}

/** "2 of 3", or nothing for one. */
export const ofHint = (at: number, count: number) => (count > 1 ? `${at + 1} of ${count}` : "");
