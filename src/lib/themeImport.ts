/**
 * Importers for themes people already have. Three shapes are understood:
 * Otto's own JSON, tweakcn/shadcn CSS, VS Code colour themes and OpenChamber
 * JSON. Nothing is evaluated: colours are checked and passed through as CSS.
 */
import { isColor, slug, type Theme, type ThemeTokens, type ThemeVariant } from "./themes";

/** A single theme file may not be larger than this. */
export const MAX_THEME_BYTES = 512 * 1024;

/** Otto's status colours, used when an imported format doesn't name them. */
const STATUS: Record<ThemeVariant, Pick<ThemeTokens, "info" | "ok" | "danger">> = {
  light: { info: "#1d5fd6", ok: "#1f8a4c", danger: "#c93a32" },
  dark: { info: "#6d9cff", ok: "#4cc488", danger: "#ff6b62" },
};

const clean = (v: unknown, max = 80): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** "tokyo-night.json" → "Tokyo Night" */
function nameFromFile(fileName: string): string {
  const base = fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .trim();
  const words = base.split(/[-_\s]+/).filter(Boolean);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return (name || "Imported").slice(0, 80);
}

/** Ids starting with `otto` would be treated as Otto's own (no overrides). */
function idFor(name: string): string {
  const s = slug(name);
  return s.startsWith("otto") ? `custom-${s}` : s;
}

/**
 * A free id: the slug, then `-2`, `-3`… Never overwrites something in `taken`.
 */
