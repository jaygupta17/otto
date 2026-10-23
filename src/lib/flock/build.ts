/**
 * Draws one bird in one mood as SVG markup, in lines only: no tile behind
 * it. Occluders are filled with the paper (`--bird-paper`, white in light
 * and black in dark) and the svg blends with what's under it (multiply or
 * screen, `.fk` in styles.css), so the paper drops out on any surface, hover
 * or theme while still hiding the lines a wing or head passes over. Lines
 * are `currentColor`.
 *
 * Every line is drawn at every size, so a bird looks the same in a menu as
 * in a hero; only the line weight follows the drawn size.
 */
import { BIRD, BIRDS, FIT, type BirdDef, type BirdId, type Pt } from "./birds";

export type Mood = "idle" | "think" | "type" | "happy" | "love" | "idea" | "wow" | "huh" | "angry" | "sad" | "sleep" | "wink" | "party" | "cool" | "error" | "brr";
type EyeShape = "open" | "small" | "wide" | "happy" | "closed" | "heart" | "star" | "x" | "squeeze" | "lidA" | "lidS" | "lid";
interface MoodDef {
  e2: [EyeShape, EyeShape];
  e1: EyeShape;
  gaze?: Pt;
}

/** e2: [left, right] eyes for front-facing birds; e1 for one-eyed profiles. */
export const MOODS: Record<Mood, MoodDef> = {
  idle: { e2: ["open", "open"], e1: "open" },
  think: { e2: ["open", "open"], e1: "open", gaze: [0.55, -0.85] },
  type: { e2: ["open", "open"], e1: "open", gaze: [0.3, 0.85] },
  happy: { e2: ["happy", "happy"], e1: "happy" },
  love: { e2: ["heart", "heart"], e1: "heart" },
  idea: { e2: ["wide", "wide"], e1: "wide", gaze: [0.1, -0.6] },
  wow: { e2: ["wide", "wide"], e1: "wide" },
  huh: { e2: ["open", "small"], e1: "small" },
  angry: { e2: ["lidA", "lidA"], e1: "lidA" },
  sad: { e2: ["lidS", "lidS"], e1: "lidS", gaze: [0, 0.6] },
  sleep: { e2: ["closed", "closed"], e1: "closed", gaze: [0, 0.3] },
  wink: { e2: ["happy", "open"], e1: "happy" },
  party: { e2: ["star", "star"], e1: "star" },
  cool: { e2: ["lid", "lid"], e1: "lid" },
  error: { e2: ["x", "x"], e1: "x" },
  brr: { e2: ["squeeze", "squeeze"], e1: "squeeze" },
};

const f = (n: number) => Math.round(n * 100) / 100;
/** Placeholder for the paper; swapped for a style at the end (presentation attributes can't take var()). */
const BG = "§p";
const INK = "currentColor";

/* ── Seeded randomness for scene marks, so a bird's confetti is always the same ── */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

