import { describe, expect, test } from "bun:test";
import { BUILTIN_THEMES, THEME_VARS, isColor, isTheme, selectedTheme, slug, themeById, themePreview, themeVars, type Theme } from "./themes";

const latte = BUILTIN_THEMES.find((t) => t.id === "catppuccin-latte")!;
const mocha = BUILTIN_THEMES.find((t) => t.id === "catppuccin-mocha")!;
const ottoLight = BUILTIN_THEMES.find((t) => t.id === "otto-light")!;

describe("themeVars", () => {
  test("sets every token the stylesheet has", () => {
    const vars = themeVars(latte);
    expect(Object.keys(vars).sort()).toEqual([...THEME_VARS].sort());
    for (const value of Object.values(vars)) expect(value.trim()).not.toBe("");
  });

  test("light and dark derive differently", () => {
    const l = themeVars(latte);
    const d = themeVars(mocha);
    expect(l["--bg-deep"]).toContain("black 5%");
    expect(d["--bg-deep"]).toContain("black 25%");
    expect(l["--surface"]).toContain("4%");
    expect(d["--surface"]).toContain("6%");
    expect(l["--surface-sunken"]).toContain(latte.tokens.text);
    expect(d["--surface-sunken"]).toContain("black 10%");
    expect(l["--border"]).toBe(latte.tokens.border!);
    expect(d["--border"]).toBe(mocha.tokens.border!);
    expect(d["--border-strong"]).not.toBe(d["--border"]);
    expect(l["--text-2"]).not.toBe(l["--text"]);
    expect(l["--muted"]).not.toBe(l["--text-2"]);
    expect(l["--faint"]).not.toBe(l["--muted"]);
  });

  test("uses token overrides when given", () => {
    const theme: Theme = {
      ...latte,
      tokens: { ...latte.tokens, border: "#123456", codeBg: "#654321", warn: "#abcdef" },
    };
    const vars = themeVars(theme);
    expect(vars["--border"]).toBe("#123456");
    expect(vars["--border-strong"]).toContain("#123456");
    expect(vars["--code-bg"]).toBe("#654321");
    expect(vars["--warn"]).toBe("#abcdef");
  });

  test("warn follows the accent and code-bg the panel when not given", () => {
    const vars = themeVars({ ...latte, tokens: { ...latte.tokens, warn: undefined, codeBg: undefined } });
    expect(vars["--warn"]).toBe(latte.tokens.accent);
    expect(vars["--code-bg"]).toContain(latte.tokens.panel);
  });

  test("Otto's own themes override nothing", () => {
    expect(themeVars(ottoLight)).toEqual({});
    expect(themeVars(BUILTIN_THEMES.find((t) => t.id === "otto-dark")!)).toEqual({});
  });
});

describe("helpers", () => {
  test("themePreview shows ground, panel, accent and ink", () => {
    expect(themePreview(latte)).toEqual({ bg: "#eff1f5", panel: "#ffffff", accent: "#8839ef", text: "#4c4f69" });
    expect(themePreview(ottoLight).bg).toBe("#f2f2f1");
  });

  test("slug is url-safe and never keeps path characters", () => {
    expect(slug("My Theme!")).toBe("my-theme");
    expect(slug("  Catppuccin  Latte  ")).toBe("catppuccin-latte");
    expect(slug("../../etc/passwd")).toBe("etc-passwd");
    expect(slug("..\\..\\windows\\system32")).toBe("windows-system32");
    expect(slug("éàü")).toBe("eau");
    expect(slug("!!!")).toBe("theme");
    expect(slug("x".repeat(200)).length).toBeLessThanOrEqual(48);
    expect(slug("../../x")).not.toMatch(/[./\\]/);
  });

  test("isTheme accepts real themes and rejects broken or unsafe ones", () => {
    expect(isTheme(latte)).toBe(true);
    expect(isTheme(ottoLight)).toBe(true);
    expect(isTheme({ ...latte, variant: "sepia" })).toBe(false);
    expect(isTheme({ ...latte, id: "../escape" })).toBe(false);
    expect(isTheme({ ...latte, tokens: { ...latte.tokens, text: undefined } })).toBe(false);
    expect(isTheme({ ...latte, tokens: { ...latte.tokens, accent: "red; background: url(https://x)" } })).toBe(false);
    expect(isTheme({ ...latte, tokens: { ...latte.tokens, bg: "url(https://tracker)" } })).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  test("isColor passes modern colour forms", () => {
    for (const c of ["#fff", "#ffffffcc", "rgb(1 2 3)", "rgba(1,2,3,0.5)", "hsl(220 10% 50%)", "oklch(0.7 0.1 250)", "red", "transparent"]) {
      expect(isColor(c)).toBe(true);
    }
    for (const c of ["", "url(x)", "var(--x)", "red; background:black", "'red'", "rgb(1,2,3) /* x */"]) expect(isColor(c)).toBe(false);
  });

  test("themeById finds built-ins and imported themes", () => {
    expect(themeById("flexoki-dark")?.name).toBe("Flexoki Dark");
    const custom = { ...latte, id: "mine", name: "Mine", builtin: false };
    expect(themeById("mine", [custom])?.name).toBe("Mine");
    expect(themeById("nope")).toBeUndefined();
  });

  test("selectedTheme falls back to Otto's own", () => {
    expect(selectedTheme("light", "gone", "otto-dark").id).toBe("otto-light");
    expect(selectedTheme("dark", "otto-light", "gone").id).toBe("otto-dark");
    expect(selectedTheme("dark", "otto-light", "flexoki-dark").id).toBe("flexoki-dark");
  });
});
