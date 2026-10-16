/**
 * A teammate's face: a soft, lit pebble with expressive eyes, generated from
 * a seed, plus an optional accessory that hints at the job. The face is the
 * teammate's identity and its status at once, so it moves:
 *
 *   idle     breathes and sways, blinks, looks around, tilts its head, hops
 *   working  takes the task with a nod, bobs along, eyes narrowed and
 *            reading across; an amber hand runs round the rim (the agent
 *            clock, worn by the agent)
 *   needs    wide eyes on you, hopping for attention, a blue beacon
 *   done     jumps for joy, happy eyes, a blush, sparkles burst out
 *
 * And it's aware of you (faceLife.ts): it watches the pointer and leans
 * toward it, perks up and grins when you hover what it belongs to, squishes
 * when pressed, nods along as you type to it, and gets dizzy if you keep
 * poking it. Every instance gets its own timing, so a sidebar of faces never
 * moves in unison. Motion is CSS on transforms (see `.tf` in styles.css) and
 * stops under reduced motion.
 */
import { memo, useId, useRef } from "react";
import { agentColor } from "../../lib/agentColor";
import type { Accessory } from "../../lib/teammates";
import { useTeammate } from "../../state/teammates";
import { useFaceLife } from "./faceLife";

export type FaceState = "idle" | "working" | "needs" | "done";

const FEATURE = "#fbfbfa";
const PUPIL = "#141416";

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

type Shape = "pebble" | "gum" | "egg" | "bun";

interface Face {
  shape: Shape;
  eye: "pill" | "round" | "bean";
  w: number;
  h: number;
  gap: number;
  y: number;
  dx: number;
  tilt: number;
  mouth: "none" | "smile" | "pill";
  mw: number;
  blush: boolean;
  /** Animation offsets (ms) so faces don't move in sync. */
  t1: number;
  t2: number;
}

function faceOf(seed: number): Face {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const span = (lo: number, hi: number) => lo + r() * (hi - lo);
  const eye = pick(["pill", "pill", "round", "bean"] as const);
  return {
    shape: pick(["pebble", "pebble", "gum", "egg", "bun"] as const),
    eye,
    w: eye === "round" ? span(6.6, 7.6) : eye === "bean" ? span(4.4, 5.2) : span(5.6, 6.6),
    h: eye === "round" ? 0 : eye === "bean" ? span(7.4, 8.8) : span(8.6, 10.2),
    gap: span(9.6, 11.6),
    y: span(17.4, 19.2),
    dx: span(-1.2, 1.2),
    tilt: span(-6, 6),
    mouth: pick(["none", "none", "smile", "smile", "smile", "pill"] as const),
    mw: span(4.6, 6.4),
    blush: r() < 0.35,
    t1: Math.floor(r() * 6000),
    t2: Math.floor(r() * 11000),
  };
}

/** Body outlines on a 40×40 board; each leaves the rim free for the working hand. */
const BODY: Record<Shape, string> = {
  pebble: "M20 4.2C30.2 4.2 37.4 11.4 37.4 20.9S30.2 37.2 20 37.2 2.6 30.4 2.6 20.9 9.8 4.2 20 4.2Z",
  gum: "M15.2 4.4h9.6c7.2 0 12.4 5.2 12.4 12.4v7.4c0 7.2-5.2 12.6-12.4 12.6h-9.6C8 36.8 2.8 31.4 2.8 24.2v-7.4C2.8 9.6 8 4.4 15.2 4.4Z",
  egg: "M20 3.4c8.8 0 15.6 9.2 15.6 18.6 0 9-6.8 15.2-15.6 15.2S4.4 31 4.4 22C4.4 12.6 11.2 3.4 20 3.4Z",
  bun: "M20 5.4c9.6 0 16.8 7.6 16.8 18.4 0 8.4-5.8 13-16.8 13S3.2 32.2 3.2 23.8C3.2 13 10.4 5.4 20 5.4Z",
};

