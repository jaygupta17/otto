/**
 * A pixel glyph grown from a seed, after DitherUI's dither avatar: a 7×8 grid
 * mirrored left to right, each cell solid, checker-dithered or empty, the
 * same every time for the same seed. Drawn in the text colour with whole-pixel
 * cells and one-pixel checker dots (two from 48px up), like the rest of
 * Otto's dither. Its checker flips phase on hover and while it works
 * (`.glyph` in styles.css).
 */
import { memo, useId, useMemo } from "react";

const COLS = 7;
const ROWS = 8;
/** Generated columns; the rest mirror them. */
const HALF = 4;
const SOLID = 0.42;
const DITHER = 0.2;

/** 0 empty, 1 solid, 2 dithered. */
type Cell = 0 | 1 | 2;

/** FNV-1a: a string to an unsigned 32-bit seed. */
function hashSeed(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: a 0–1 stream from a seed. */
function stream(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The glyph a seed grows. The first draw picks DitherUI's colour; it's skipped so the shapes match theirs. */
export function glyphOf(seed: string): Cell[][] {
  const random = stream(hashSeed(seed));
  random();
  return Array.from({ length: ROWS }, () => {
    const half = Array.from({ length: HALF }, (): Cell => {
      const roll = random();
      return roll < SOLID ? 1 : roll < SOLID + DITHER ? 2 : 0;
    });
    return [...half, ...half.slice(0, COLS - HALF).reverse()];
  });
}

/** Cells of one kind as a single path of whole-pixel squares. */
function cellsPath(rows: Cell[][], kind: Cell, c: number) {
  let d = "";
  rows.forEach((row, y) => row.forEach((cell, x) => cell === kind && (d += `M${x * c} ${y * c}h${c}v${c}h${-c}z`)));
  return d;
}

/** A glyph in a `size` box (centred by the caller), ice while `live`. */
export const DitherAvatar = memo(function DitherAvatar({ seed, size, live, label, className = "" }: { seed: string; size: number; live?: boolean; label?: string; className?: string }) {
  const rows = useMemo(() => glyphOf(seed), [seed]);
  // Whole pixels per cell, about 85% of the box so it sits like a bird does.
  const c = Math.max(1, Math.min(Math.floor(size / ROWS), Math.round((size * 0.85) / ROWS)));
  const dot = size >= 48 ? 2 : 1;
  // React's ids carry punctuation that `url(#…)` doesn't take.
  const id = `glyph${useId().replace(/[^\w-]/g, "")}`;
  const solid = useMemo(() => cellsPath(rows, 1, c), [rows, c]);
  const dither = useMemo(() => cellsPath(rows, 2, c), [rows, c]);
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox={`0 0 ${COLS * c} ${ROWS * c}`}
      width={COLS * c}
      height={ROWS * c}
      shapeRendering="crispEdges"
      data-live={live || undefined}
      className={`glyph shrink-0 ${className}`}
    >
      <defs>
        {[0, 1].map((phase) => (
          <pattern key={phase} id={`${id}-${phase}`} width={dot * 2} height={dot * 2} patternUnits="userSpaceOnUse">
            <rect x={phase * dot} width={dot} height={dot} fill="currentColor" />
            <rect x={(1 - phase) * dot} y={dot} width={dot} height={dot} fill="currentColor" />
          </pattern>
        ))}
      </defs>
      <path d={solid} fill="currentColor" />
      <path className="glyph-a" d={dither} fill={`url(#${id}-0)`} />
      <path className="glyph-b" d={dither} fill={`url(#${id}-1)`} />
    </svg>
  );
});
