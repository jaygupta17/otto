/**
 * What keeps a teammate's face alive between state changes: it blinks, looks
 * around, tilts its head, hops; it notices the pointer and leans toward it;
 * it perks up when you hover what it belongs to, squishes when pressed, and
 * gets dizzy if you keep poking it.
 *
 * Everything is written straight to the DOM (data attributes and CSS
 * variables, animated by `.tf` rules in styles.css), so a sidebar full of
 * faces never re-renders. Faces off screen or in a hidden tab sit still, and
 * reduced motion turns all of it off.
 */
import { useEffect, type RefObject } from "react";
import type { FaceState } from "./TeammateFace";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** How long each act holds its attribute; the CSS animation fits inside. */
const ACTS = {
  "look-l": 1400,
  "look-r": 1400,
  "look-up": 1100,
  "look-down": 1100,
  "tilt-l": 1600,
  "tilt-r": 1600,
  hop: 700,
  wiggle: 800,
  nod: 420,
  perk: 520,
  squish: 480,
  dizzy: 1900,
  hello: 1200,
} as const;
type Act = keyof typeof ACTS;

const CHOICES: Record<FaceState, [Act | null, number][]> = {
  idle: [["look-l", 20], ["look-r", 20], ["look-up", 8], ["look-down", 6], ["tilt-l", 10], ["tilt-r", 10], ["hop", 10], ["wiggle", 8], [null, 8]],
  working: [["nod", 30], ["tilt-l", 12], ["tilt-r", 12], ["look-up", 10], [null, 36]],
  needs: [["wiggle", 45], ["hop", 25], ["look-up", 10], [null, 20]],
  done: [["hop", 30], ["wiggle", 30], ["tilt-l", 12], ["tilt-r", 12], [null, 16]],
};
/** While it's watching the pointer, its eyes are busy: only body moves. */
const NO_LOOKS = new Set<Act | null>(["look-l", "look-r", "look-up", "look-down"]);

function pick(state: FaceState, aiming: boolean): Act | null {
  const list = CHOICES[state].filter(([a]) => !aiming || !NO_LOOKS.has(a));
  let r = Math.random() * list.reduce((n, [, w]) => n + w, 0);
  for (const [a, w] of list) if ((r -= w) < 0) return a;
  return null;
}

const clears = new WeakMap<Element, number>();

/** Plays an act on a face; replaying the same one restarts it. */
export function play(el: SVGSVGElement, act: Act) {
  if (el.dataset.act === act) {
    delete el.dataset.act;
    void el.getBoundingClientRect(); // restart the animation
  }
  el.dataset.act = act;
  clearTimeout(clears.get(el));
  clears.set(
    el,
    window.setTimeout(() => {
      if (el.dataset.act === act) delete el.dataset.act;
    }, ACTS[act]),
  );
}

// ---------------------------------------------------------------------------
// The pointer: one listener for every face on screen
// ---------------------------------------------------------------------------

const watchers = new Map<SVGSVGElement, { always: boolean }>();
let px = -1e5;
let py = -1e5;
let frame = 0;
let rest = 0;

function aim(el: SVGSVGElement, always: boolean) {
  const b = el.getBoundingClientRect();
  if (!b.width) return;
  const dx = px - (b.left + b.width / 2);
  const dy = py - (b.top + b.height / 2);
  const d = Math.hypot(dx, dy) || 1;
  const reach = always ? Infinity : Math.max(240, b.width * 6);
  if (px < -1e4 || d > reach) return release(el);
  // Right on top of it, it looks at you, not off to one side.
  const k = Math.min(1, d / Math.max(30, b.width * 1.2));
  el.style.setProperty("--fx", `${((dx / d) * 2.6 * k).toFixed(2)}px`);
  el.style.setProperty("--fy", `${((dy / d) * 2 * k).toFixed(2)}px`);
  el.style.setProperty("--lean", `${((dx / d) * 6 * k).toFixed(1)}deg`);
  el.dataset.aim = "";
}

function release(el: SVGSVGElement) {
  if (!("aim" in el.dataset)) return;
  el.style.removeProperty("--fx");
  el.style.removeProperty("--fy");
  el.style.removeProperty("--lean");
  delete el.dataset.aim;
}

function update() {
  frame = 0;
  for (const [el, o] of watchers) aim(el, o.always);
}

function onMove(e: PointerEvent) {
  if (e.pointerType === "touch") return;
  px = e.clientX;
  py = e.clientY;
  if (!frame) frame = requestAnimationFrame(update);
  clearTimeout(rest);
  // Once the pointer rests a while, faces go back to their own business.
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

function watch(el: SVGSVGElement, always: boolean) {
  if (!watchers.size) {
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onOut);
  }
  watchers.set(el, { always });
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

// ---------------------------------------------------------------------------
// One face
// ---------------------------------------------------------------------------

export function useFaceLife(
  ref: RefObject<SVGSVGElement | null>,
  { small, big, interactive, always, greet, pulse }: { small: boolean; big: boolean; interactive: boolean; always: boolean; greet: boolean; pulse?: number },
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const awake = () => visible && !document.hidden;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };

    // Blinks run on their own clock, sometimes twice in a row.
    const blink = () =>
      later(() => {
        if (awake()) {
          el.dataset.blink = Math.random() < 0.2 ? "double" : "once";
          later(() => delete el.dataset.blink, 460);
        }
        blink();
      }, small ? rand(3000, 7000) : rand(1800, 5200));
    blink();

    // Little things it does on its own, a beat or two apart. Faces in lists
    // keep to themselves more, so a column of them isn't a fidgety crowd;
    // tiny ones in menus only blink and answer the pointer.
    const fidget = () =>
      later(
        () => {
          if (awake() && !el.dataset.act && !("hover" in el.dataset)) {
            const a = pick((el.dataset.state as FaceState) ?? "idle", "aim" in el.dataset);
            if (a) play(el, a);
          }
          fidget();
        },
        big ? rand(1400, 3800) : rand(4500, 12000),
      );
    if (!small) fidget();
    if (greet && !small) later(() => play(el, "hello"), rand(100, 500));

    const unwatch = small ? () => {} : watch(el, always);

    // Hovering what the face belongs to (its row, its card) gets its attention.
    const host: Element = interactive ? el : (el.closest("button, a, label, [role=button], [role=option], [role=menuitem], [role=radio]") ?? el);
    const enter = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      el.dataset.hover = "";
      play(el, "perk");
    };
    const leave = () => delete el.dataset.hover;
    let pokes: number[] = [];
    const down = () => {
      const now = performance.now();
      pokes = pokes.filter((t) => now - t < 1500);
      pokes.push(now);
      if (interactive && pokes.length >= 4) {
        pokes = [];
        play(el, "dizzy");
      } else play(el, "squish");
    };
    host.addEventListener("pointerenter", enter as EventListener);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointerdown", down);

    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
      unwatch();
      host.removeEventListener("pointerenter", enter as EventListener);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointerdown", down);
      delete el.dataset.hover;
      delete el.dataset.blink;
    };
  }, [ref, small, big, interactive, always, greet]);

  // Nods along as you type to it (at most every so often).
  useEffect(() => {
    const el = ref.current;
    if (pulse === undefined || !el || small || reduced() || !pulse) return;
    const last = Number(el.dataset.nodAt ?? 0);
    if (performance.now() - last < 520) return;
    el.dataset.nodAt = String(performance.now());
    play(el, "nod");
  }, [ref, pulse, small]);
}
