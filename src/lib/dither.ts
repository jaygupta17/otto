/**
 * Ordered dithering: Otto's one texture. A smooth field (a lit sphere, a
 * light sweeping through text) becomes hard-edged dots by comparing each
 * cell against a Bayer threshold, so tone is carried by how many dots are
 * on, never by blur or a gradient. Pure functions; the canvas and CSS ends
 * live in ui/Dither.tsx and in `refreshDither` below.
 */

/** Builds the n×n Bayer matrix (n a power of two) as thresholds in (0, 1). */
export function bayer(n: number): Float32Array {
  let m = [[0]];
  for (let s = 1; s < n; s *= 2) {
    const next: number[][] = Array.from({ length: s * 2 }, () => new Array<number>(s * 2));
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + s] = v + 2;
        next[y + s][x] = v + 3;
        next[y + s][x + s] = v + 1;
      }
    m = next;
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = (m[y][x] + 0.5) / (n * n);
  return out;
}

export const BAYER8 = bayer(8);

/** Whether a cell of tone `v` (0 dark … 1 lit) is a dot. */
export const dot = (v: number, x: number, y: number) => v > BAYER8[(y & 7) * 8 + (x & 7)];

export type Rgb = [number, number, number];

/** Parses the colours getComputedStyle hands back (`rgb()`, `rgba()`, `#rgb`, `#rrggbb`). */
export function parseColor(c: string): Rgb {
  const s = c.trim();
  if (s.startsWith("#")) {
    const h = s.length === 4 ? [...s.slice(1)].map((x) => x + x).join("") : s.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const n = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
}

/**
 * The tone of a sphere at a point: lambert light from a direction, plus a
 * little ambient so the shaded side still holds a few dots. `nx, ny` run
 * -1…1 across the disc; light is a unit-ish vector (x right, y down, z out).
 * Outside the disc it's -1, which no threshold lets through.
 */
export function sphere(nx: number, ny: number, lx: number, ly: number, lz: number, ambient = 0.06): number {
  const r2 = nx * nx + ny * ny;
  if (r2 > 1) return -1;
  const nz = Math.sqrt(1 - r2);
  const l = Math.hypot(lx, ly, lz) || 1;
  const d = (nx * lx + ny * ly + nz * lz) / l;
  return ambient + (1 - ambient) * Math.max(0, d);
}

/**
 * Writes a dithered field into `img`: cell (x, y) of a w×h grid is a dot
 * where `tone(x, y)` beats its threshold. Dots take `rgb`, the rest stay
 * clear, so the canvas sits on any surface.
 */
export function paint(img: ImageData, w: number, h: number, tone: (x: number, y: number) => number, rgb: Rgb, alpha = 255) {
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = dot(tone(x, y), x, y);
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = on ? alpha : 0;
    }
}

/** Tone of the empty part of a gauge or meter: a sparse field of dots, so it reads as a track. */
export const TRACK = 0.22;

/**
 * A pie gauge on a disc (`nx, ny` -1…1): solid from twelve o'clock clockwise
 * to `pct`, a sparse track for the rest, -1 outside the disc.
 */
export function gaugeTone(nx: number, ny: number, pct: number): number {
  if (nx * nx + ny * ny > 1) return -1;
  const a = Math.atan2(nx, -ny) / (Math.PI * 2);
  return (a < 0 ? a + 1 : a) < pct ? 1 : TRACK;
}

/** A straight meter `w` cells long: solid up to `pct`, track after. */
export const meterTone = (x: number, w: number, pct: number) => (x + 0.5 < pct * w ? 1 : TRACK);

/** A patch of ground `w` cells wide: densest in the middle, thinning out to nothing at both ends. */
export function groundTone(x: number, w: number): number {
  const d = (2 * (x + 0.5)) / w - 1;
  return 0.9 * (1 - d * d);
}

// ---------------------------------------------------------------------------
// Dithered shimmer: live text with a band of light dots sweeping through it
// ---------------------------------------------------------------------------

/** Width of one shimmer tile in CSS px; the band takes up the middle of it. */
export const SHIMMER_W = 160;
const SHIMMER_H = 8;

/** The band's tone across the tile: dark at the ends, peaking in the middle. */
export function shimmerTone(x: number): number {
  const t = (x + 0.5) / SHIMMER_W;
  const d = Math.abs(t - 0.5) / 0.15;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}

