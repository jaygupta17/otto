import { describe, expect, test } from "bun:test";
import { MAX_THEME_BYTES, colorLuminance, parseThemeText, stripJsonc, uniqueThemeId } from "./themeImport";

const ottoJson = JSON.stringify({
  id: "sea",
  name: "Sea",
  variant: "dark",
  author: "Someone",
  license: "MIT",
  source: "https://example.com/sea",
  tokens: {
    bg: "#101820",
    panel: "#15222c",
    text: "#e6f1f5",
    accent: "#3fb6a8",
    info: "#5aa9e6",
    ok: "#7bd88f",
    danger: "#ff5c5c",
    border: "#21323e",
  },
});

const tweakcn = `
/* a tweakcn palette */
:root {
  --background: oklch(0.98 0.01 90);
  --card: oklch(1 0 0);
  --popover: oklch(0.99 0.01 90);
  --foreground: oklch(0.2 0.02 260);
  --primary: oklch(0.55 0.2 280);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.95 0.01 90);
  --muted: oklch(0.95 0.01 90);
  --muted-foreground: oklch(0.5 0.01 260);
  --destructive: oklch(0.6 0.22 25);
  --border: oklch(0.9 0.01 90);
  --input: oklch(0.9 0.01 90);
  --ring: oklch(0.55 0.2 280);
}

.dark {
  --background: rgb(20 20 28);
  --card: hsl(220 15% 12%);
  --popover: hsl(220 15% 13%);
  --foreground: hsl(220 20% 92%);
  --primary: hsl(265 80% 72%);
  --muted: hsl(220 12% 16%);
  --destructive: hsl(0 70% 60%);
  --border: hsl(220 12% 24%);
  --info: #5aa9e6;
  --success: #7bd88f;
}
`;

const vscodeDark = `// Night Owl
{
  "name": "Night Owl",
  "type": "dark",
  "colors": {
    "editor.background": "#011627",
    "editor.foreground": "#d6deeb",
    "sideBar.background": "#01111d",
    "activityBar.background": "#01111d",
    "button.background": "#7fdbca",
    "focusBorder": "#7fdbca",
    "errorForeground": "#ef5350",
    "terminal.ansiGreen": "#22da6e",
    "terminal.ansiBlue": "#82aaff",
    "terminal.ansiYellow": "#ffeb95",
    "editorWidget.background": "#01111d",
    "panel.border": "#1d3b53",
  },
}`;

const vscodeLight = JSON.stringify({
  name: "Paper",
  type: "light",
  colors: {
    "editor.background": "#fafafa",
    "editor.foreground": "#222222",
    "activityBar.background": "#eeeeee",
    "focusBorder": "#0055cc",
    "errorForeground": "#cc3333",
  },
});

const openChamber = JSON.stringify({
  metadata: { name: "Aurora", description: "A palette" },
  colors: {
    surface: { background: "#101014", elevated: "#18181f", foreground: "#e8e8ef" },
    primary: { base: "#ff7a59" },
    status: { success: "#3fbf7f", error: "#ff5f56", info: "#5aa9ff", warning: "#e6b450" },
    interactive: { border: "#2a2a33" },
  },
});