export function uniqueThemeId(base: string, taken: Set<string>): string {
  const root = slug(base);
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const id = `${root}-${i}`;
    if (!taken.has(id)) return id;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/**
 * Strip `//` and block comments and trailing commas from JSONC without
 * touching string contents (a source URL contains `//`).
 */
export function stripJsonc(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < input.length) {
    const c = input[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += input[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function build(name: string, variant: ThemeVariant, raw: Partial<ThemeTokens>, meta: Partial<Theme> = {}): Theme | null {
  const status = STATUS[variant];
  const tokens: Partial<ThemeTokens> = {
    bg: raw.bg,
    panel: isColor(raw.panel) ? raw.panel : raw.bg,
    text: raw.text,
    accent: isColor(raw.accent) ? raw.accent : raw.text,
    info: isColor(raw.info) ? raw.info : status.info,
    ok: isColor(raw.ok) ? raw.ok : status.ok,
    danger: isColor(raw.danger) ? raw.danger : status.danger,
  };
  const optional = { warn: raw.warn, border: raw.border, codeBg: raw.codeBg };
  for (const [k, v] of Object.entries(optional)) if (isColor(v)) tokens[k as keyof ThemeTokens] = v;
  for (const key of ["bg", "panel", "text", "accent", "info", "ok", "danger"] as const) if (!isColor(tokens[key])) return null;
  const theme: Theme = {
    id: idFor(name),
    name: name.slice(0, 80),
    variant,
    tokens: tokens as ThemeTokens,
    ...(clean(meta.author) ? { author: clean(meta.author) } : {}),
    ...(clean(meta.license) ? { license: clean(meta.license) } : {}),
    ...(clean(meta.source, 200) ? { source: clean(meta.source, 200) } : {}),
  };
  return theme;
}

/** Relative luminance of #hex / rgb() / hsl(); undefined for other forms. */
export function colorLuminance(color: string | undefined): number | undefined {
  if (!color) return undefined;
  const c = color.trim();
  let r: number, g: number, b: number;
  const hex = c.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).replace(/./g, (x) => x + x);
    if (h.length < 6) return undefined;
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const rgb = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
    if (rgb) {
      [r, g, b] = [+rgb[1], +rgb[2], +rgb[3]];
    } else {
      const hsl = c.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/i);
      if (!hsl) return undefined;
      const h = ((+hsl[1] % 360) + 360) % 360;
      const s = Math.min(100, Math.max(0, +hsl[2])) / 100;
      const l = Math.min(100, Math.max(0, +hsl[3])) / 100;
      const k = (n: number) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      r = f(0) * 255;
      g = f(8) * 255;
      b = f(4) * 255;
    }
  }
  const lin = (v: number) => {
    const x = Math.min(255, Math.max(0, v)) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function variantFrom(color: string | undefined, fallback: ThemeVariant = "dark"): ThemeVariant {
  const lum = colorLuminance(color);
  return lum === undefined ? fallback : lum >= 0.45 ? "light" : "dark";
}

/** Bare shadcn HSL triplets (`220 14% 96%`) become a real colour. */
function normalizeValue(value: string): string {
  const v = value.trim().replace(/!important$/i, "").trim();
  if (/^[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%$/.test(v)) return `hsl(${v.replace(/\s+/g, " ")})`;
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name.startsWith("--")) continue;
    out.set(name, normalizeValue(part.slice(i + 1)));
  }
  return out;
}

function cssTokens(vars: Map<string, string>, variant: ThemeVariant): Partial<ThemeTokens> | null {
  const get = (name: string) => vars.get(`--${name}`);
  const bg = get("background");
  const text = get("foreground");
  const accent = get("primary");
  if (!isColor(bg) || !isColor(text) || !isColor(accent)) return null;
  const status = STATUS[variant];
  const tokens: Partial<ThemeTokens> = {
    bg,
    panel: [get("card"), get("popover")].find(isColor) ?? bg,
    text,
    accent,
    info: isColor(get("info")) ? get("info") : status.info,
    ok: isColor(get("success")) ? get("success") : status.ok,
    danger: isColor(get("destructive")) ? get("destructive") : status.danger,
  };
  const border = get("border");
  if (isColor(border)) tokens.border = border;
  const muted = get("muted");
  if (isColor(muted)) tokens.codeBg = muted;
  return tokens;
}

/** tweakcn / shadcn CSS: `:root` is light, `.dark` is dark. */
function parseCss(css: string, fileName: string): Theme[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const base = nameFromFile(fileName);
  const out: Theme[] = [];
  const seen = new Set<ThemeVariant>();
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const vars = declarations(match[2]);
    if (!vars.size) continue;
    const darkSelector = /(^|[\s,>])(\.dark\b|\[data-(?:theme|mode)=["']?dark)/i.test(selector);
    const lightSelector = /:root|(^|[\s,>])(?:html|body|\.light)\b|\[data-(?:theme|mode)=["']?light/i.test(selector);
    if (!darkSelector && !lightSelector) continue;
    // A block that names both is the base palette, not the dark one.
    const variant: ThemeVariant = darkSelector && !lightSelector ? "dark" : "light";
    if (seen.has(variant)) continue;
    const tokens = cssTokens(vars, variant);
    if (!tokens) continue;
    const name = `${base} ${variant === "dark" ? "Dark" : "Light"}`;
    const theme = build(name, variant, tokens);
    if (!theme) continue;
    seen.add(variant);
    out.push(theme);
  }
  if (!out.length) throw new Error("No theme colours found in this CSS");
  return out;
}

function parseOtto(data: Record<string, unknown>, fileName: string): Theme | null {
  const tokens = data.tokens as Partial<ThemeTokens> | undefined;
  if (!tokens || typeof tokens !== "object") return null;
  for (const key of ["bg", "panel", "text", "accent", "info", "ok", "danger"] as const) {
    if (!isColor(tokens[key])) throw new Error("The theme is missing a required colour (bg, panel, text, accent, info, ok, danger)");
  }
  const variant: ThemeVariant = data.variant === "dark" ? "dark" : "light";
  const name = clean(data.name) ?? nameFromFile(fileName);
  return build(name, variant, tokens, {
    author: data.author as string | undefined,
    license: data.license as string | undefined,
    source: data.source as string | undefined,
  });
}

function isOttoJson(data: Record<string, unknown>): boolean {
  return !!data.tokens && typeof data.tokens === "object" && ("variant" in data || "id" in data);
}

function isVsCode(data: Record<string, unknown>): boolean {
  const colors = data.colors as Record<string, unknown> | undefined;
  return !!colors && typeof colors === "object" && typeof colors["editor.background"] === "string";
}

function parseVsCode(data: Record<string, unknown>, fileName: string): Theme {
  const colors = data.colors as Record<string, string>;
  const get = (key: string) => (isColor(colors[key]) ? colors[key] : undefined);
  const panel = get("editor.background");
  const text = get("editor.foreground");
  if (!panel || !text) throw new Error("The theme is missing editor.background or editor.foreground");
  const bg = get("sideBar.background") ?? get("activityBar.background") ?? panel;
  const type = typeof data.type === "string" ? data.type.toLowerCase() : "";
  const variant: ThemeVariant = /light/.test(type) ? "light" : /dark/.test(type) ? "dark" : variantFrom(panel);
  const name = clean(data.name) ?? nameFromFile(fileName);
  const theme = build(
    name,
    variant,
    {
      bg,
      panel,
      text,
      accent: get("button.background") ?? get("focusBorder") ?? text,
      danger: get("errorForeground"),
      ok: get("terminal.ansiGreen"),
      info: get("terminal.ansiBlue"),
      warn: get("terminal.ansiYellow"),
      codeBg: get("editorWidget.background"),
      border: get("panel.border") ?? get("editorGroup.border"),
    },
    { author: typeof data.author === "string" ? data.author : undefined },
  );
  if (!theme) throw new Error("The theme has no usable colours");
  return theme;
}

function isOpenChamber(data: Record<string, unknown>): boolean {
  const colors = data.colors as Record<string, unknown> | undefined;
  return "metadata" in data && !!colors && typeof colors === "object" && "surface" in colors;
}

function parseOpenChamber(data: Record<string, unknown>, fileName: string): Theme {
  const colors = data.colors as Record<string, Record<string, unknown> | undefined>;
  const status = (colors.status ?? {}) as Record<string, unknown>;
  const surface = (colors.surface ?? {}) as Record<string, unknown>;
  const primary = (colors.primary ?? {}) as Record<string, unknown>;
  const interactive = (colors.interactive ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (isColor(v) ? v : undefined);
  const bg = str(surface.background);
  const text = str(surface.foreground);
  if (!bg || !text) throw new Error("The theme is missing surface.background or surface.foreground");
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const declared = typeof meta.type === "string" ? meta.type : typeof data.type === "string" ? data.type : "";
  const variant: ThemeVariant = /light/i.test(declared) ? "light" : /dark/i.test(declared) ? "dark" : variantFrom(bg);
  const name = clean(meta.name) ?? nameFromFile(fileName);
  const theme = build(
    name,
    variant,
    {
      bg,
      panel: str(surface.elevated) ?? bg,
      text,
      accent: str(primary.base) ?? text,
      info: str(status.info),
      ok: str(status.success),
      danger: str(status.error),
      warn: str(status.warning),
      border: str(interactive.border),
    },
    { author: clean(meta.author), license: clean(meta.license) },
  );
  if (!theme) throw new Error("The theme has no usable colours");
  return theme;
}

/**
 * One file → one or two themes (a tweakcn CSS can carry both variants).
 * Throws an Error with a message suitable for a toast.
 */
export function parseThemeText(text: string, fileName = "theme"): Theme[] {
  if (text.length > MAX_THEME_BYTES) throw new Error("The file is larger than 512 KB");
  const src = text.trim();
  if (!src) throw new Error("The file is empty");
  const jsonName = /\.(json|jsonc)$/i.test(fileName);
  if (!jsonName && !src.startsWith("{") && !src.startsWith("[")) return parseCss(src, fileName);

  let data: unknown;
  try {
    data = JSON.parse(stripJsonc(src));
  } catch {
    throw new Error("The file isn't valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("No theme found in this file");
  const obj = data as Record<string, unknown>;
  if (isOttoJson(obj)) {
    const theme = parseOtto(obj, fileName);
    if (!theme) throw new Error("The theme is missing a required colour (bg, panel, text, accent, info, ok, danger)");
    return [theme];
  }
  if (isOpenChamber(obj)) return [parseOpenChamber(obj, fileName)];
  if (isVsCode(obj)) return [parseVsCode(obj, fileName)];
  throw new Error("No theme found in this file");
}
