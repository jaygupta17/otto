/**
 * Dithered things drawn on a canvas, one dot per CSS pixel (two on big
 * ones), so they stay crisp and cold at any size and sit on any surface.
 *
 *   DitherOrb   a lit sphere. Spinning, its light circles the rim: the
 *               "an agent is at work" mark (AgentClock renders one).
 *   DitherBreath a ball of 2px dots that breathes as its light drifts: what
 *               sits beside a turn's "Reading Thread.tsx…" while it works.
 *   DitherGauge a still pie of dots filled clockwise to a share (context used).
 *   DitherMeter the same share as a straight bar.
 *   DitherGround a short patch of dots for an empty state's mark to stand on.
 *   DitherField  a page's weather: 2px dots on an 8px grid, gathered at the
 *               edges and drifting, behind a page's top.
 *
 * Every live canvas shares one ticker at a stepped frame rate (it's meant to
 * look like pixels changing, not like video), holds still off screen and in
 * a hidden tab, and draws a single still frame under reduced motion.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { cssColor, dot, fieldTone, gaugeTone, groundTone, meterTone, paint, sphere, type Rgb } from "../../lib/dither";

type Frame = (t: number) => void;

const live = new Set<{ draw: Frame; visible: boolean }>();
const FPS = 18;
let raf = 0;
let last = 0;

function tick(now: number) {
  raf = requestAnimationFrame(tick);
  if (document.hidden || now - last < 1000 / FPS) return;
  last = now;
  for (const c of live) if (c.visible) c.draw(now / 1000);
}

function join(c: { draw: Frame; visible: boolean }) {
  live.add(c);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => {
    live.delete(c);
    if (!live.size) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Runs `field` on a canvas of w×h dots, in the canvas's current text colour
 * (re-read now and then so a theme switch carries over). A still canvas
 * redraws when `stamp` changes.
 */
function useDither(ref: React.RefObject<HTMLCanvasElement | null>, w: number, h: number, animate: boolean, field: (x: number, y: number, t: number) => number, stamp?: unknown) {
  const fieldRef = useRef(field);
  fieldRef.current = field;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || w < 1 || h < 1) return;
    canvas.width = w;
    canvas.height = h;
    const img = ctx.createImageData(w, h);
    let rgb: Rgb = [0, 0, 0];
    let readAt = -1;
    const draw = (t: number) => {
      if (t - readAt > 1) {
        rgb = cssColor(getComputedStyle(canvas).color);
        readAt = t;
      }
      paint(img, w, h, (x, y) => fieldRef.current(x, y, t), rgb);
      ctx.putImageData(img, 0, 0);
    };
    draw(performance.now() / 1000);
    if (!animate || reduced()) return;
    const me = { draw, visible: true };
    const io = new IntersectionObserver(([e]) => (me.visible = e.isIntersecting));
    io.observe(canvas);
    const leave = join(me);
    return () => {
      io.disconnect();
      leave();
    };
  }, [ref, w, h, animate, stamp]);
}

/**
 * A dithered sphere. Still, it's lit from the top left; spinning, the light
 * circles it once every `period` seconds so a lit crescent runs round the rim.
 */