/* ── Eyes ── */
const BLINK = new Set<EyeShape>(["open", "small", "wide", "lidA", "lidS", "lid"]);
function lidPath(r: number, i: number, yI: number, yO: number) {
  const hw = r * 0.53, cyB = r - hw, xi = i * hw, xo = -i * hw;
  return `M${f(xo)},${f(yO)} L${f(xi)},${f(yI)} L${f(xi)},${f(cyB)} A${f(hw)},${f(hw)} 0 0 ${i > 0 ? 1 : 0} ${f(xo)},${f(cyB)} Z`;
}
const sparkle = (s: number, q = s * 0.14) => `M0,${f(-s)} Q${f(q)},${f(-q)} ${f(s)},0 Q${f(q)},${f(q)} 0,${f(s)} Q${f(-q)},${f(q)} ${f(-s)},0 Q${f(-q)},${f(-q)} 0,${f(-s)} Z`;
const heart = (s: number) => `M0,${f(s * 0.62)} C${f(-s * 0.95)},0 ${f(-s * 0.75)},${f(-s * 0.9)} 0,${f(-s * 0.4)} C${f(s * 0.75)},${f(-s * 0.9)} ${f(s * 0.95)},0 0,${f(s * 0.62)} Z`;
function eyeShape(sh: EyeShape, r: number, i: number, sw: number) {
  const w = r * 1.06, h = r * 2;
  const pill = (W: number, H: number) => `<rect x="${f(-W / 2)}" y="${f(-H / 2)}" width="${f(W)}" height="${f(H)}" rx="${f(W / 2)}" fill="${INK}" stroke="none"/>`;
  const line = (d: string, k: number) => `<path d="${d}" stroke-width="${f(sw * k)}"/>`;
  switch (sh) {
    case "small": return pill(w * 0.72, h * 0.6);
    case "wide": return `<circle r="${f(r * 0.96)}" fill="${INK}" stroke="none"/><circle cx="${f(r * 0.3)}" cy="${f(-r * 0.34)}" r="${f(r * 0.27)}" fill="${BG}" stroke="none"/>`;
    case "happy": return line(`M${f(-r * 0.64)},${f(r * 0.28)} C${f(-r * 0.6)},${f(-r * 0.7)} ${f(r * 0.6)},${f(-r * 0.7)} ${f(r * 0.64)},${f(r * 0.28)}`, 1.25);
    case "closed": return line(`M${f(-r * 0.68)},${f(-r * 0.12)} C${f(-r * 0.5)},${f(r * 0.62)} ${f(r * 0.5)},${f(r * 0.62)} ${f(r * 0.68)},${f(-r * 0.12)}`, 1.2);
    case "heart": return `<path class="fk-beat" d="${heart(r * 1.12)}" fill="${INK}" stroke-width="${f(sw * 0.5)}"/>`;
    case "star": return `<path class="fk-twk" d="${sparkle(r * 1.25)}" fill="${INK}" stroke="none"/>`;
    case "x": { const a = r * 0.5; return line(`M${f(-a)},${f(-a)} L${f(a)},${f(a)} M${f(a)},${f(-a)} L${f(-a)},${f(a)}`, 1.15); }
    case "squeeze": { const a = r * 0.46, b = r * 0.52; return line(`M${f(-a * i)},${f(-b)} L${f(a * i)},0 L${f(-a * i)},${f(b)}`, 1.15); }
    case "lidA": return `<path d="${lidPath(r, i, r * 0.12, -r * 0.42)}" fill="${INK}" stroke="none"/>`;
    case "lidS": return `<path d="${lidPath(r, i, -r * 0.42, r * 0.08)}" fill="${INK}" stroke="none"/>`;
    case "lid": return `<path d="${lidPath(r, i, -r * 0.04, -r * 0.04)}" fill="${INK}" stroke="none"/>`;
    default: return pill(w, h);
  }
}

