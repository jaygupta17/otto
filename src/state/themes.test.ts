import { describe, expect, test } from "bun:test";
import { useThemes, MAX_CUSTOM_THEMES } from "./themes";
import { BUILTIN_THEMES, type Theme } from "../lib/themes";

const imported = (id: string, variant: "light" | "dark", name = id): Theme => ({
  id,
  name,
  variant,
  tokens: {
    bg: variant === "dark" ? "#111111" : "#ffffff",
    panel: variant === "dark" ? "#1a1a1a" : "#fafafa",
    text: variant === "dark" ? "#eeeeee" : "#111111",
    accent: "#3366cc",
    info: "#1d5fd6",
    ok: "#1f8a4c",
    danger: "#c93a32",
  },
});

describe("useThemes.remove", () => {
  test("falls back to Otto's own theme when the selected custom one is removed", () => {
    const light = imported("mine-light", "light");
    const dark = imported("mine-dark", "dark");
    useThemes.setState({ custom: [light, dark], lightId: light.id, darkId: dark.id });
    useThemes.getState().remove(light.id);
    expect(useThemes.getState().lightId).toBe("otto-light");
    expect(useThemes.getState().darkId).toBe("mine-dark");
    expect(useThemes.getState().custom.map((t) => t.id)).toEqual(["mine-dark"]);
    useThemes.getState().remove(dark.id);
    expect(useThemes.getState().darkId).toBe("otto-dark");
    expect(useThemes.getState().custom).toEqual([]);
  });

  test("does nothing for a built-in or unknown id", () => {
    const builtin = BUILTIN_THEMES[0];
    useThemes.setState({ custom: [], lightId: builtin.id, darkId: "otto-dark" });
    useThemes.getState().remove(builtin.id);
    expect(useThemes.getState().lightId).toBe(builtin.id);
  });
});

describe("useThemes.importFiles", () => {
  test("imports, selects the current variant and suffixes a colliding id", async () => {
    useThemes.setState({ custom: [imported("sea-light", "light", "Sea")], lightId: "otto-light", darkId: "otto-dark", loaded: true });
    const css = `:root { --background: #fff; --foreground: #111; --primary: #06c; }
.dark { --background: #000; --foreground: #eee; --primary: #6cf; }`;
    const { imported: added, errors } = await useThemes.getState().importFiles([new File([css], "sea.css", { type: "text/css" })]);
    expect(errors).toEqual([]);
    expect(added).toHaveLength(2);
    expect(added[0].name).toBe("Sea Light");
    expect(added[0].id).toBe("sea-light-2");
    expect(added[1].id).toBe("sea-dark");
    expect(useThemes.getState().custom.map((t) => t.id)).toEqual(["sea-light", "sea-light-2", "sea-dark"]);
    // The light slot is active, so the first light theme wins.
    expect(useThemes.getState().lightId).toBe("sea-light-2");
  });

  test("reports a bad file and imports nothing", async () => {
    useThemes.setState({ custom: [], lightId: "otto-light", darkId: "otto-dark", loaded: true });
    const { imported: added, errors } = await useThemes.getState().importFiles([new File(["not a theme"], "bad.json", { type: "application/json" })]);
    expect(added).toEqual([]);
    expect(errors[0]).toContain("bad.json");
    expect(errors[0]).toMatch(/valid JSON/);
    expect(useThemes.getState().custom).toEqual([]);
  });

  test("caps the library at 20 imported themes", async () => {
    const custom = Array.from({ length: MAX_CUSTOM_THEMES - 1 }, (_, i) => imported(`t${i}`, "light"));
    useThemes.setState({ custom, lightId: "otto-light", darkId: "otto-dark", loaded: true });
    const css = `:root { --background: #fff; --foreground: #111; --primary: #06c; }
.dark { --background: #000; --foreground: #eee; --primary: #6cf; }`;
    const { imported: added, errors } = await useThemes.getState().importFiles([new File([css], "more.css")]);
    expect(added).toHaveLength(1);
    expect(errors[0]).toContain("20");
    expect(useThemes.getState().custom).toHaveLength(MAX_CUSTOM_THEMES);
  });

  test("rejects a file over 512 KiB before reading it", async () => {
    useThemes.setState({ custom: [], lightId: "otto-light", darkId: "otto-dark", loaded: true });
    const big = new File(["x"], "big.json", { type: "application/json" });
    Object.defineProperty(big, "size", { value: 600 * 1024 });
    const { imported: added, errors } = await useThemes.getState().importFiles([big]);
    expect(added).toEqual([]);
    expect(errors[0]).toContain("512 KB");
  });
});
