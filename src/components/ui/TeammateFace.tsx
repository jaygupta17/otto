/**
 * A teammate's face: one pebble silhouette in a flat colour, with eyes and a
 * mouth generated from a seed. Four states, all static (the agent clock is
 * the only ambient motion): idle, working (focused eyes + the amber hand),
 * needs you (blue dot), done (happy eyes).
 */
import { memo } from "react";
import { agentColor } from "../../lib/agentColor";
import { useTeammate } from "../../state/teammates";

export type FaceState = "idle" | "working" | "needs" | "done";

const FEATURE = "#f7f7f5";
const PUPIL = "#18181b";

/** mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Face {
  eye: "pill" | "bean" | "round";
  w: number;
  h: number;
  gap: number;
  y: number;
  tilt: number;
  dx: number;
  gx: number;
  gy: number;
  mouth: "pill" | "smile" | "o" | "smirk";
  mw: number;
}

function faceOf(seed: number): Face {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const span = (lo: number, hi: number) => lo + r() * (hi - lo);
  const eye = pick(["pill", "pill", "bean", "round"] as const);
  return {
    eye,
    w: eye === "round" ? span(7, 8.4) : span(4.4, 5.6),
    h: eye === "round" ? 0 : span(7.2, 9.6),
    gap: span(8.6, 10.8),
    y: span(16.6, 18.6),
    tilt: span(-9, 9),
    dx: span(-1.6, 1.6),
    gx: span(-0.8, 0.8),
    gy: span(-0.5, 0.6),
    mouth: pick(["pill", "pill", "smile", "o", "smirk"] as const),
    mw: span(5, 7.5),
  };
}

export const TeammateFace = memo(function TeammateFace({ seed, color, size = 24, state = "idle", label }: { seed: number; color: string; size?: number; state?: FaceState; label?: string }) {
  const f = faceOf(seed);
  const cx = 20 + f.dx;
  const left = cx - f.gap / 2;
  const right = cx + f.gap / 2;
  const mouthY = f.y + (f.eye === "round" ? 8.6 : 7.4 + f.h / 2.6);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="shrink-0">
      <ellipse cx="20" cy="20.6" rx="18.6" ry="17.4" fill={color} />
      <g transform={`rotate(${f.tilt.toFixed(1)} ${cx} ${f.y + 3})`}>
        {state === "done" ? (
          <>
            <Arc x={left} y={f.y + 1} w={f.w + 1.6} />
            <Arc x={right} y={f.y + 1} w={f.w + 1.6} />
          </>
        ) : (
          <>
            <Eye x={left} f={f} focused={state === "working"} />
            <Eye x={right} f={f} focused={state === "working"} />
          </>
        )}
        <Mouth x={cx} y={mouthY} f={f} happy={state === "done"} />
      </g>
      {state === "working" && <circle cx="6.2" cy="33.4" r="3.6" fill="var(--accent, #f0a020)" stroke="var(--surface-solid, #fff)" strokeWidth="1.4" />}
      {state === "needs" && <circle cx="33.6" cy="6.6" r="4.2" fill="var(--info, #1d5fd6)" stroke="var(--surface-solid, #fff)" strokeWidth="1.6" />}
    </svg>
  );
});

function Eye({ x, f, focused }: { x: number; f: Face; focused: boolean }) {
  if (f.eye === "round") {
    const r = f.w / 2;
    const ry = focused ? r * 0.55 : r;
    return (
      <>
        <ellipse cx={x} cy={f.y} rx={r} ry={ry} fill={FEATURE} />
        <circle cx={x + f.gx * r * 0.4} cy={f.y + (focused ? 0 : f.gy * r * 0.35)} r={Math.min(r * 0.5, ry * 0.8)} fill={PUPIL} />
      </>
    );
  }
  const h = focused ? f.h * 0.48 : f.h;
  const rect = <rect x={x - f.w / 2} y={f.y - h / 2} width={f.w} height={h} rx={f.w / 2} fill={FEATURE} />;
  if (f.eye === "bean") return rect;
  const pr = Math.min(f.w * 0.3, h * 0.3);
  return (
    <>
      {rect}
      <circle cx={x + f.gx * (f.w / 2 - pr) * 0.8} cy={f.y + f.gy * (h / 2 - pr) * 0.9} r={pr} fill={PUPIL} />
    </>
  );
}

function Arc({ x, y, w }: { x: number; y: number; w: number }) {
  const hw = w / 2;
  return <path d={`M${x - hw} ${y + 1.4} Q${x} ${y - 3.4} ${x + hw} ${y + 1.4}`} stroke={FEATURE} strokeWidth="2.2" strokeLinecap="round" fill="none" />;
}

function Mouth({ x, y, f, happy }: { x: number; y: number; f: Face; happy: boolean }) {
  const hw = f.mw / 2;
  if (happy || f.mouth === "smile") return <path d={`M${x - hw} ${y - 0.6} Q${x} ${y + (happy ? 3.4 : 2.4)} ${x + hw} ${y - 0.6}`} stroke={FEATURE} strokeWidth="1.9" strokeLinecap="round" fill="none" />;
  if (f.mouth === "o") return <ellipse cx={x} cy={y} rx="1.6" ry="1.4" fill={FEATURE} />;
  if (f.mouth === "smirk") return <path d={`M${x - hw} ${y} Q${x + hw * 0.2} ${y + 1.8} ${x + hw} ${y - 1.2}`} stroke={FEATURE} strokeWidth="1.9" strokeLinecap="round" fill="none" />;
  return <rect x={x - hw} y={y - 1} width={f.mw} height="2.1" rx="1.05" fill={FEATURE} />;
}

/**
 * How an agent shows up in lists and menus: a teammate's face, or the
 * colour dot for plain agents. `size` is the face size; dots are half.
 */
export function AgentMark({ id, color, size = 16 }: { id: string | undefined; color?: unknown; size?: number }) {
  const t = useTeammate(id);
  if (t) return <TeammateFace seed={t.face} color={t.color} size={size} />;
  const d = Math.max(6, Math.round(size / 2));
  return <span className="inline-block shrink-0 rounded-full" style={{ width: d, height: d, margin: (size - d) / 2, background: agentColor(id, color) }} />;
}