/* ── Face extras (ride with the head) ── */
function shades(b: BirdDef, sw: number) {
  const a = Math.max(b.eyes[0][2] * 2.15, b.ring * 1.22), h = a * 0.78;
  const tw = a / 2, bw = a * 0.43, ty = -h * 0.44, by = h * 0.52, rr = a * 0.2;
  const lens = `M${f(-tw)},${f(ty)} L${f(tw)},${f(ty)} L${f(bw)},${f(by - rr)} Q${f(bw)},${f(by)} ${f(bw - rr)},${f(by)} L${f(-bw + rr)},${f(by)} Q${f(-bw)},${f(by)} ${f(-bw)},${f(by - rr)} Z`;
  const glint = `M${f(-a * 0.3)},${f(h * 0.14)} L${f(-a * 0.12)},${f(-h * 0.22)} M${f(-a * 0.1)},${f(h * 0.24)} L${f(a * 0.05)},${f(-h * 0.06)}`;
  const dy = b.eyes[0][2] * 0.16, [lf, gl] = b.inkFace ? [BG, INK] : [INK, BG];
  let o = "", frame = "";
  b.eyes.forEach(([x, y]) => {
    o += `<g transform="translate(${x} ${f(y + dy)})"><path d="${lens}" fill="${lf}"/><g class="fk-flick"><path d="${glint}" stroke="${gl}" stroke-width="${f(sw * 0.7)}"/></g></g>`;
  });
  if (b.eyes.length === 2) {
    const [[x0, y0], [x1, y1]] = b.eyes, t0 = y0 + dy + ty, t1 = y1 + dy + ty;
    frame = `M${f(x0 + tw)},${f(t0 + 1)} Q${f((x0 + x1) / 2)},${f(Math.min(t0, t1) - 4)} ${f(x1 - tw)},${f(t1 + 1)} M${f(x0 - tw)},${f(t0)} l-5,-1.5 M${f(x1 + tw)},${f(t1)} l5,-1.5`;
  } else {
    const [[x, y]] = b.eyes, back = b.beakDir[0] >= 0 ? -1 : 1, t = y + dy + ty;
    frame = `M${f(x + back * tw)},${f(t)} L${f(x + back * (tw + 17))},${f(t - 2.5)}`;
  }
  return `<g class="fk-drop"><path d="${frame}" stroke-width="${f(sw * 1.05)}"/>${o}</g>`;
}
function hat(b: BirdDef, sw: number) {
  const [x, y, s] = b.hat, H = 30 * s, W = 11 * s;
  const pt = (u: number, t: number) => `${f(u * W * (1 - t))},${f(-H * t)}`;
  return `<g transform="translate(${x} ${y}) rotate(${b.view === "left" ? 12 : -12})"><g class="fk-drop"><path d="M${f(-W)},0 L0,${f(-H)} L${f(W)},0 Q0,${f(4 * s)} ${f(-W)},0 Z" fill="${BG}"/><path d="M${pt(-1, 0.3)} L${pt(1, 0.48)} M${pt(-1, 0.62)} L${pt(1, 0.76)}" stroke-width="${f(sw * 0.7)}"/><circle cy="${f(-H - 3 * s)}" r="${f(3.6 * s)}" fill="${INK}"/></g></g>`;
}
function faceFx(b: BirdDef, mood: Mood, sw: number, lod: number) {
  let o = "";
  if ((mood === "happy" || mood === "love" || mood === "wink") && !b.noBlush && lod < 2) {
    const d = b.eyes.map(([x, y, r]) => { const by = y + r + 5; return `M${f(x - r * 0.75)},${f(by + 1.6)} l2.4,-3.4 M${f(x + 0.2)},${f(by + 1.6)} l2.4,-3.4`; }).join(" ");
    o += `<path d="${d}" stroke-width="${f(sw * 0.62)}" opacity=".85"/>`;
  }
  if (mood === "sad" && lod < 2) {
    const [x, y, r, i] = b.eyes[0];
    o += `<g transform="translate(${f(x - i * r * 0.35)} ${f(y + r + 3)})"><path class="fk-tear" d="M0,-4 C2,-1 3.2,1 3.2,2.6 A3.2,3.2 0 0 1 -3.2,2.6 C-3.2,1 -2,-1 0,-4 Z" fill="${BG}" stroke-width="${f(sw * 0.7)}"/></g>`;
  }
  if (mood === "cool") o += shades(b, sw);
  if (mood === "party" && lod < 2) o += hat(b, sw);
  return o;
}