export const DitherOrb = memo(function DitherOrb({
  size = 14,
  spin = false,
  period = 1.6,
  label,
  className = "",
  style,
}: {
  size?: number;
  spin?: boolean;
  period?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cell = size >= 48 ? 2 : 1;
  const cells = Math.max(8, Math.round(size / cell));
  const r = cells / 2;
  useDither(ref, cells, cells, spin, (x, y, t) => {
    const nx = (x + 0.5 - r) / (r - 0.25);
    const ny = (y + 0.5 - r) / (r - 0.25);
    // Enough ambient that the whole disc reads even at 11px; the light does the rest.
    if (!spin) return sphere(nx, ny, -0.55, -0.7, 0.55, 0.14);
    const a = (t / period) * Math.PI * 2;
    return sphere(nx, ny, Math.cos(a), Math.sin(a), 0.48, 0.16);
  });
  return (
    <canvas
      ref={ref}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`dither inline-block shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    />
  );
});

/**
 * A turn at work: a lit ball of 2px dots that swells and settles about every
 * 2.4s while its light drifts round it. Busy enough that a long wait never
 * looks frozen, soft enough to sit beside text.
 */
export const DitherBreath = memo(function DitherBreath({ size = 28, className = "" }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cells = Math.max(8, Math.round(size / 2));
  const r = cells / 2;
  useDither(ref, cells, cells, true, (x, y, t) => {
    // Never reaches the canvas edge, so it stays round at full breath.
    const R = (0.66 + 0.24 * (0.5 + 0.5 * Math.sin(t * 2.6))) * (r - 0.25);
    const a = t * 1.7;
    return sphere((x + 0.5 - r) / R, (y + 0.5 - r) / R, Math.cos(a) * 0.8, Math.sin(a) * 0.8 - 0.4, 0.6, 0.2);
  });
  return <canvas ref={ref} aria-hidden className={`dither inline-block shrink-0 ${className}`} style={{ width: cells * 2, height: cells * 2 }} />;
});

/**
 * A share as a still pie of dots: solid from twelve o'clock clockwise, a
 * sparse track for the rest. Reads as a gauge, never as a spinner.
 */
export const DitherGauge = memo(function DitherGauge({ pct, size = 16, className = "" }: { pct: number; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = size / 2;
  // A sliver always shows once anything is used, so 1% doesn't read as empty.
  const shown = pct > 0 ? Math.max(pct, 0.06) : 0;
  useDither(ref, size, size, false, (x, y) => gaugeTone((x + 0.5 - r) / (r - 0.25), (y + 0.5 - r) / (r - 0.25), shown), Math.round(shown * 200));
  return <canvas ref={ref} aria-hidden className={`dither inline-block shrink-0 ${className}`} style={{ width: size, height: size }} />;
});

/** A share as a straight bar of dots that fills its width: solid up to `pct`, track after. */
export const DitherMeter = memo(function DitherMeter({ pct, height = 6, className = "" }: { pct: number; height?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [len, setLen] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLen(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useDither(ref, len, height, false, (x) => meterTone(x, len, pct), Math.round(pct * 1000));
  return <canvas ref={ref} aria-hidden className={`dither block ${className}`} style={{ width: "100%", height }} />;
});

/** A short patch of dotted ground, thinning out at both ends: what an empty state's bird stands on. */
export const DitherGround = memo(function DitherGround({ width = 96, height = 3, className = "" }: { width?: number; height?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useDither(ref, width, height, false, (x) => groundTone(x, width));
  return <canvas ref={ref} aria-hidden className={`dither block ${className}`} style={{ width, height }} />;
});

/**
 * The page's weather (see `fieldTone`): fills its positioned parent, never
 * takes a pointer, and stays behind whatever comes after it. Each dot is 2px
 * on an 8px grid, so the canvas is drawn at half size, one cell in four lit.
 */
export const DitherField = memo(function DitherField({ side = "both", className = "" }: { side?: "both" | "right"; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    // A hidden tab measures 0; keep the last real size so it's there the moment the tab shows.
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setBox([Math.ceil(e.contentRect.width / 8), Math.ceil(e.contentRect.height / 8)]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [cols, rows] = box;
  useDither(ref, cols * 4, rows * 4, true, (x, y, t) => {
    if (x & 3 || y & 3) return 0;
    const cx = x >> 2, cy = y >> 2;
    const nx = (cx + 0.5) / cols, ny = (cy + 0.5) / rows;
    return dot(fieldTone(nx, ny, t, side), cx, cy) ? 1 : 0;
  });
  return <canvas ref={ref} aria-hidden className={`dither pointer-events-none absolute top-0 left-0 ${className}`} style={{ width: cols * 8, height: rows * 8 }} />;
});