describe("Otto JSON", () => {
  test("reads tokens and metadata", () => {
    const [theme] = parseThemeText(ottoJson, "sea.json");
    expect(theme.name).toBe("Sea");
    expect(theme.variant).toBe("dark");
    expect(theme.id).toBe("sea");
    expect(theme.author).toBe("Someone");
    expect(theme.source).toBe("https://example.com/sea");
    expect(theme.tokens.border).toBe("#21323e");
    expect(theme.builtin).toBeUndefined();
  });

  test("ignores an unsafe id in the file and slugs the name", () => {
    const [theme] = parseThemeText(JSON.stringify({ id: "../../etc/passwd", name: "../../Evil Theme", variant: "light", tokens: JSON.parse(ottoJson).tokens }));
    expect(theme.id).toBe("evil-theme");
    expect(theme.id).not.toMatch(/[./\\]/);
  });

  test("never produces an id starting with otto", () => {
    const [theme] = parseThemeText(JSON.stringify({ name: "Otto But Mine", variant: "light", tokens: JSON.parse(ottoJson).tokens }));
    expect(theme.id).toBe("custom-otto-but-mine");
  });

  test("accepts JSONC comments and trailing commas, keeping URLs intact", () => {
    const [theme] = parseThemeText(`{ // theme\n "name": "Sea", "variant": "dark", "source": "https://example.com/a//b",\n "tokens": ${JSON.stringify(JSON.parse(ottoJson).tokens)},\n}`);
    expect(theme.source).toBe("https://example.com/a//b");
  });

  test("rejects a missing colour", () => {
    const tokens = { ...JSON.parse(ottoJson).tokens } as Record<string, string>;
    delete tokens.accent;
    expect(() => parseThemeText(JSON.stringify({ name: "Sea", variant: "dark", tokens }))).toThrow(/required colour/);
  });

  test("rejects malformed JSON and unknown shapes", () => {
    expect(() => parseThemeText('{"name": "Sea",')).toThrow(/valid JSON/);
    expect(() => parseThemeText('{"name": "Sea"}')).toThrow(/No theme found/);
    expect(() => parseThemeText("[]")).toThrow(/No theme found/);
  });
});

describe("tweakcn / shadcn CSS", () => {
  test("reads both blocks into Light and Dark themes", () => {
    const themes = parseThemeText(tweakcn, "sea.css");
    expect(themes.map((t) => [t.name, t.variant])).toEqual([
      ["Sea Light", "light"],
      ["Sea Dark", "dark"],
    ]);
    const [light, dark] = themes;
    expect(light.tokens.bg).toBe("oklch(0.98 0.01 90)");
    expect(light.tokens.panel).toBe("oklch(1 0 0)");
    expect(light.tokens.text).toBe("oklch(0.2 0.02 260)");
    expect(light.tokens.accent).toBe("oklch(0.55 0.2 280)");
    expect(light.tokens.danger).toBe("oklch(0.6 0.22 25)");
    expect(light.tokens.border).toBe("oklch(0.9 0.01 90)");
    expect(light.tokens.codeBg).toBe("oklch(0.95 0.01 90)");
    // No --info/--success in the light block: Otto's status colours stay.
    expect(light.tokens.info).toBe("#1d5fd6");
    expect(light.tokens.ok).toBe("#1f8a4c");
    expect(dark.tokens.bg).toBe("rgb(20 20 28)");
    expect(dark.tokens.panel).toBe("hsl(220 15% 12%)");
    expect(dark.tokens.info).toBe("#5aa9e6");
    expect(dark.tokens.ok).toBe("#7bd88f");
    expect(dark.tokens.danger).toBe("hsl(0 70% 60%)");
  });

  test("handles one variant on its own", () => {
    const [theme] = parseThemeText(":root { --background: #fff; --foreground: #111; --primary: #06c; }", "plain.css");
    expect(theme.name).toBe("Plain Light");
    expect(theme.variant).toBe("light");
  });

  test("rejects CSS without the core colours", () => {
    expect(() => parseThemeText(":root { --primary: #06c; }", "short.css")).toThrow(/No theme colours/);
    expect(() => parseThemeText("body { color: red }", "unknown.css")).toThrow(/No theme colours/);
  });

  test("converts bare HSL triplets", () => {
    const [theme] = parseThemeText(":root { --background: 220 14% 96%; --foreground: 220 20% 10%; --primary: 250 80% 60%; }", "old.css");
    expect(theme.tokens.bg).toBe("hsl(220 14% 96%)");
    expect(theme.tokens.text).toBe("hsl(220 20% 10%)");
  });
});

