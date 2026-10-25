/**
 * A teammate's bird: its identity and its status at once, drawn in lines
 * only so it sits on any surface without a tile (see lib/flock/build.ts).
 *
 *   idle      dozes in lists (wakes when you come by); heroes and small
 *             birds stay up: they breathe, blink and glance about
 *   working   thinking: eyes up, a thought cloud (small ones bob)
 *   writing   typing: eyes down, a speech bubble with bouncing dots
 *   needs     puzzled, with a question mark over its head
 *   done      happy eyes and a hop
 *   failed    dizzy: x eyes and stars going round
 *   stopped   sad, a tear
 *   retrying  shivering out in the cold until the model answers
 *
 * Between states it reacts for a moment before settling (`reaction` in state/face.ts):
 * a light bulb when it starts writing, hearts when you answer it, a party
 * when a run finishes, a jolt when one fails, shades when it's back from
 * retrying. Hero birds take a pat (hearts) and too many pokes (cross).
 *
 * `faceOf` (state/face.ts) picks one from what a session is doing, so a
 * teammate reads the same in every list, chip and row. Every bird is drawn
 * with every line at every size: there is one bird, not a simplified one.
 *
 * It's aware of you: nearby birds watch the pointer, hovering what a bird
 * belongs to perks it up, pressing squishes it, and a few quick pokes make
 * it cross. Hero birds greet you, nod along as you type to them and do
 * little things on their own (a wink, a puzzled look). Every bird keeps its
 * own timing, off-screen birds hold still, and reduced motion stops all of
 * it. Light runs along the lines now and then, and keeps running while a
 * bird works (an svg gradient swept by SMIL, paused off screen). Motion is CSS (`.bird`, `.fk` in styles.css); the svg is a cached
 * string, so a sidebar full of birds never re-renders for their life.
 */
import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildBird, type Mood } from "../../lib/flock/build";
import { BIRD } from "../../lib/flock/birds";
import { reaction } from "../../state/face";
import { useTeammate } from "../../state/teammates";
import { HELPERS } from "../../lib/teammates";
import { DitherAvatar } from "./DitherAvatar";
import { DitherOrb } from "./Dither";

export type FaceState = "idle" | "working" | "writing" | "needs" | "done" | "failed" | "stopped" | "retrying";

const STATE_MOOD: Record<FaceState, Mood> = { idle: "cool", working: "think", writing: "type", needs: "huh", done: "happy", failed: "error", stopped: "sad", retrying: "brr" };
/** What a hero bird does now and then while it waits. */
const FIDGETS: Mood[] = ["wink", "huh", "think", "idea"];

