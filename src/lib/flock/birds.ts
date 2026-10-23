/**
 * Flock: the teammates' birds. Every bird lives on a 240×240 grid and is
 * drawn in lines only. Parts carry a role:
 *   o occluder (closed shape filled with the paper, hides what's behind)
 *   k key line · m mid detail · f fine detail · g ghost (motion) · i ink fill
 * Small sizes drop detail: fine and ghost lines below ~half scale, mid lines
 * below ~a third (see `build.ts`).
 */
export type Role = "o" | "k" | "m" | "f" | "g" | "i";
export type Part = [Role, string];
export type Pt = [number, number];
export interface Layer {
  k?: "wing" | "tail";
  hum?: boolean;
  pivot?: Pt;
  raise?: number;
  sway?: number;
  parts: Part[];
}
export interface BirdDef {
  id: BirdId;
  no: string;
  name: string;
  species: string;
  pal: string;
  view: "front" | "left" | "right";
  blurb: string;
  sep: boolean;
  lookRot?: number;
  headPivot?: Pt;
  ground: Pt;
  fxSide: number;
  gazeK?: number;
  noBlush?: boolean;
  faceShift?: number;
  hover?: boolean;
  vbShift?: Pt;
  inkFace?: boolean;
  perch: string | null;
  perchF?: string;
  layers: Layer[];
  head: Part[];
  /** [x, y, r, inward] per eye. */
  eyes: [number, number, number, number][];
  ring: number;
  beak: Pt;
  beakDir: Pt;
  hat: [number, number, number];
  fx: { crown: Pt; think: Pt; mark: Pt; bulb: Pt; zz: Pt; vein: Pt; say: Pt; wink?: [Pt, Pt] };
  orbit: [number, number, number, number];
  shiver: [Pt, Pt];
  bust: [number, number, number, number];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
// Circles and ellipses use spaces so the mirror helper leaves them alone.
const circ = (cx: number, cy: number, r: number) => `M${r1(cx - r)} ${cy} A${r} ${r} 0 1 0 ${r1(cx + r)} ${cy} A${r} ${r} 0 1 0 ${r1(cx - r)} ${cy} Z`;
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${r1(cx - rx)} ${cy} A${rx} ${ry} 0 1 0 ${r1(cx + rx)} ${cy} A${rx} ${ry} 0 1 0 ${r1(cx - rx)} ${cy} Z`;
/** Mirrors an absolute "x,y" path across x = 120. */
const M = (d: string) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => r1(240 - +x) + "," + y);
const scallops = (pts: Pt[], w: number) => pts.map(([x, y]) => `M${r1(x - w)},${y} C${r1(x - w * 0.7)},${r1(y + w * 0.9)} ${r1(x + w * 0.7)},${r1(y + w * 0.9)} ${r1(x + w)},${y}`).join(" ");
function axis(R: Pt, T: Pt) {
  const dx = T[0] - R[0], dy = T[1] - R[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  return { L, p: (a: number, b: number) => r1(R[0] + ux * a - uy * b) + "," + r1(R[1] + uy * a + ux * b) };
}
/** A flame feather: root R to tip T, half-width w; bend shifts the belly, curl hooks the tip. */
function leaf(R: Pt, T: Pt, w: number, bend = 0, curl = 0) {
  const { L, p } = axis(R, T);
  return `M${p(0, 0)} C${p(L * 0.26, w + bend)} ${p(L * 0.74, w * 0.5 + curl)} ${p(L, 0)} C${p(L * 0.74, -w * 0.5 + curl)} ${p(L * 0.26, -w + bend)} ${p(0, 0)} Z`;
}
function vein(R: Pt, T: Pt, bend = 0, curl = 0) {
  const { L, p } = axis(R, T);
  return `M${p(L * 0.12, bend * 0.3)} Q${p(L * 0.55, bend * 0.5 + curl * 0.6)} ${p(L * 0.86, curl * 0.5)}`;
}

/* ═════════ 01 · NYX — great horned owl (front, separable head) ═════════ */
const OWL_BODY = "M120,100 C154,100 176,126 176,160 C176,194 152,214 120,214 C88,214 64,194 64,160 C64,126 86,100 120,100 Z";
const OWL_WING = "M72,124 C56,140 52,172 64,196 C72,210 86,216 100,214 C92,200 90,182 92,164 C94,146 88,130 72,124 Z";
const OWL_WING_F = "M70,140 C61,157 60,179 71,197 M81,140 C74,159 74,182 85,203";
const OWL_HEAD = "M68,30 C80,44 100,52 120,52 C140,52 160,44 172,30 C176,46 182,62 182,82 C182,106 156,124 120,124 C84,124 58,106 58,82 C58,62 64,46 68,30 Z";
const OWL_TUFT = "M71,40 C75,50 82,57 92,60";
const OWL_DISC = "M76,104 C86,114 100,118 110,115";
const nyx: BirdDef = {
  id: "nyx", no: "01", name: "Nyx", species: "Great horned owl", pal: "nightfall", view: "front",
  blurb: "Night-shift reasoning. Turns its whole head to follow you.",
  sep: true, lookRot: 7, headPivot: [120, 120], ground: [120, 222], fxSide: 1,
  perch: "M34,222 L206,222", perchF: "M178,222 C186,221 192,217 196,210 M58,222 L52,228",
  layers: [
    { parts: [["o", OWL_BODY], ["f", scallops([[107, 140], [120, 140], [133, 140], [100, 153], [113, 153], [127, 153], [140, 153], [107, 166], [120, 166], [133, 166], [113, 179], [127, 179]], 5)]] },
    { k: "wing", pivot: [78, 126], raise: 52, parts: [["o", OWL_WING], ["f", OWL_WING_F]] },
    { k: "wing", pivot: [162, 126], raise: -52, parts: [["o", M(OWL_WING)], ["f", M(OWL_WING_F)]] },
    { parts: [["k", "M100,211 L96,220 M106,212 L106,221 M112,211 L116,220 M128,211 L124,220 M134,212 L134,221 M140,211 L144,220"]] },
  ],
  head: [
    ["o", OWL_HEAD],
    ["f", OWL_TUFT + " " + M(OWL_TUFT)],
    ["f", "M108,57 L111,63 M120,56 L120,63 M132,57 L129,63"],
    ["k", "M70,72 C88,62 108,66 120,88 C132,66 152,62 170,72"],
    ["m", circ(96, 91, 15) + " " + circ(144, 91, 15)],
    ["f", OWL_DISC + " " + M(OWL_DISC)],
    ["o", "M113,99 Q120,95 127,99 L120,113 Z"],
  ],
  eyes: [[96, 91, 8.5, 1], [144, 91, 8.5, -1]], ring: 15,
  beak: [120, 113], beakDir: [0, 1], hat: [120, 54, 1.1],
  fx: { crown: [120, 50], think: [184, 22], mark: [192, 56], bulb: [120, 18], zz: [166, 36], vein: [162, 58], say: [40, 40] },
  orbit: [120, 40, 50, 9], shiver: [[52, 160], [188, 160]],
  bust: [50, 22, 140, 140],
};

/* ═════════ 02 · VANTA — common raven (profile, faces right) ═════════ */
const RV_WING = "M94,86 C120,90 142,106 142,128 C142,150 120,166 96,174 C78,180 56,190 38,198 C52,178 64,152 74,126 C80,108 86,94 94,86 Z";
const vanta: BirdDef = {
  id: "vanta", no: "02", name: "Vanta", species: "Common raven", pal: "polar", view: "right",
  blurb: "Sharp, dry, a little smug. Built for power users.",
  sep: false, ground: [120, 208], fxSide: -1,
  perch: "M22,210 C80,205 150,205 218,210", perchF: "M186,207 C192,202 194,196 200,192 M60,208 L56,214",
  layers: [
    { k: "tail", pivot: [80, 172], sway: 2, parts: [["o", "M76,160 L30,194 C27,198 29,204 35,206 L88,180 Z"], ["f", "M72,172 L44,194 M80,176 L50,200"]] },
    { parts: [["o", "M150,64 C140,50 122,46 108,54 C94,62 90,78 86,94 C80,118 72,138 64,156 C58,170 62,180 74,182 C96,184 120,176 136,160 C150,146 158,126 158,108 C158,96 156,88 152,82 Z"]] },
    { k: "wing", pivot: [100, 92], raise: 30, parts: [["o", RV_WING], ["f", "M100,104 C114,110 124,122 124,136 M92,150 C78,162 63,175 48,188 M106,153 C90,165 74,177 58,190"]] },
    { parts: [["k", "M106,180 L102,206 M120,177 L122,206 M102,206 L94,209 M102,206 L108,210 M122,206 L114,209 M122,206 L128,210"]] },
  ],
  head: [
    ["f", "M140,94 L146,100 L140,103 L147,109 L140,112"],
    ["o", "M146,62 C166,58 188,66 206,78 C188,82 168,88 148,88 C144,80 144,70 146,62 Z"],
    ["m", "M151,77 C169,77 187,77 202,78"],
    ["f", "M147,68 C152,65 158,64 164,65"],
    ["k", "M122,60 C128,56 137,56 143,59"],
  ],
  eyes: [[133, 68, 6.5, 1]], ring: 9,
  beak: [206, 78], beakDir: [1, 0], hat: [126, 52, 0.95],
  fx: { crown: [124, 50], think: [64, 28], mark: [94, 34], bulb: [126, 18], zz: [92, 40], vein: [114, 50], say: [196, 36] },
  orbit: [130, 44, 34, 7], shiver: [[52, 150], [166, 128]],
  bust: [78, 22, 136, 136],
};

/* ═════════ 03 · FLOE — emperor penguin (front) ═════════ */
const PG_FLIP = "M80,104 C64,116 52,140 52,164 C52,172 58,174 64,166 C72,154 78,140 82,128 Z";
const PG_CHEEK = "M94,102 L91,106 M99,103 L96,107";
const floe: BirdDef = {
  id: "floe", no: "03", name: "Floe", species: "Emperor penguin", pal: "glacier", view: "front",
  blurb: "Patient and steady. A good default for support.",
  sep: false, noBlush: true, faceShift: 3, ground: [120, 219], fxSide: 1,
  perch: "M40,219 L200,219", perchF: "M66,219 L60,226 M172,219 L178,227 M150,219 L146,224",
  layers: [
    { k: "wing", pivot: [80, 108], raise: 42, parts: [["o", PG_FLIP]] },
    { k: "wing", pivot: [160, 108], raise: -42, parts: [["o", M(PG_FLIP)]] },
    { parts: [
      ["o", "M120,32 C150,32 166,58 168,92 C170,124 178,160 172,184 C166,204 146,214 120,214 C94,214 74,204 68,184 C62,160 70,124 72,92 C74,58 90,32 120,32 Z"],
      ["k", "M120,72 C110,60 90,62 88,84 C86,102 94,116 90,134 C86,158 88,184 104,198 C110,202 116,204 120,204 C124,204 130,202 136,198 C152,184 154,158 150,134 C146,116 154,102 152,84 C150,62 130,60 120,72 Z"],
      ["f", "M98,46 C104,40 112,37 120,37"],
      ["f", "M114,150 L120,154 L126,150 M106,168 L112,172 L118,168 M122,168 L128,172 L134,168 M114,186 L120,190 L126,186"],
    ] },
    { parts: [["o", ell(104, 214, 13, 5) + " " + ell(136, 214, 13, 5)], ["f", "M98,214 L97,218 M104,215 L104,219 M110,214 L111,218 M130,214 L129,218 M136,215 L136,219 M142,214 L143,218"]] },
  ],
  head: [
    ["f", PG_CHEEK + " " + M(PG_CHEEK)],
    ["o", "M112,99 Q120,95 128,99 Q125,108 120,112 Q115,108 112,99 Z"],
    ["f", "M114,101 Q120,104 126,101"],
  ],
  eyes: [[105, 88, 7, 1], [135, 88, 7, -1]], ring: 9.5,
  beak: [120, 112], beakDir: [0, 1], hat: [120, 36, 1],
  fx: { crown: [120, 34], think: [180, 30], mark: [178, 50], bulb: [120, 12], zz: [160, 30], vein: [150, 50], say: [56, 40] },
  orbit: [120, 36, 40, 8], shiver: [[44, 140], [196, 140]],
  bust: [52, 22, 136, 136],
};

/* ═════════ 04 · TALON — peregrine falcon (profile, faces left) ═════════ */
const talon: BirdDef = {
  id: "talon", no: "04", name: "Talon", species: "Peregrine falcon", pal: "steel", view: "left",
  blurb: "Fast and precise. Made for speed modes.",
  sep: false, ground: [120, 210], fxSide: 1, gazeK: 0.75,
  perch: "M30,211 C90,207 150,207 212,211", perchF: "M52,209 C46,204 44,198 38,194 M180,209 L186,215",
  layers: [
    { k: "tail", pivot: [152, 172], sway: 1.5, parts: [["o", "M146,168 L162,214 C164,218 172,218 176,214 L162,166 Z"], ["f", "M156,176 L166,210"]] },
    { parts: [["o", "M98,174 C93,189 101,203 114,203 C127,203 133,191 128,176 Z"], ["f", "M104,194 L107,199 M114,195 L114,200 M123,193 L121,198"]] },
    { parts: [
      ["o", "M84,64 C92,50 110,44 126,48 C140,52 148,64 146,80 C145,98 152,118 156,140 C160,162 156,182 138,190 C124,196 108,192 100,180 C90,164 84,142 84,120 C84,106 84,96 82,86 Z"],
      ["f", "M104,124 L110,128 L116,124 M120,132 L126,136 L132,132 M100,140 L106,144 L112,140 M116,150 L122,154 L128,150 M104,160 L110,164 L116,160"],
      ["i", "M85,61 C92,50 110,45 126,49 C139,53 147,64 146,80 C135,86 123,87 112,85 C106,90 102,97 98,106 C92,99 88,91 86,79 Z"],
      ["k", "M85,61 C92,50 110,45 126,49 C139,53 147,64 146,80 C135,86 123,87 112,85 C106,90 102,97 98,106 C92,99 88,91 86,79"],
    ] },
    { k: "wing", pivot: [140, 92], raise: -30, parts: [["o", "M138,88 C122,98 116,120 118,142 C120,166 138,190 168,208 C172,208 174,206 172,202 C162,178 156,148 152,122 C150,104 146,94 138,88 Z"], ["f", "M131,118 C132,148 144,176 162,200 M141,112 C144,142 154,170 168,200"]] },
    { parts: [["k", "M107,202 L105,210 M120,202 L121,210 M105,210 L98,213 M105,210 L109,214 M121,210 L114,213 M121,210 L126,214"]] },
  ],
  head: [
    ["o", circ(102, 66, 9)],
    ["o", "M89,59 C81,57 73,61 71,69 C70,74 72,79 75,81 C75,77 77,75 80,75 C83,75 86,76 89,78 Z"],
    ["f", "M86,61 C84,66 84,72 86,77"],
  ],
  eyes: [[102, 66, 5.4, -1]], ring: 9, lookRot: 0.8, inkFace: true,
  beak: [72, 78], beakDir: [-1, 0.3], hat: [114, 50, 0.95],
  fx: { crown: [112, 48], think: [178, 26], mark: [154, 40], bulb: [114, 18], zz: [160, 42], vein: [154, 46], say: [46, 32], wink: [[78, 44], [66, 54]] },
  orbit: [112, 44, 36, 7], shiver: [[74, 140], [170, 140]],
  bust: [56, 30, 124, 124],
};

/* ═════════ 05 · ZIP — ruby-throated hummingbird (hovering, faces right) ═════════ */
const zip: BirdDef = {
  id: "zip", no: "05", name: "Zip", species: "Ruby-throated hummingbird", pal: "aurora", view: "right",
  blurb: "Never sits still. Streams before you finish typing.",
  sep: false, hover: true, vbShift: [-6, -18], ground: [120, 150], fxSide: 1,
  perch: null,
  layers: [
    { k: "wing", hum: true, pivot: [114, 96], raise: -16, parts: [["o", "M118,94 C122,66 118,40 104,20 C100,44 104,70 110,98 Z"]] },
    { k: "tail", pivot: [86, 152], sway: 3, parts: [["o", "M84,150 L50,176 C47,178 48,182 52,182 L62,180 L56,192 C55,196 58,198 61,196 L92,160 Z"], ["f", "M80,158 L60,176"]] },
    { parts: [
      ["k", "M112,147 L108,155 M121,142 L118,150"],
      ["g", "M110,100 C94,88 70,80 40,78 M110,102 C96,98 76,100 50,110"],
      ["o", "M150,76 C150,60 138,52 124,54 C110,56 102,68 102,82 C102,102 94,124 80,146 C76,154 80,162 88,160 C108,152 128,136 140,116 C148,102 152,90 150,76 Z"],
      ["f", "M108,112 C116,120 126,124 134,122"],
    ] },
    { k: "wing", hum: true, pivot: [110, 100], raise: -24, parts: [["o", "M114,96 C102,70 82,44 52,26 C64,54 82,80 104,104 Z"], ["f", "M106,90 C94,72 80,56 64,42"]] },
  ],
  head: [
    ["m", "M138,90 C144,98 146,106 142,114"],
    ["f", "M136,96 L140,101 M139,105 L142,109"],
    ["o", "M148,75 L214,69 L150,86 Z"],
  ],
  eyes: [[130, 70, 6, 1]], ring: 9,
  beak: [214, 69], beakDir: [1, 0], hat: [126, 57, 0.9],
  fx: { crown: [126, 56], think: [178, 30], mark: [166, 44], bulb: [150, 22], zz: [172, 40], vein: [140, 56], say: [184, 36] },
  orbit: [128, 48, 30, 6], shiver: [[90, 132], [154, 112]],
  bust: [72, 22, 140, 140],
};

/* ═════════ 06 · FJORD — atlantic puffin (profile, faces left) ═════════ */
const fjord: BirdDef = {
  id: "fjord", no: "06", name: "Fjord", species: "Atlantic puffin", pal: "abyss", view: "left",
  blurb: "Friendly, slightly goofy. Onboarding and tips.",
  sep: false, ground: [120, 212], fxSide: 1,
  perch: "M36,212 L204,212", perchF: "M60,212 L54,219 M76,212 L74,217 M178,212 L184,218",
  layers: [
    { k: "tail", pivot: [154, 176], sway: 2, parts: [["o", "M152,168 L176,184 C179,186 178,191 174,191 L148,182 Z"]] },
    { parts: [
      ["o", "M114,46 C136,46 150,62 150,82 C150,96 160,114 162,138 C164,170 148,196 118,198 C92,200 78,182 78,158 C78,140 86,124 88,110 C84,104 82,96 82,86 C82,62 94,46 114,46 Z"],
      ["m", "M88,110 C102,118 126,118 148,106"],
      ["f", "M92,124 C86,148 88,172 102,190"],
    ] },
    { k: "wing", pivot: [146, 94], raise: -30, parts: [["o", "M144,90 C128,102 120,126 124,150 C128,168 140,180 156,184 C162,164 162,136 158,116 C156,104 150,96 144,90 Z"], ["f", "M136,120 C136,140 142,160 152,174"]] },
    { parts: [["o", "M104,194 L90,212 L114,212 Z M126,194 L118,212 L142,212 Z"], ["f", "M102,200 L100,212 M131,200 L130,212"]] },
  ],
  head: [
    ["m", "M118,56 C129,66 131,86 121,99 C114,107 103,109 94,106"],
    ["f", "M98,67 L102,62 L106,67 M108,80 C112,82 116,82 120,79"],
    ["o", "M86,62 C74,62 60,72 52,84 C50,88 52,92 56,92 C66,94 76,98 86,104 C82,92 82,76 86,62 Z"],
    ["m", "M75,66 C71,76 71,88 77,98"],
    ["f", "M64,74 C61,80 61,88 65,94"],
  ],
  eyes: [[102, 76, 6, -1]], ring: 9,
  beak: [54, 86], beakDir: [-1, 0], hat: [114, 50, 0.95],
  fx: { crown: [114, 48], think: [182, 30], mark: [160, 46], bulb: [116, 20], zz: [166, 42], vein: [136, 58], say: [44, 40] },
  orbit: [114, 44, 38, 7], shiver: [[70, 150], [174, 150]],
  bust: [44, 32, 128, 128],
};

/* ═════════ 07 · FLAKE — snow bunting (round, front) ═════════ */
const FL_WING = "M60,108 C42,126 40,160 66,184 C76,192 86,186 86,172 C86,150 78,124 60,108 Z";
const FL_WING_F = "M58,138 C57,154 63,168 74,177";
const FL_CHEEK = "M82,126 C86,130 92,130 96,126";
const flake: BirdDef = {
  id: "flake", no: "07", name: "Flake", species: "Snow bunting", pal: "frost", view: "front",
  blurb: "Tiny and round. Reads clearly at 24 px.",
  sep: false, noBlush: true, faceShift: 4, ground: [120, 214], fxSide: 1,
  perch: "M36,214 L204,214", perchF: "M178,214 C186,213 192,208 196,202 M62,214 L58,220",
  layers: [
    { k: "tail", pivot: [174, 172], sway: 2, parts: [["o", "M170,164 L204,175 C208,176 208,182 204,183 L198,184 L202,189 C204,192 201,195 198,193 L168,180 Z"], ["f", "M176,172 L196,179"]] },
    { parts: [
      ["o", "M120,58 C162,58 192,90 192,130 C192,170 160,200 120,200 C80,200 48,170 48,130 C48,90 78,58 120,58 Z"],
      ["k", "M113,59 C109,50 111,42 117,36 M121,58 C122,50 127,44 134,42"],
      ["f", "M66,100 C82,80 158,80 174,100"],
      ["f", "M104,160 C112,164 128,164 136,160 M110,174 C116,177 124,177 130,174"],
    ] },
    { k: "wing", pivot: [62, 114], raise: 55, parts: [["o", FL_WING], ["f", FL_WING_F]] },
    { k: "wing", pivot: [178, 114], raise: -55, parts: [["o", M(FL_WING)], ["f", M(FL_WING_F)]] },
    { parts: [["k", "M110,198 L108,212 M130,198 L132,212 M108,212 L100,215 M108,212 L106,218 M108,212 L114,216 M132,212 L126,216 M132,212 L134,218 M132,212 L140,215"]] },
  ],
  head: [
    ["f", FL_CHEEK + " " + M(FL_CHEEK)],
    ["o", "M113,120 Q120,116 127,120 L120,132 Z"],
  ],
  eyes: [[98, 110, 8.5, 1], [142, 110, 8.5, -1]], ring: 12,
  beak: [120, 132], beakDir: [0, 1], hat: [120, 62, 1.1],
  fx: { crown: [120, 60], think: [188, 40], mark: [184, 62], bulb: [120, 20], zz: [172, 50], vein: [160, 80], say: [50, 46] },
  orbit: [120, 56, 50, 9], shiver: [[36, 136], [204, 136]],
  bust: [38, 24, 164, 164],
};

/* ═════════ 08 · CINDER — phoenix (front, head turned left) ═════════ */
const PX_S = [108, 122], PX_W = [70, 74];
const PX_TIPS = [[60, 156], [40, 134], [26, 108], [20, 78], [26, 48], [42, 24], [66, 12]];
const PX_WID = [8, 9, 10, 10.5, 10, 9, 8];
const PX_CURL = [8, 8, 7, 6, 4, 2, -2];
const pxWing: Part[] = [];
(PX_TIPS as Pt[]).forEach((T, i) => {
const R: Pt = [PX_S[0] + (PX_W[0] - PX_S[0]) * i / 6, PX_S[1] + (PX_W[1] - PX_S[1]) * i / 6];
  pxWing.push(["o", leaf(R, T, PX_WID[i], -3, PX_CURL[i])], ["f", vein(R, T, -3, PX_CURL[i])]);
});
pxWing.push(
  ["o", "M114,128 C106,108 92,86 76,66 C70,60 60,63 61,72 C62,82 66,90 70,96 C74,104 80,112 86,118 C92,126 98,132 104,136 C110,138 115,134 114,128 Z"],
  ["f", "M70,96 C76,94 80,98 80,104 M86,118 C92,115 97,119 97,125 M104,124 C96,108 86,94 74,78"],
);
const pxTail: Part[] = [];
([[[118, 170], [100, 214], 4.5, 0, -4], [[122, 170], [140, 214], 4.5, 0, 4], [[116, 172], [90, 228], 7, 2, -8], [[124, 172], [150, 228], 7, -2, 8], [[120, 174], [120, 236], 7.5, 0, 0]] as [Pt, Pt, number, number, number][]).forEach(([R, T, w, b, c]) => pxTail.push(["o", leaf(R, T, w, b, c)], ["f", vein(R, T, b, c)]));
const pxCrest: Part[] = [];
([[[118, 62], [120, 30], 4, 0, -4], [[122, 64], [140, 34], 4.5, 0, 5], [[126, 68], [156, 48], 4, 0, 6]] as [Pt, Pt, number, number, number][]).forEach(([R, T, w, b, c]) => pxCrest.push(["o", leaf(R, T, w, b, c)]));
const cinder: BirdDef = {
  id: "cinder", no: "08", name: "Cinder", species: "Phoenix", pal: "ember", view: "left",
  blurb: "The pro tier. Comes back from every error.",
  sep: false, hover: true, ground: [120, 190], fxSide: 1,
  perch: null,
  layers: [
    { k: "tail", pivot: [120, 176], sway: 3, parts: pxTail },
    { k: "wing", pivot: [110, 124], raise: -60, parts: pxWing },
    { k: "wing", pivot: [130, 124], raise: 60, parts: pxWing.map(([r, d]): Part => [r, M(d)]) },
    { parts: pxCrest },
    { parts: [
      ["o", "M128,106 C132,94 134,80 130,70 C126,60 116,56 108,60 C104,62 101,65 99,68 L86,75 L99,79 C103,88 108,98 112,106 Z"],
      ["o", "M120,98 C136,104 144,124 140,146 C136,164 128,176 120,184 C112,176 104,164 100,146 C96,124 104,104 120,98 Z"],
      ["f", "M112,120 L120,128 L128,120 M110,138 L120,147 L130,138 M114,156 L120,162 L126,156"],
    ] },
  ],
  head: [
    ["k", "M102,63 C108,60 116,60 122,64"],
    ["f", "M99,75 L90,75"],
    ["f", "M114,80 C119,86 121,94 119,101"],
  ],
  eyes: [[110, 70, 5.5, -1]], ring: 8,
  beak: [86, 75], beakDir: [-1, 0], hat: [116, 62, 0.9],
  fx: { crown: [116, 60], think: [172, 32], mark: [148, 46], bulb: [104, 26], zz: [150, 42], vein: [126, 74], say: [58, 56] },
  orbit: [112, 52, 30, 6], shiver: [[92, 150], [148, 150]],
  bust: [68, 30, 104, 104],
};


export const BIRD_IDS = ["nyx", "vanta", "floe", "talon", "zip", "fjord", "flake", "cinder"] as const;
export type BirdId = (typeof BIRD_IDS)[number];
/** The whole bird, tightly framed (a square around its drawn extent, perch left out): how avatars show it. */
export const FIT: Record<BirdId, [number, number, number, number]> = {
  nyx: [18.5, 24, 203, 203],
  vanta: [23, 35.5, 189, 189],
  floe: [20.5, 26, 199, 199],
  talon: [32.5, 41, 182, 182],
  zip: [32.5, 14, 189, 189],
  fjord: [25.5, 40, 178, 178],
  flake: [29.5, 30, 194, 194],
  cinder: [2, 6, 236, 236],
};

export const BIRDS: BirdDef[] = [nyx, vanta, floe, talon, zip, fjord, flake, cinder];
export const BIRD: Record<string, BirdDef> = Object.fromEntries(BIRDS.map((b) => [b.id, b]));
