/**
 * A status mark in the app's pixel language: a 3×3 block of 2px pixels
 * whose pattern says the state, so it reads without its colour.
 *
 *   on      solid block           connected, on, succeeded, allowed
 *   new     solid block, ice      unread, something new
 *   live    light chasing round   connecting, adding, waiting on a reply
 *   needs   a plus, ice           waiting on you, asks first
 *   error   an x, red             failed, blocked
 *   off     a hollow ring         off, never run, nothing yet
 */
export type PipTone = "on" | "new" | "live" | "needs" | "error" | "off";

const GRID: Record<PipTone, string> = {
  on: "111111111",
  new: "111111111",
  live: "111101111",
  needs: "010111010",
  error: "101010101",
  off: "111101111",
};
const COLOR: Record<PipTone, string> = { on: "text-ink-2", new: "text-accent", live: "text-accent", needs: "text-info", error: "text-danger", off: "text-faint" };
/** The order the ring lights in while live, clockwise from the top left. */
const RING = [0, 1, 2, 5, 8, 7, 6, 3];

export function Pip({ tone, label, className = "" }: { tone: PipTone; label?: string; className?: string }) {
  const cells = GRID[tone];
  return (
    <svg
      width={8}
      height={8}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`pip inline-block shrink-0 ${tone === "live" ? "pip-live" : ""} ${tone === "off" ? "opacity-70" : ""} ${COLOR[tone]} ${className}`}
    >
      {[...cells].map((c, i) =>
        c === "1" ? (
          <rect key={i} x={(i % 3) * 3} y={Math.floor(i / 3) * 3} width={2} height={2} fill="currentColor" style={tone === "live" ? { animationDelay: `${(RING.indexOf(i) - 8) * 0.12}s` } : undefined} />
        ) : null,
      )}
    </svg>
  );
}

/** A workspace connection as a pip: on when ready, an x when it failed, live while it's getting there. */
export const connectionTone = (status: string): PipTone => (status === "ready" ? "on" : status === "error" ? "error" : "live");