/** One bulb per stretch of work, not one per message. */
const IDEA_EVERY = 45_000;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export const Bird = memo(function Bird({
  bird,
  seed = 0,
  size = 24,
  state = "idle",
  mood,
  crop,
  fx,
  perch,
  follow = false,
  attentive = false,
  interactive = false,
  greet = size >= 40,
  doze = true,
  pulse,
  label,
  className = "",
}: {
  bird: string;
  /** Offsets its blinks and glances so a roster never moves in unison. */
  seed?: number;
  size?: number;
  state?: FaceState;
  /** Overrides the state's own mood. */
  mood?: Mood;
  /** The whole bird, tightly framed, unless asked otherwise. */
  crop?: "fit" | "bust" | "full";
  /** Scene marks (thought cloud, sparkles). On, as in Flock, unless turned off. */
  fx?: boolean;
  perch?: boolean;
  /** Watches the pointer anywhere in the window, not only when it comes close. */
  follow?: boolean;
  /** Paying attention to what you're writing: eyes down toward it. */
  attentive?: boolean;
  /** Naps when there's nothing to do, as list birds do. Off where you're already with it (the chat you have open). */
  doze?: boolean;
  /** The bird itself is the thing to touch: hover it, poke it. */
  interactive?: boolean;
  greet?: boolean;
  /** Any change makes it nod, e.g. the length of what you're typing to it. */
  pulse?: number;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [act, setAct] = useState<Mood | null>(null);
  const [awake, setAwake] = useState(false);
  const big = size >= 40;
  const small = size < 28;
  const quiet = state === "idle" && !mood;
  // A bird in a list with nothing to do naps until you come by. Heroes wait on you awake.
  const dozing = doze && quiet && !attentive && !interactive && !follow && !small && size < 64 && !awake;
  const base = mood ?? (attentive && state === "idle" ? "type" : dozing ? "sleep" : STATE_MOOD[state]);
  const shown = act ?? base;
  const t = (seed >>> 0) % 9973;
  const uid = useId().replace(/\W/g, "");
  const html = useMemo(() => {
    const svg = buildBird({ bird, mood: shown, px: size, crop, fx, perch });
    if (reduced()) return svg.replace("url(#§g)", "currentColor");
    const at = shown === "think" ? (t % 1800) / 1000 : (t % 9000) / 1000;
    return svg.replaceAll("§g", `bs${uid}`).replace("§d", `-${at}s`);
  }, [bird, shown, size, crop, fx, perch, uid, t]);
  useBirdLife(ref, { big, small, interactive, always: follow, greet, quiet, setAct, setAwake });

  // A change of state gets its own moment before the bird settles into the new one.
  const was = useRef(state);
  const ideaAt = useRef(-IDEA_EVERY);
  useEffect(() => {
    const r = reaction(was.current, state);
    was.current = state;
    if (!r || mood || reduced()) return;
    if (r.mood === "idea") {
      if (performance.now() - ideaAt.current < IDEA_EVERY) return;
      ideaAt.current = performance.now();
    }
    setAct(r.mood);
    const id = window.setTimeout(() => setAct(null), r.ms);
    return () => {
      clearTimeout(id);
      setAct(null);
    };
  }, [state, mood]);

  // Nods along as you type to it (at most every so often).
  const nodAt = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !pulse || small || reduced() || performance.now() - nodAt.current < 520) return;
    nodAt.current = performance.now();
    replay(el, "bird-nod");
  }, [pulse, small]);

  return (
    <span
      ref={ref}
      role={label ? "img" : undefined}
      aria-label={label ? `${label}${BIRD[bird] ? `, ${BIRD[bird].species.toLowerCase()}` : ""}` : undefined}
      aria-hidden={label ? undefined : true}
      data-state={state}
      className={`bird ${small ? "bird-sm" : ""} ${interactive ? "bird-touch" : ""} ${className}`}
      style={{ width: size, height: size, "--t1": `-${(t % 5400) / 1000}s`, "--t2": `-${(t % 9000) / 1000}s` } as CSSProperties}
    >
      <span className="bird-art" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
});

/** Restarts a one-shot animation class. */
function replay(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 600);
}

// ---------------------------------------------------------------------------
// The pointer: one listener for every bird on screen
// ---------------------------------------------------------------------------

const watchers = new Map<HTMLElement, boolean>();
let px = -1e5;
let py = -1e5;
let frame = 0;
let rest = 0;

function aim(el: HTMLElement, always: boolean) {
  const b = el.getBoundingClientRect();
  if (!b.width) return;
  const dx = px - (b.left + b.width / 2);
  const dy = py - (b.top + b.height / 2);
  const d = Math.hypot(dx, dy) || 1;
  if (px < -1e4 || d > (always ? Infinity : Math.max(240, b.width * 6))) return release(el);
  // Right on top of it, it looks at you, not off to one side.
  const k = Math.min(1, d / Math.max(30, b.width * 1.2));
  el.style.setProperty("--gx", ((dx / d) * k).toFixed(2));
  el.style.setProperty("--gy", ((dy / d) * k).toFixed(2));
  el.dataset.aim = "";
}

function release(el: HTMLElement) {
  if (!("aim" in el.dataset)) return;
  el.style.removeProperty("--gx");
  el.style.removeProperty("--gy");
  delete el.dataset.aim;
}

function onMove(e: PointerEvent) {
  if (e.pointerType === "touch") return;
  px = e.clientX;
  py = e.clientY;
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const [el, always] of watchers) aim(el, always);
    });
  clearTimeout(rest);
  // Once the pointer rests a while, birds go back to their own business.
  rest = window.setTimeout(() => {
    px = py = -1e5;
    for (const el of watchers.keys()) release(el);
  }, 3200);
}

function onOut(e: PointerEvent) {
  if (e.relatedTarget) return;
  px = py = -1e5;
  for (const el of watchers.keys()) release(el);
}