describe("VS Code themes", () => {
  test("maps a dark theme", () => {
    const [theme] = parseThemeText(vscodeDark, "night-owl.json");
    expect(theme.name).toBe("Night Owl");
    expect(theme.variant).toBe("dark");
    expect(theme.tokens.bg).toBe("#01111d");
    expect(theme.tokens.panel).toBe("#011627");
    expect(theme.tokens.text).toBe("#d6deeb");
    expect(theme.tokens.accent).toBe("#7fdbca");
    expect(theme.tokens.danger).toBe("#ef5350");
    expect(theme.tokens.ok).toBe("#22da6e");
    expect(theme.tokens.info).toBe("#82aaff");
    expect(theme.tokens.warn).toBe("#ffeb95");
    expect(theme.tokens.codeBg).toBe("#01111d");
    expect(theme.tokens.border).toBe("#1d3b53");
  });

  test("maps a light theme", () => {
    const [theme] = parseThemeText(vscodeLight, "paper.json");
    expect(theme.name).toBe("Paper");
    expect(theme.variant).toBe("light");
    expect(theme.tokens.bg).toBe("#eeeeee");
    expect(theme.tokens.panel).toBe("#fafafa");
    expect(theme.tokens.accent).toBe("#0055cc");
    // Not in the file: Otto's light status defaults.
    expect(theme.tokens.info).toBe("#1d5fd6");
    expect(theme.tokens.ok).toBe("#1f8a4c");
  });

  test("derives the variant from the background when type is absent", () => {
    const [dark] = parseThemeText(JSON.stringify({ name: "Ink", colors: { "editor.background": "#000000", "editor.foreground": "#ffffff" } }));
    expect(dark.variant).toBe("dark");
    const [light] = parseThemeText(JSON.stringify({ name: "Chalk", colors: { "editor.background": "#ffffff", "editor.foreground": "#111111" } }));
    expect(light.variant).toBe("light");
  });

  test("rejects a theme with no editor colours", () => {
    expect(() => parseThemeText(JSON.stringify({ name: "Short", colors: { "editor.background": "#000" } }))).toThrow(/editor.background or editor.foreground/);
  });
});

describe("OpenChamber themes", () => {
  test("maps surface, primary, status and border", () => {
    const [theme] = parseThemeText(openChamber, "aurora.json");
    expect(theme.name).toBe("Aurora");
    expect(theme.variant).toBe("dark");
    expect(theme.tokens.bg).toBe("#101014");
    expect(theme.tokens.panel).toBe("#18181f");
    expect(theme.tokens.text).toBe("#e8e8ef");
    expect(theme.tokens.accent).toBe("#ff7a59");
    expect(theme.tokens.ok).toBe("#3fbf7f");
    expect(theme.tokens.danger).toBe("#ff5f56");
    expect(theme.tokens.info).toBe("#5aa9ff");
    expect(theme.tokens.warn).toBe("#e6b450");
    expect(theme.tokens.border).toBe("#2a2a33");
  });

  test("derives a light variant from a light surface", () => {
    const [theme] = parseThemeText(
      JSON.stringify({
        metadata: { name: "Daylight" },
        colors: { surface: { background: "#f7f7f5", foreground: "#202020" }, primary: { base: "#3366cc" } },
      }),
    );
    expect(theme.variant).toBe("light");
  });
});

describe("limits and ids", () => {
  test("rejects files over 512 KiB", () => {
    expect(() => parseThemeText("x".repeat(MAX_THEME_BYTES + 1))).toThrow(/512 KB/);
  });

  test("collision suffixes go -2, -3", () => {
    const taken = new Set(["sea"]);
    expect(uniqueThemeId("sea", taken)).toBe("sea-2");
    taken.add("sea-2");
    expect(uniqueThemeId("Sea", taken)).toBe("sea-3");
    expect(uniqueThemeId("../Sea", new Set())).toBe("sea");
  });

  test("colour luminance reads the common forms", () => {
    expect(colorLuminance("#ffffff")).toBeCloseTo(1, 2);
    expect(colorLuminance("#000000")).toBe(0);
    expect(colorLuminance("rgb(255 255 255)")).toBeCloseTo(1, 2);
    expect(colorLuminance("oklch(0.7 0.1 250)")).toBeUndefined();
  });

  test("stripJsonc leaves strings alone", () => {
    expect(stripJsonc('{"u":"https://a//b","n":1,}')).toBe('{"u":"https://a//b","n":1}');
  });
});