function mix(hex: string, to: number, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * amt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const TeammateFace = memo(function TeammateFace({
  seed,
  color,
  size = 24,
  state = "idle",
  accessory = "none",
  follow = false,
  attentive = false,
  interactive = false,
  greet = size >= 40,
  pulse,
  label,
}: {
  seed: number;
  color: string;
  size?: number;
  state?: FaceState;
  accessory?: Accessory;
  /** Watches the pointer anywhere in the window, not only when it comes close. */
  follow?: boolean;
  /** Paying attention to what you're writing: eyes down toward it. */
  attentive?: boolean;
  /** The face itself is the thing to touch: hover it, poke it (a few quick pokes make it dizzy). */
  interactive?: boolean;
  /** Says hello when it first appears. */
  greet?: boolean;
  /** Any change makes it nod, e.g. the length of what you're typing to it. */
  pulse?: number;
  label?: string;
}) {
  const f = faceOf(seed);
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const small = size < 20;
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : "#6b6b78";
  const cx = 20 + f.dx;
  const left = cx - f.gap / 2;
  const right = cx + f.gap / 2;
  const eyeH = f.eye === "round" ? f.w : f.h;
  const mouthY = f.y + eyeH / 2 + 4.2;
  const happy = state === "done";
  const tilt = `rotate(${f.tilt.toFixed(1)} ${cx} ${f.y + 4})`;
  useFaceLife(ref, { small, big: size >= 40, interactive, always: follow, greet, pulse });

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={state}
      className={`tf shrink-0 overflow-visible ${small ? "tf-sm" : ""} ${attentive ? "tf-attentive" : ""} ${interactive ? "tf-touch" : ""}`}
      style={{ "--t1": `-${f.t1}ms`, "--t2": `-${f.t2}ms` } as React.CSSProperties}
    >
      <defs>
        <radialGradient id={`${uid}b`} cx="0.34" cy="0.26" r="0.86">
          <stop offset="0" stopColor={mix(hex, 255, 0.3)} />
          <stop offset="0.55" stopColor={hex} />
          <stop offset="1" stopColor={mix(hex, 0, 0.28)} />
        </radialGradient>
        <radialGradient id={`${uid}s`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* act: one-off moves (hop, wiggle, squish, dizzy); lean: toward the pointer, up when hovered; body: the state's own rhythm. */}
      <g className="tf-act">
        <g className="tf-lean">
          {/* Keyed by state so entering one plays its one-shot (the nod, the pop). */}
          <g key={state} className="tf-body">
            {accessory !== "none" && !small && <Back kind={accessory} hex={hex} />}
            <path d={BODY[f.shape]} fill={`url(#${uid}b)`} />
            {!small && <ellipse cx="13.4" cy="11.4" rx="6.2" ry="3.6" transform="rotate(-28 13.4 11.4)" fill={`url(#${uid}s)`} />}
            <g transform={tilt}>
              {(happy || f.blush) && !small && (
                <g className="tf-blush" opacity={happy ? 0.55 : 0.32}>
                  <ellipse cx={left - 2.4} cy={mouthY - 0.6} rx="2.6" ry="1.5" fill="#ff8fb1" />
                  <ellipse cx={right + 2.4} cy={mouthY - 0.6} rx="2.6" ry="1.5" fill="#ff8fb1" />
                </g>
              )}
              <g className="tf-follow">
                <g className="tf-look">
                  <g className="tf-eyes">
                    <g className="tf-lid">
                      {happy ? (
                        <>
                          <Arc x={left} y={f.y} w={f.w + 1.8} />
                          <Arc x={right} y={f.y} w={f.w + 1.8} />
                        </>
                      ) : (
                        <>
                          <Eye x={left} f={f} />
                          <Eye x={right} f={f} />
                        </>
                      )}
                    </g>
                  </g>
                </g>
              </g>
              {!small && <Swirl x={left} y={f.y} />}
              {!small && <Swirl x={right} y={f.y} />}
              <Mouth x={cx} y={mouthY} f={f} state={state} small={small} />
            </g>
            {accessory === "glasses" && !small && (
              <g transform={tilt}>
                <Front kind={accessory} hex={hex} cx={cx} left={left} right={right} y={f.y} eyeW={f.w} eyeH={eyeH} />
              </g>
            )}
            {accessory !== "none" && accessory !== "glasses" && !small && <Front kind={accessory} hex={hex} cx={cx} left={left} right={right} y={f.y} eyeW={f.w} eyeH={eyeH} />}
          </g>
        </g>
      </g>
      {state === "working" && (
        <g className="tf-hand" fill="none" stroke="var(--accent, #f0a020)" strokeLinecap="round" strokeWidth={small ? 3.2 : 2.6}>
          {/* A comet: the bright head leads, a faint tail trails it. */}
          <circle cx="20" cy="20.6" r="18.9" strokeDasharray="30 89" opacity="0.3" />
          <circle cx="20" cy="20.6" r="18.9" strokeDasharray="11 108" strokeDashoffset="-19" />
        </g>
      )}
      {state === "needs" && (
        <g>
          <circle className="tf-ping" cx="33.4" cy="7" r="4.4" fill="var(--info, #1d5fd6)" />
          <circle className="tf-beacon" cx="33.4" cy="7" r="4.4" fill="var(--info, #1d5fd6)" stroke="var(--surface-solid, #fff)" strokeWidth="1.6" />
        </g>
      )}
      {happy && !small && (
        <g key="spark" className="tf-spark" fill="#fff">
          <path d="M35 9.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" />
          <path d="M5.4 7.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
          <path d="M36.2 27.4l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
        </g>
      )}
    </svg>
  );
});

/** Solid eyes, no pupils: they read at 14px and stay calm at 120. The whole eye moves when it looks. */
function Eye({ x, f }: { x: number; f: Face }) {
  const h = f.eye === "round" ? f.w : f.h;
  return (
    <g className="tf-pupil">
      <rect x={x - f.w / 2} y={f.y - h / 2} width={f.w} height={h} rx={f.w / 2} fill={FEATURE} />
    </g>
  );
}

function Arc({ x, y, w }: { x: number; y: number; w: number }) {
  const hw = w / 2;
  return <path d={`M${x - hw} ${y + 1.6} Q${x} ${y - 3.6} ${x + hw} ${y + 1.6}`} stroke={FEATURE} strokeWidth="2.4" strokeLinecap="round" fill="none" />;
}

function Mouth({ x, y, f, state, small }: { x: number; y: number; f: Face; state: FaceState; small: boolean }) {
  const hw = f.mw / 2;
  if (state === "done") return <path d={`M${x - hw} ${y - 0.8} Q${x} ${y + 3.6} ${x + hw} ${y - 0.8}`} stroke={FEATURE} strokeWidth="2" strokeLinecap="round" fill="none" />;
  let rest = null;
  if (state === "needs") rest = <ellipse className="tf-o" cx={x} cy={y + 0.2} rx="1.5" ry="1.7" fill={FEATURE} />;
  else if (state === "working") rest = f.mouth === "none" ? null : <rect x={x - hw * 0.5} y={y - 0.9} width={hw} height="1.8" rx="0.9" fill={FEATURE} />;
  else if (f.mouth === "smile") rest = <path d={`M${x - hw} ${y - 0.6} Q${x} ${y + 2.4} ${x + hw} ${y - 0.6}`} stroke={FEATURE} strokeWidth="1.9" strokeLinecap="round" fill="none" />;
  else if (f.mouth === "pill") rest = <rect x={x - hw / 2} y={y - 0.95} width={hw} height="1.9" rx="0.95" fill={FEATURE} />;
  if (small) return rest;
  // Hovered it grins; dizzy it goes wobbly. CSS picks which one shows.
  return (
    <>
      <g className="tf-mouth">{rest}</g>
      <path className="tf-grin" d={`M${x - hw - 0.4} ${y - 1} Q${x} ${y - 0.2} ${x + hw + 0.4} ${y - 1} Q${x + hw} ${y + 4.4} ${x} ${y + 4.4} Q${x - hw} ${y + 4.4} ${x - hw - 0.4} ${y - 1}Z`} fill={FEATURE} />
      <path className="tf-woozy" d={`M${x - hw} ${y + 0.6} q${hw / 4} -1.6 ${hw / 2} 0 t${hw / 2} 0 t${hw / 2} 0 t${hw / 2} 0`} stroke={FEATURE} strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </>
  );
}

/** Spiral eyes for when it's been poked too much (hidden otherwise). */
function Swirl({ x, y }: { x: number; y: number }) {
  return (
    <g className="tf-swirl">
      <path d={`M${x} ${y} m0 -0.6 a0.6 0.6 0 1 1 -0.6 0.6 a1.4 1.4 0 0 1 1.4 -1.4 a2.2 2.2 0 0 1 2.2 2.2 a3 3 0 0 1 -3 3 a3.6 3.6 0 0 1 -3.6 -3.6`} stroke={FEATURE} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** Accessory parts that sit behind the body. */
function Back({ kind, hex }: { kind: Accessory; hex: string }) {
  if (kind === "antenna")
    return (
      <g>
        <path d="M21.6 6 C22.2 4.4 23.6 3.2 25.4 2.6" stroke={mix(hex, 0, 0.35)} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <circle className="tf-tip" cx="26.4" cy="2.4" r="2" fill="var(--accent, #f0a020)" />
      </g>
    );
  if (kind === "sprout")
    return (
      <g>
      <g transform="translate(0 1.6)">
        <path d="M20 6 C20 3.6 20.4 2.2 21 1.2" stroke="#3f8f4f" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M21 1.6 C23.6 -1 27.4 -0.4 28 0.6 C26.4 3.2 23 3.6 21 1.6Z" fill="#59b36a" />
        <path d="M20.4 2.6 C18.4 0.4 15.6 0.6 14.8 1.6 C16.2 3.8 18.8 4.2 20.4 2.6Z" fill="#4aa35c" />
      </g>
      </g>
    );
  return null;
}

/** Accessory parts drawn over the face. */
function Front({ kind, hex, cx, left, right, y, eyeW, eyeH }: { kind: Accessory; hex: string; cx: number; left: number; right: number; y: number; eyeW: number; eyeH: number }) {
  const dark = mix(hex, 0, 0.55);
  if (kind === "glasses") {
    // Lenses fit the eyes but never touch: a bridge always shows between them.
    const rx = Math.min((right - left) / 2 - 0.9, eyeW / 2 + 2.2);
    const ry = Math.max(rx * 0.9, eyeH / 2 + 1.6);
    return (
      <g fill="none" stroke={PUPIL} strokeWidth="1.5" opacity="0.9">
        <ellipse cx={left} cy={y} rx={rx} ry={ry} />
        <ellipse cx={right} cy={y} rx={rx} ry={ry} />
        <path d={`M${left + rx} ${y - 0.6} Q${cx} ${y - 2} ${right - rx} ${y - 0.6}`} />
      </g>
    );
  }
  if (kind === "headset")
    return (
      <g>
        <path d="M4.2 19 C4.2 9 11 3.4 20 3.4 S35.8 9 35.8 19" stroke={dark} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <rect x="1.4" y="16.4" width="5.2" height="9" rx="2.6" fill={dark} />
        <rect x="33.4" y="16.4" width="5.2" height="9" rx="2.6" fill={dark} />
        <path d="M4.6 25 C5.4 30.4 9.6 32.6 14.6 32.4" stroke={dark} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <circle cx="15.4" cy="32.4" r="1.7" fill="var(--accent, #f0a020)" />
      </g>
    );
  if (kind === "bowtie") {
    // Under the chin; light on dark bodies, dark on light ones.
    const tie = mix(hex, 255, 0.82);
    return (
      <g>
        <path d="M20 33.4 L15.6 31.2 Q14.8 33.4 15.6 35.6 Z M20 33.4 L24.4 31.2 Q25.2 33.4 24.4 35.6 Z" fill={tie} stroke={tie} strokeWidth="0.8" strokeLinejoin="round" />
        <rect x="18.7" y="32.1" width="2.6" height="2.6" rx="0.9" fill={mix(hex, 255, 0.6)} />
      </g>
    );
  }
  if (kind === "cap")
    return (
      <g>
        <path d="M7 13.2 C8.4 6.6 13.6 3 20 3 S31.6 6.6 33 13.2 Z" fill={dark} />
        <path d="M24 12.2 C29 11.6 35.6 12 39 14.4 C35.2 15.2 29.4 15 24 13.8 Z" fill={dark} />
        <circle cx="20" cy="3.6" r="1.3" fill={mix(hex, 255, 0.4)} />
      </g>
    );
  return null;
}

/**
 * How an agent shows up in lists and menus: a teammate's face, or the
 * colour dot for plain agents. `size` is the face size; dots are half.
 */
export function AgentMark({ id, color, size = 16, state }: { id: string | undefined; color?: unknown; size?: number; state?: FaceState }) {
  const t = useTeammate(id);
  if (t) return <TeammateFace seed={t.face} color={t.color} accessory={t.accessory} size={size} state={state} />;
  const d = Math.max(6, Math.round(size / 2));
  return <span className="inline-block shrink-0 rounded-full" style={{ width: d, height: d, margin: (size - d) / 2, background: agentColor(id, color) }} />;
}