function watch(el: HTMLElement, always: boolean) {
  if (!watchers.size) {
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onOut);
  }
  watchers.set(el, always);
  return () => {
    watchers.delete(el);
    release(el);
    if (!watchers.size) {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

function useBirdLife(
  ref: React.RefObject<HTMLSpanElement | null>,
  { big, small, interactive, always, greet, quiet, setAct, setAwake }: { big: boolean; small: boolean; interactive: boolean; always: boolean; greet: boolean; quiet: boolean; setAct: (m: Mood | null) => void; setAwake: (a: boolean) => void },
) {
  const greeted = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Off screen it holds still.
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      el.classList.toggle("fk-off", !visible);
      const svg = el.querySelector("svg");
      if (visible) svg?.unpauseAnimations();
      else svg?.pauseAnimations();
    });
    io.observe(el);
    if (reduced()) return () => io.disconnect();

    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    };
    let acting = false;
    let ends = 0;
    // A new act cuts the last one short rather than being cut short by its timer.
    const perform = (m: Mood, ms: number) => {
      acting = true;
      setAct(m);
      clearTimeout(ends);
      timers.delete(ends);
      ends = later(() => {
        acting = false;
        setAct(null);
      }, ms);
    };

    if (big && greet && !greeted.current) {
      greeted.current = true;
      later(() => perform("happy", 1300), rand(150, 500));
    }
    // A hero waiting on you does something now and then; birds in lists keep to themselves.
    const fidget = () =>
      later(() => {
        if (visible && !document.hidden && quiet && !acting && !("hover" in el.dataset)) perform(FIDGETS[Math.floor(Math.random() * FIDGETS.length)], rand(1800, 2600));
        fidget();
      }, rand(7000, 15000));
    if (big && interactive) fidget();

    const unwatch = small ? () => {} : watch(el, always);

    // Hovering what the bird belongs to (its row, its card) gets its attention.
    const host: Element = interactive ? el : (el.closest("button, a, label, [role=button], [role=option], [role=menuitem], [role=radio]") ?? el);
    // A napping bird wakes when you come by and nods off again a little after you go.
    let nap = 0;
    const enter = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      el.dataset.hover = "";
      clearTimeout(nap);
      setAwake(true);
    };
    const leave = () => {
      delete el.dataset.hover;
      clearTimeout(nap);
      nap = window.setTimeout(() => setAwake(false), 1400);
    };
    let pokes: number[] = [];
    const down = () => {
      const now = performance.now();
      pokes = pokes.filter((t) => now - t < 1500);
      pokes.push(now);
      replay(el, "bird-squish");
      if (!interactive) return;
      // A pat is welcome; a few quick pokes are not.
      if (pokes.length >= 4) {
        pokes = [];
        perform("angry", 1600);
      } else if (pokes.length === 1 && !acting) perform("love", 1200);
    };
    host.addEventListener("pointerenter", enter as EventListener);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointerdown", down);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
      clearTimeout(nap);
      unwatch();
      host.removeEventListener("pointerenter", enter as EventListener);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointerdown", down);
      delete el.dataset.hover;
    };
  }, [ref, big, small, interactive, always, greet, quiet, setAct, setAwake]);
}

/** How an agent shows up in lists and menus: a teammate's bird, a helper's glyph, or the orb for a plain agent. */
export function AgentMark({ id, size = 18, state, doze, label }: { id: string | undefined; color?: unknown; size?: number; state?: FaceState; doze?: boolean; label?: string }) {
  const t = useTeammate(id);
  if (t) return <Bird bird={t.bird} seed={t.face} size={size} state={state} doze={doze} label={label} />;
  const helper = id && Object.hasOwn(HELPERS, id) ? HELPERS[id] : undefined;
  if (helper) return <HelperMark seed={helper.glyph} size={size} state={state} label={label} />;
  return <PlainMark size={size} state={state} />;
}

/** A helper (explore, general): its dither glyph in a bird-sized box, ice and flickering while it works, ice while it needs you, red when it failed. */
function HelperMark({ seed, size, state, label }: { seed: string; size: number; state?: FaceState; label?: string }) {
  const live = state === "working" || state === "writing" || state === "retrying";
  const tone = live || state === "needs" ? "text-accent" : state === "failed" ? "text-danger" : "text-ink";
  return (
    <span className={`grid shrink-0 place-items-center ${tone}`} style={{ width: size, height: size }}>
      <DitherAvatar seed={seed} size={size} live={live} label={label} />
    </span>
  );
}

/** A plain agent (no teammate): the agent orb, bare, in a bird-sized box so a list's column stays even. Ice while it works. */
export function PlainMark({ size, state }: { size: number; state?: FaceState }) {
  const live = state === "working" || state === "writing" || state === "needs" || state === "retrying";
  return (
    <span className={`grid shrink-0 place-items-center ${live ? "text-accent" : "text-muted"}`} style={{ width: size, height: size }}>
      <DitherOrb size={Math.max(8, Math.round(size * 0.5))} spin={state === "working" || state === "writing"} />
    </span>
  );
}