/* ── Scene marks (float around the bird, clamped into the crop) ── */
const CLOUD = "M-12,9 C-20,9 -21,-1 -13,-3 C-13,-11 -3,-14 2,-8 C6,-13 16,-11 15,-3 C22,-2 22,9 13,9 Z";
const BUBBLE = "M-10,-10 H10 A7,7 0 0 1 17,-3 V3 A7,7 0 0 1 10,10 H-10 A7,7 0 0 1 -17,3 V-3 A7,7 0 0 1 -10,-10 Z";
const BULB = "M-5,7 C-5,3 -9,1 -9,-5 A9,9 0 1 1 9,-5 C9,1 5,3 5,7 Z";
const star5 = (R: number, r: number) => { let d = ""; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, q = k % 2 ? r : R; d += (k ? "L" : "M") + f(Math.cos(a) * q) + "," + f(Math.sin(a) * q); } return d + "Z"; };
const flakeD = (s: number) => `M0,${f(-s)} V${f(s)} M${f(-s * 0.87)},${f(-s * 0.5)} L${f(s * 0.87)},${f(s * 0.5)} M${f(-s * 0.87)},${f(s * 0.5)} L${f(s * 0.87)},${f(-s * 0.5)}`;
function sceneFx(b: BirdDef, mood: Mood, vb: number[], sw: number) {
  const [vx, vy, vw, vh] = vb, fx = b.fx;
  const cl = ([x, y]: Pt, mx = 14, my = 14): Pt => [Math.min(Math.max(x, vx + mx), vx + vw - mx), Math.min(Math.max(y, vy + my), vy + vh - my)];
  const at = ([x, y]: Pt, inner: string, cls = "", st = "") => `<g transform="translate(${f(x)} ${f(y)})"><g${cls ? ` class="${cls}"` : ""}${st ? ` style="${st}"` : ""}>${inner}</g></g>`;
  const P = (d: string, k?: number, fill?: string) => `<path d="${d}"${k ? ` stroke-width="${f(sw * k)}"` : ""}${fill ? ` fill="${fill}"` : ""}/>`;
  const dot = (cx: number, cy: number, r: number, cls = "", st = "") => `<circle${cls ? ` class="${cls}"` : ""}${st ? ` style="${st}"` : ""} cx="${cx}" cy="${cy}" r="${f(r)}" fill="${INK}" stroke="none"/>`;
  const lerp = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const [cx, cy] = fx.crown, R = rng(hash(b.id + mood));
  let o = "";
  switch (mood) {
    case "think": {
      const c = cl(fx.think, 23, 16);
      o += at(lerp(c, fx.crown, 0.68), `<circle r="2.1" fill="${BG}"/>`, "fk-bob", "animation-delay:-.7s");
      o += at(lerp(c, fx.crown, 0.44), `<circle r="3.5" fill="${BG}"/>`, "fk-bob", "animation-delay:-.35s");
      o += at(c, P(CLOUD, 0, BG) + [-6.5, 0, 6.5].map((x, n) => dot(x, 1.2, 1.75, "fk-dot", `animation-delay:${n * 0.18}s`)).join(""), "fk-bob");
      break;
    }
    case "type": {
      const c = cl(fx.say, 20, 16), s = b.beak[0] >= c[0] ? 1 : -1;
      o += at(c, P(BUBBLE, 0, BG) + `<path d="M${4 * s},8.6 L${13 * s},17.5 L${11 * s},8.6" fill="${BG}"/>` + [-7, 0, 7].map((x, n) => dot(x, 0, 1.8, "fk-bnc", `animation-delay:${n * 0.14}s`)).join(""), "fk-bob");
      break;
    }
    case "happy":
      [-1, 1].forEach((s) => { o += at(cl([cx + s * 36, cy + 6]), P(`M${s * 2},-6 L${s * 5},-11 M${s * 5},0 L${s * 11},-1 M${s * 3},5 L${s * 7},9`, 0.75), "fk-popin"); });
      break;
    case "love":
      ([[-32, -2, 6, 0, BG], [30, -12, 5, -1, INK], [4, -28, 7, -2, BG]] as const).forEach(([dx, dy, s, d, fill]) => {
        o += at(cl([cx + dx, cy + dy], 10, 12), P(heart(s * 1.6), 0.8, fill), "fk-rise", `animation-delay:${d}s`);
      });
      break;
    case "idea": {
      const rays = [-160, -125, -90, -55, -20].map((a, n) => { const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180); return `<path class="fk-ray" style="animation-delay:${n * 0.12}s" d="M${f(c * 13)},${f(-5 + s * 13)} L${f(c * 18.5)},${f(-5 + s * 18.5)}" stroke-width="${f(sw * 0.8)}"/>`; }).join("");
      o += at(cl(fx.bulb, 21, 25), P(BULB, 0, BG) + P("M-4.5,10.5 H4.5 M-3,14 H3", 0.8) + P("M-3,3 L-1.5,-3 L0,0 L1.5,-3 L3,3", 0.6) + rays, "fk-popin");
      break;
    }
    case "wow":
      o += at(cl(fx.mark, 10, 16), P("M0,-11 L0,1", 1.5) + dot(0, 7.5, sw * 0.85), "fk-popin");
      o += at(cl([cx, cy - 4], 22, 22), P("M-15,-5 L-20,-10 M0,-11 L0,-18 M15,-5 L20,-10", 0.75), "fk-popin", "animation-delay:.08s");
      break;
    case "huh":
      o += at(cl(fx.mark, 10, 16), P("M-5,-6.5 C-5,-12.5 5,-12.5 5,-6.5 C5,-2.5 0,-1.5 0,3.5", 1.3) + dot(0, 9.5, sw * 0.85), "fk-wob");
      break;
    case "angry":
      o += at(cl(fx.vein, 12, 12), P("M-7.5,-2.5 Q-2.5,-2.5 -2.5,-7.5 M2.5,-7.5 Q2.5,-2.5 7.5,-2.5 M7.5,2.5 Q2.5,2.5 2.5,7.5 M-2.5,7.5 Q-2.5,2.5 -7.5,2.5", 1.1), "fk-beat");
      break;
    case "sleep": {
      // Drawn small the z's would vanish, so they grow as the bird shrinks (sw is thicker then).
      const zk = Math.min(1.9, Math.max(1, sw / 2.6));
      const z = (s: number) => `M${-s},${-s} H${s} L${-s},${s} H${s}`, sd = b.fxSide || 1;
      [[0, 0, 3.2, 0], [10, -10, 4.2, -1.2], [22, -22, 5.4, -2.4]].forEach(([dx, dy, s, d]) => {
        o += at(cl([fx.zz[0] + dx * sd * zk, fx.zz[1] + dy * zk], 12 * zk, 10 * zk), P(z(s * zk), 0.65), "fk-zzz", `animation-delay:${d}s`);
      });
      break;
    }
    case "wink": {
      const e = b.eyes[b.eyes.length - 1];
      const [p1, p2] = fx.wink || [[e[0] - e[3] * (b.ring + 8), e[1] - b.ring - 2], [e[0] - e[3] * (b.ring + 18), e[1] - b.ring + 8]];
      o += at(cl(p1, 10, 10), `<path d="${sparkle(6.5)}" fill="${INK}" stroke="none"/>`, "fk-twinkle");
      o += at(cl(p2, 8, 8), `<path d="${sparkle(3.5)}" fill="${INK}" stroke="none"/>`, "fk-twinkle", "animation-delay:-.9s");
      break;
    }
    case "party":
      for (let n = 0; n < 18; n++) {
        const x = vx + vw * (0.05 + 0.9 * R()), y = vy + vh * (0.05 + 0.5 * R()), k = n % 4;
        const sh = k === 0 ? P("M-2.6,-1 L2.6,1", 0.8) : k === 1 ? dot(0, 0, 1.7) : k === 2 ? P("M-1.9,-1.9 h3.8 v3.8 h-3.8 Z", 0.6, BG) : P("M-3.4,0 q1.7,-2.6 3.4,0 t3.4,0", 0.7);
        o += at([x, y], sh, "fk-fall", `animation-delay:${f(-R() * 2.8)}s;animation-duration:${f(2.2 + R() * 1.4)}s;--dx:${f((R() - 0.5) * 18)}px;--r:${f((R() - 0.5) * 420)}deg`);
      }
      [[-38, -10, 5.5, 0], [36, -18, 4.5, -0.6], [-20, -32, 3.5, -1.2]].forEach(([dx, dy, s, d]) => {
        o += at(cl([cx + dx, cy + dy], 8, 8), `<path d="${sparkle(s)}" fill="${INK}" stroke="none"/>`, "fk-twinkle", `animation-delay:${d}s`);
      });
      break;
    case "cool":
      o += at(cl(fx.mark, 10, 10), `<path d="${sparkle(5.5)}" fill="${INK}" stroke="none"/>`, "fk-twinkle");
      break;
    case "error": {
      const [ox, oy, rx, ry] = b.orbit;
      const path = `M${ox - rx},${oy} A${rx},${ry} 0 1 0 ${ox + rx},${oy} A${rx},${ry} 0 1 0 ${ox - rx},${oy}`;
      for (let k = 0; k < 3; k++) o += `<g><path d="${star5(5, 2.3)}" fill="${BG}" stroke-width="${f(sw * 0.7)}"/><animateMotion dur="2.4s" repeatCount="indefinite" begin="${f(-k * 0.8)}s" path="${path}"/></g>`;
      o += at(cl(fx.mark, 12, 10), P("M-7,-3 H2 M-2,3 H8", 0.8), "fk-shv");
      break;
    }
    case "brr": {
      for (let n = 0; n < 10; n++) {
        const x = vx + vw * (0.06 + 0.88 * R()), y = vy + vh * (0.08 + 0.6 * R());
        o += at([x, y], P(flakeD(2.4 + R() * 1.6), 0.55), "fk-snow", `animation-delay:${f(-R() * 4)}s;animation-duration:${f(3.4 + R() * 1.8)}s;--dx:${f((R() - 0.5) * 16)}px`);
      }
      b.shiver.forEach(([x, y]) => {
        const s = x < 120 ? -1 : 1;
        o += at(cl([x, y], 10, 10), P(`M0,-7 Q${3.5 * s},0 0,7 M${5 * s},-5 Q${7.5 * s},0 ${5 * s},5`, 0.7), "fk-shv");
      });
      const [bx, by] = b.beak, [dx, dy] = b.beakDir;
      [[0, 3.6, 0], [1, 2.6, -1.1]].forEach(([k, r, d]) => {
        o += at([bx + dx * (6 + k * 2), by + dy * (6 + k * 2)], `<circle r="${r}" fill="${BG}" stroke-width="${f(sw * 0.6)}"/>`, "fk-puff", `animation-delay:${d}s;--px:${f(dx * 16 + (dx ? 0 : 6))};--py:${f(dy * 12 - 8)}`);
      });
      break;
    }
  }
  return o;
}

