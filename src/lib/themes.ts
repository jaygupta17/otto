/**
 * Themes: a handful of colours, everything else derived.
 *
 * A theme names the nine colours Otto actually uses; the rest of the token
 * set is mixed from them so a palette can't leave the app half-styled. The
 * `otto-*` ids are the app's own tokens, so they apply nothing at all.
 */
import { BUILTIN_THEMES } from "./themes/builtin";

export type ThemeVariant = "light" | "dark";

/** The colours a theme must (or may) name. Everything else is derived. */
export interface ThemeTokens {
  bg: string;
  panel: string;
  text: string;
  accent: string;
  info: string;
  ok: string;
  danger: string;
  warn?: string;
  border?: string;
  codeBg?: string;
}

export interface Theme {
  id: string;
  name: string;
  variant: ThemeVariant;
  author?: string;
  license?: string;
  /** Where the palette came from (shown in the licence list, not the picker). */
  source?: string;
  builtin?: boolean;
  tokens: ThemeTokens;
}

/** Every CSS custom property a theme sets on `:root`. */
export const THEME_VARS = [
  "--bg",
  "--bg-deep",
  "--bg-panel",
  "--surface",
  "--surface-solid",
  "--surface-raised",
  "--surface-sunken",
  "--hover",
  "--active",
  "--border",
  "--border-strong",
  "--text",
  "--text-2",
  "--muted",
  "--faint",
  "--accent",
  "--accent-soft",
  "--accent-text",
  "--info",
  "--info-soft",
  "--spark",
  "--ok",
  "--ok-soft",
  "--warn",
  "--warn-soft",
  "--danger",
  "--danger-soft",
  "--code-bg",
] as const;

export { BUILTIN_THEMES };

/** Otto's own themes have no overrides: the stylesheet already has their colours. */
export const isOttoTheme = (theme: Pick<Theme, "id">) => theme.id.startsWith("otto");

const mix = (a: string, b: string, pct: number) => `color-mix(in oklab, ${a}, ${b} ${pct}%)`;
const alpha = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/**
 * The full colour token set for a theme. Empty for `otto-*`, which keeps the
 * stylesheet's defaults.
 */
export function themeVars(theme: Theme): Record<string, string> {
  if (isOttoTheme(theme)) return {};
  const { bg, panel, text, accent, info, ok, danger } = theme.tokens;
  const warn = theme.tokens.warn ?? accent;
  const dark = theme.variant === "dark";
  const border = theme.tokens.border ?? mix(bg, text, dark ? 20 : 14);
  const borderStrong = theme.tokens.border ? mix(theme.tokens.border, text, 12) : mix(bg, text, dark ? 30 : 24);
  return {
    "--bg": bg,
    "--bg-deep": dark ? bg : mix(bg, "black", 5),
    "--bg-panel": panel,
    "--surface": mix(panel, text, dark ? 6 : 4),
    "--surface-solid": panel,
    "--surface-raised": mix(panel, text, dark ? 9 : 3),
    "--surface-sunken": mix(panel, text, 4),
    "--hover": alpha(text, 5),
    "--active": alpha(text, 8),
    "--border": border,
    "--border-strong": borderStrong,
    "--text": text,
    "--text-2": mix(text, bg, 18),
    "--muted": mix(text, bg, 38),
    "--faint": mix(text, bg, 55),
    "--accent": accent,
    "--accent-soft": alpha(accent, 14),
    "--accent-text": accent,
    "--info": info,
    "--info-soft": alpha(info, 11),
    "--spark": accent,
    "--ok": ok,
    "--ok-soft": alpha(ok, 12),
    "--warn": warn,
    "--warn-soft": alpha(warn, 12),
    "--danger": danger,
    "--danger-soft": alpha(danger, 10),
    "--code-bg": theme.tokens.codeBg ?? mix(panel, text, 5),
  };
}

/** What a swatch shows: ground, panel and the one hue that says "this palette". */
export function themePreview(theme: Theme) {
  return { bg: theme.tokens.bg, panel: theme.tokens.panel, accent: theme.tokens.accent, text: theme.tokens.text };
}

/** A stable id from a name. Never contains path characters. */
export function slug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "theme";
}

const FUNCTION_COLOR = /^(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(([^()]*)\)$/i;
const PLAIN_COLOR = /^[a-z]{3,24}$/i;

/**
 * A CSS colour we are willing to put in a custom property. Accepts the forms
 * themes in the wild use (`#hex`, `rgb()`, `hsl()`, `oklch()`) and named
 * colours; rejects anything with `url(`, `var(`, quotes or statement breaks.
 */
export function isColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s || s.length > 96) return false;
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  if (s === "transparent") return true;
  if (PLAIN_COLOR.test(s)) return true;
  const m = s.match(FUNCTION_COLOR);
  return !!m && /^[0-9a-z%.,\s/+-]+$/i.test(m[2]);
}

/** Shape check for anything that claims to be a theme (persisted or imported). */
export function isTheme(value: unknown): value is Theme {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Theme>;
  if (typeof t.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(t.id)) return false;
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 80) return false;
  if (t.variant !== "light" && t.variant !== "dark") return false;
  const tokens = t.tokens as Partial<ThemeTokens> | undefined;
  if (!tokens || typeof tokens !== "object") return false;
  for (const key of ["bg", "panel", "text", "accent", "info", "ok", "danger"] as const) if (!isColor(tokens[key])) return false;
  for (const key of ["warn", "border", "codeBg"] as const) if (tokens[key] != null && !isColor(tokens[key])) return false;
  if (t.author != null && typeof t.author !== "string") return false;
  if (t.license != null && typeof t.license !== "string") return false;
  if (t.source != null && typeof t.source !== "string") return false;
  return true;
}

export function themeById(id: string, custom: Theme[] = []): Theme | undefined {
  return custom.find((t) => t.id === id) ?? BUILTIN_THEMES.find((t) => t.id === id);
}

/** The theme selected for a variant, with Otto's own as the fallback. */
export function selectedTheme(variant: ThemeVariant, lightId: string, darkId: string, custom: Theme[] = []): Theme {
  return themeById(variant === "light" ? lightId : darkId, custom) ?? themeById(`otto-${variant}`)!;
}
