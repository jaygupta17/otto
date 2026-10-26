/**
 * Fitting the agent's browser to the viewer.
 *
 * The stream is the machine's whole desktop, so a phone or a narrow panel
 * would show it a fifth of its size. Instead `otto-browser fit` shapes
 * Chrome's window like the space the viewer has, and the view crops the
 * stream to that window: a portrait browser on a phone, at a size you can
 * read. Input still lands where you tap, since the stream's own page is just
 * larger than the box and offset inside it.
 */

export type Rect = { x: number; y: number; w: number; h: number };

/** What `otto-browser fit` prints: the desktop's size and Chrome's window on it (null when Chrome isn't up). */
export interface ScreenGeometry {
  screen: { w: number; h: number };
  window: (Rect & { id: number }) | null;
}

/** The kit that ships `fit`; an older `otto-browser` would take the word as a URL and open it. */
const FIT_KIT = 3;

/** Shell for `otto-browser fit`: `[w, h]` to shape Chrome, "max" to maximize it, nothing to just report. */
export function fitCommand(size?: readonly [number, number] | "max"): string {
  const args = size === "max" ? " max" : size ? ` ${Math.round(size[0])} ${Math.round(size[1])}` : "";
  return `[ "$(cat "$HOME/.otto/browser-kit" 2>/dev/null || echo 0)" -ge ${FIT_KIT} ] && ~/.local/bin/otto-browser fit${args} 2>/dev/null || true`;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The geometry from `fit`'s output, or null when there's none to trust. */
export function parseFit(output: string): ScreenGeometry | null {
  const line = output
    .split("\n")
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith("{"));
  if (!line) return null;
  try {
    const raw = JSON.parse(line) as { screen?: { w?: unknown; h?: unknown }; window?: Record<string, unknown> | null };
    const sw = raw.screen?.w;
    const sh = raw.screen?.h;
    if (!num(sw) || !num(sh) || sw <= 0 || sh <= 0) return null;
    const w = raw.window;
    const win = w && num(w.id) && num(w.x) && num(w.y) && num(w.w) && num(w.h) && w.w > 0 && w.h > 0 ? { id: w.id, x: w.x, y: w.y, w: w.w, h: w.h } : null;
    return { screen: { w: sw, h: sh }, window: win };
  } catch {
    return null;
  }
}

/**
 * Where things go to show only `win` of the desktop, as large as fits in `box`
 * (CSS px). `clip` is the window's box, centred; `frame` is the whole stream,
 * relative to `clip`, so the window lands exactly in it. Null when there's no
 * window, or nothing of it on screen.
 */
export function cropLayout(geo: ScreenGeometry, box: { w: number; h: number }): { clip: Rect; frame: Rect } | null {
  const win = geo.window;
  if (!win || box.w <= 0 || box.h <= 0) return null;
  // Only the part of the window that's on screen is in the stream.
  const x = Math.max(0, win.x);
  const y = Math.max(0, win.y);
  const w = Math.min(geo.screen.w, win.x + win.w) - x;
  const h = Math.min(geo.screen.h, win.y + win.h) - y;
  if (w <= 0 || h <= 0) return null;
  const s = Math.min(box.w / w, box.h / h);
  return {
    clip: { x: (box.w - w * s) / 2, y: (box.h - h * s) / 2, w: w * s, h: h * s },
    frame: { x: -x * s, y: -y * s, w: geo.screen.w * s, h: geo.screen.h * s },
  };
}