const W_ROLE = { m: 0.8, f: 0.6, g: 0.55 } as const;

/**
 * Light running along the lines: a diagonal band of the accent swept across
 * the drawing. A thinking bird shimmers like the "Working" text does; any
 * other passes a glint now and then. `§g` (the gradient's id) and `§d` (when
 * it starts, so a roster never glints in unison) are filled in per bird.
 */
function shine(vb: number[], mood: Mood) {
  const [x, y, w, h] = vb, d = Math.max(w, h) * 1.3;
  const busy = mood === "think";
  const band = busy ? 0.12 : 0.09;
  const stops = [[0, 0], [0.5 - band, 0], [0.5, 1], [0.5 + band, 0], [1, 0]]
    .map(([o, a]) => `<stop offset="${o}" style="stop-color:${a ? "var(--bird-shine)" : "currentColor"}"/>`).join("");
  const anim = busy
    ? `<animateTransform attributeName="gradientTransform" type="translate" values="${f(-d)} 0;${f(d)} 0" dur="1.8s" begin="§d" repeatCount="indefinite"/>`
    : `<animateTransform attributeName="gradientTransform" type="translate" values="${f(-d)} 0;${f(d)} 0;${f(d)} 0" keyTimes="0;.16;1" calcMode="spline" keySplines=".45 0 .35 1;0 0 1 1" dur="9s" begin="§d" repeatCount="indefinite"/>`;
  return `<defs><linearGradient id="§g" gradientUnits="userSpaceOnUse" x1="${f(x)}" y1="${f(y)}" x2="${f(x + w)}" y2="${f(y + h)}">${stops}${anim}</linearGradient></defs>`;
}

