/**
 * How bright is the user's background? Used to make the glass adaptive:
 * a light photo under the dark theme (or a dark one under the light theme)
 * would leave text with too little contrast, so the frost gets thicker.
 */

const cache = new Map<string, number>();

/** Relative luminance (0 dark .. 1 light) of an sRGB colour. */
function luminance(r: number, g: number, b: number) {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Average luminance of a photo, sampled on a tiny canvas. */
export async function imageLuminance(src: string): Promise<number> {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += luminance(d[i], d[i + 1], d[i + 2]);
  const v = sum / (d.length / 4);
  cache.set(src, v);
  return v;
}

/** Average luminance of the colours named in a CSS background (hex or rgb()). */
export function cssLuminance(css: string): number {
  const vals: number[] = [];
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, (x) => x + x);
    vals.push(luminance(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)));
  }
  for (const m of css.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/gi)) vals.push(luminance(+m[1], +m[2], +m[3]));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.2;
}

/**
 * 0 when the background suits the theme, up to 1 when it fights it
 * (bright background + dark theme, or dark background + light theme).
 */
export function mismatch(lum: number, theme: "light" | "dark") {
  const v = theme === "dark" ? (lum - 0.25) / 0.45 : (0.55 - lum) / 0.45;
  return Math.max(0, Math.min(1, v));
}