/** A wider, sparser band round the light: the accent dots at its edge. Never more than a third on. */
export function shimmerHalo(x: number): number {
  const t = (x + 0.5) / SHIMMER_W;
  const d = Math.abs(t - 0.5) / 0.27;
  return d >= 1 ? 0 : 0.34 * (0.5 + 0.5 * Math.cos(Math.PI * d));
}

// ---------------------------------------------------------------------------
// The field: a page's weather, dots gathered at the edges and drifting
// ---------------------------------------------------------------------------

const smooth = (a: number, b: number, v: number) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * Tone of the field at (nx, ny) in 0…1 across its box, at time t seconds:
 * thick at the side edges, clear down the middle and gone by the bottom (so
 * what sits on it stays readable), with slow crossing swells running through
 * it so it never sits still. `side` "right" keeps the left clear instead,
 * for a page whose title is set flush left. The top fades in too, so the
 * field never butts up against a bar.
 */
export function fieldTone(nx: number, ny: number, t: number, side: "both" | "right" = "both"): number {
  const edge = side === "right" ? smooth(0.5, 1, nx) : smooth(0.3, 0.95, Math.abs(nx - 0.5) * 2);
  const fade = smooth(0, 0.45, ny) * (1 - smooth(0.4, 1, ny));
  const swell = 0.5 + 0.25 * Math.sin(nx * 9 + ny * 5 - t * 0.55) + 0.25 * Math.cos(ny * 7 - nx * 4 - t * 0.38);
  return edge * fade * (0.25 + 0.9 * swell);
}

/** Height in CSS px of the dithered fade (`.dither-fade-top`). */
export const FADE_H = 32;

/** The fade's tone down its height: clear at the top, solid at the bottom. */
export const fadeTone = (y: number) => (y + 0.5) / FADE_H;

/**
 * Draws Otto's dither tokens and hands them to CSS: `--shimmer-tile` (dots of
 * `--text` over `--muted` with a sparse edge of accent dots, which `.shimmer` clips to live text and slides
 * along) and `--dither-fade` (an alpha mask that dissolves content into
 * dots instead of a soft gradient). Call it whenever the theme changes.
 */
let pending = 0;
export function refreshDither() {
  // Next task, so a light/dark switch made in the same tick has landed.
  if (typeof document === "undefined" || pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    drawFade();
    drawShimmer();
  });
}

/** A canvas of w×h cells, each `scale` device pixels square, filled per cell. */
function tile(w: number, h: number, scale: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(c.width, c.height);
  for (let py = 0; py < c.height; py++)
    for (let px = 0; px < c.width; px++) img.data.set(fill(Math.floor(px / scale), Math.floor(py / scale)), (py * c.width + px) * 4);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function drawFade() {
  const root = document.documentElement;
  // Drawn at the screen's density: a mask is resampled smoothly, so 1:1 keeps the dots hard.
  const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
  if (root.dataset.ditherFade === String(scale)) return;
  const url = tile(8, FADE_H, scale, (x, y) => [0, 0, 0, dot(fadeTone(y), x, y) ? 255 : 0]);
  if (!url) return;
  root.style.setProperty("--dither-fade", `url(${url})`);
  root.dataset.ditherFade = String(scale);
}

function drawShimmer() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const lit = parseColor(cs.getPropertyValue("--text") || "#000");
  const base = parseColor(cs.getPropertyValue("--muted") || "#888");
  const accent = parseColor(cs.getPropertyValue("--accent") || "#7cc4ff");
  const key = `${lit}|${base}|${accent}`;
  if (root.dataset.shimmer === key) return;
  // The halo: the base pulled most of the way to the accent, so it reads as cold light, not a second colour.
  const ice = base.map((v, i) => Math.round(v + (accent[i] - v) * 0.7)) as Rgb;
  const draw = (under: Rgb, halo: Rgb) =>
    tile(SHIMMER_W, SHIMMER_H, 1, (x, y) => {
      const rgb = dot(shimmerTone(x), x, y) ? lit : dot(shimmerHalo(x), x, y) ? halo : under;
      return [rgb[0], rgb[1], rgb[2], 255];
    });
  const url = draw(base, ice);
  if (!url) return;
  root.style.setProperty("--shimmer-tile", `url(${url})`);
  // The same light over the accent, for counts of things working.
  root.style.setProperty("--shimmer-tile-accent", `url(${draw(accent, accent)})`);
  root.dataset.shimmer = key;
}