export interface BuildOpts {
  bird: BirdId | string;
  mood?: Mood;
  /** Drawn width in CSS px: sets line weight and how much detail survives. */
  px: number;
  /** "fit" frames the whole bird tightly (the default); "bust" the head and shoulders; "full" the 240 grid, perch and all. */
  crop?: "fit" | "bust" | "full";
  /** Scene marks (thought cloud, sparkles, z's), as in Flock. On unless turned off. */
  fx?: boolean;
  perch?: boolean;
  /** Line weight multiplier. */
  weight?: number;
  /** Drops detail (0 all lines, the default … 2 outline only). */
  lod?: number;
}

const cache = new Map<string, string>();

export function buildBird(o: BuildOpts): string {
  const key = `${o.bird}|${o.mood}|${Math.round(o.px)}|${o.crop}|${o.fx}|${o.perch}|${o.weight}|${o.lod}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = BIRD[o.bird] ?? BIRDS[0], mood = o.mood ?? "idle", E = MOODS[mood] ?? MOODS.idle;
  const crop = o.crop ?? "fit", bust = crop === "bust";
  const vb = (crop === "fit" ? FIT[b.id] : bust ? b.bust : [0, 0, 240, 240]).slice();
  if (crop === "full" && b.vbShift) { vb[0] += b.vbShift[0]; vb[1] += b.vbShift[1]; }
  const vw = vb[2], px = o.px, S = px / vw;
  // One bird everywhere: every line at every size, a touch finer when small so the detail reads.
  const lod = o.lod ?? 0;
  const sw = f(Math.max(2.3, (px <= 56 ? 1.6 : 1.35) / S) * (o.weight || (S < 0.5 && lod === 0 ? 0.8 : 1)));

  const part = ([r, d]: [string, string]) => {
    if ((r === "f" || r === "g") && lod >= 1) return "";
    if (r === "m" && lod >= 2) return "";
    if (r === "o") return `<path d="${d}" fill="${BG}"/>`;
    if (r === "k") return `<path d="${d}"/>`;
    if (r === "i") return `<path d="${d}" fill="${INK}" stroke="none"/>`;
    return `<path d="${d}" stroke-width="${f(sw * W_ROLE[r as keyof typeof W_ROLE])}"${r === "g" ? ' opacity=".3"' : ""}/>`;
  };
  const layer = (L: BirdDef["layers"][number]) => {
    const inner = L.parts.map(part).join("");
    if (!L.k || !L.pivot) return inner;
    const cls = L.k === "wing" ? (L.hum ? "fk-wing fk-hum" : "fk-wing") : "fk-tail";
    return `<g class="${cls}" style="transform-origin:${L.pivot[0]}px ${L.pivot[1]}px;${L.raise != null ? `--raise:${L.raise}deg;` : ""}${L.sway != null ? `--sw:${L.sway};` : ""}">${inner}</g>`;
  };
  const shapes = b.eyes.length === 2 ? E.e2 : [E.e1];
  const k = b.gazeK || (b.view === "front" ? 1 : 0.72);
  const eyes = b.eyes.map(([x, y, r, i], n) => {
    const sh = shapes[n] || "open", ax = f(r * 0.45 * k), ay = f(r * 0.32 * k);
    const g = E.gaze ? ` transform="translate(${f(E.gaze[0] * ax)} ${f(E.gaze[1] * ay)})"` : "";
    return `<g transform="translate(${x} ${y})"><g class="fk-gaze${E.gaze ? " fk-fixed" : ""}" style="--ax:${ax};--ay:${ay}"${g}><g class="fk-lid${BLINK.has(sh) ? " bk" : ""}">${eyeShape(sh, r, i, sw)}</g></g></g>`;
  }).join("");
  const lp = b.sep && b.headPivot ? b.headPivot : [b.eyes.reduce((s, e) => s + e[0], 0) / b.eyes.length, b.eyes.reduce((s, e) => s + e[1], 0) / b.eyes.length];
  const lr = b.lookRot || 2;
  const head = `<g class="fk-head" style="transform-origin:${f(lp[0])}px ${f(lp[1])}px"><g class="fk-look" style="transform-origin:${f(lp[0])}px ${f(lp[1])}px;--lr:${lr}">${b.head.map(part).join("")}${eyes}${faceFx(b, mood, sw, lod)}</g></g>`;
  const showPerch = !!b.perch && crop === "full" && lod < 2 && !!o.perch;
  const perch = showPerch ? `<path d="${b.perch}" stroke-width="${f(sw * 0.85)}"/>${b.perchF && lod < 1 ? `<path d="${b.perchF}" stroke-width="${f(sw * 0.6)}"/>` : ""}` : "";
  const [gx, gy] = b.ground;
  const cls = ["fk", "fk-e-" + mood, b.sep && "fk-sep", b.hover && "fk-hov", b.id === "cinder" && "fk-glide", !E.gaze && "fk-wander", bust && "fk-bust"].filter(Boolean).join(" ");
  const svg = `<svg class="${cls}" viewBox="${vb.join(" ")}" width="100%" height="100%" style="--t:${b.sep ? 1 : 0.5}" aria-hidden="true">${shine(vb, mood)}<g fill="none" stroke="url(#§g)" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${perch}<g class="fk-rig" style="transform-origin:${gx}px ${gy}px"><g class="fk-breath" style="transform-origin:${gx}px ${gy}px">${b.layers.map(layer).join("")}${head}</g></g>${o.fx === false ? "" : `<g class="fk-fx">${sceneFx(b, mood, vb, sw)}</g>`}</g></svg>`;
  const out = svg.replace(/(fill|stroke)="§p"/g, 'style="$1:var(--bird-paper)"');
  cache.set(key, out);
  return out;
}
