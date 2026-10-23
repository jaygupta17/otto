/**
 * The user's theme choices: one palette per light/dark slot, plus themes they
 * imported on this machine. Stored in kv — never on the server.
 */
import { create } from "zustand";
import { kv } from "../lib/kv";
import { useUI } from "./ui";
import { BUILTIN_THEMES, isOttoTheme, isTheme, selectedTheme, themeVars, type Theme, type ThemeVariant } from "../lib/themes";
import { MAX_THEME_BYTES, parseThemeText, uniqueThemeId } from "../lib/themeImport";

const KEY = "ui.themes.v1";
/** Imported themes kept at once. */
export const MAX_CUSTOM_THEMES = 20;

interface Persisted {
  lightId?: string;
  darkId?: string;
  custom?: Theme[];
}

interface ThemesState {
  lightId: string;
  darkId: string;
  custom: Theme[];
  loaded: boolean;
  load(): Promise<void>;
  select(variant: ThemeVariant, id: string): void;
  importFiles(files: File[]): Promise<{ imported: Theme[]; errors: string[] }>;
  remove(id: string): void;
  apply(): void;
}

/** Custom properties currently set on <html>, so they can be cleared. */
let applied: string[] = [];

function persist(lightId: string, darkId: string, custom: Theme[]) {
  void kv.set(KEY, { lightId, darkId, custom }).catch(() => {
    // A full disk mustn't break the picker; the choice lasts for this run.
  });
}

export const useThemes = create<ThemesState>((set, get) => ({
  lightId: "otto-light",
  darkId: "otto-dark",
  custom: [],
  loaded: false,

  async load() {
    try {
      const saved = await kv.get<Persisted>(KEY);
      if (saved && typeof saved === "object") {
        const custom = Array.isArray(saved.custom) ? saved.custom.filter(isTheme).slice(0, MAX_CUSTOM_THEMES) : [];
        set({
          lightId: typeof saved.lightId === "string" ? saved.lightId : "otto-light",
          darkId: typeof saved.darkId === "string" ? saved.darkId : "otto-dark",
          custom,
        });
      }
    } catch {
      // First run (or unreadable store): Otto's own themes.
    }
    set({ loaded: true });
    get().apply();
  },

  select(variant, id) {
    set(variant === "light" ? { lightId: id } : { darkId: id });
    const s = get();
    persist(s.lightId, s.darkId, s.custom);
    if (useUI.getState().resolvedTheme === variant) s.apply();
  },

  async importFiles(files) {
    const imported: Theme[] = [];
    const errors: string[] = [];
    let custom = [...get().custom];
    const taken = new Set([...BUILTIN_THEMES.map((t) => t.id), ...custom.map((t) => t.id)]);

    for (const file of files) {
      if (file.size > MAX_THEME_BYTES) {
        errors.push(`${file.name} is larger than 512 KB`);
        continue;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        errors.push(`${file.name} couldn't be read`);
        continue;
      }
      let parsed: Theme[];
      try {
        parsed = parseThemeText(text, file.name);
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`);
        continue;
      }
      for (const theme of parsed) {
        if (custom.length >= MAX_CUSTOM_THEMES) {
          errors.push(`You can keep ${MAX_CUSTOM_THEMES} imported themes`);
          break;
        }
        const id = uniqueThemeId(theme.id, taken);
        taken.add(id);
        const copy = { ...theme, id };
        custom.push(copy);
        imported.push(copy);
      }
    }

    if (imported.length) {
      set({ custom });
      const s = get();
      persist(s.lightId, s.darkId, s.custom);
      const variant = useUI.getState().resolvedTheme;
      const first = imported.find((t) => t.variant === variant);
      if (first) s.select(variant, first.id);
    }
    return { imported, errors };
  },

  remove(id) {
    if (!get().custom.some((t) => t.id === id)) return;
    const custom = get().custom.filter((t) => t.id !== id);
    const lightId = get().lightId === id ? "otto-light" : get().lightId;
    const darkId = get().darkId === id ? "otto-dark" : get().darkId;
    set({ custom, lightId, darkId });
    const s = get();
    persist(s.lightId, s.darkId, s.custom);
    s.apply();
  },

  apply() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    for (const name of applied) root.style.removeProperty(name);
    applied = [];
    const { resolvedTheme } = useUI.getState();
    const { lightId, darkId, custom } = get();
    const theme = selectedTheme(resolvedTheme, lightId, darkId, custom);
    // Otto's own palettes are already in the stylesheet: leave every token alone.
    if (isOttoTheme(theme)) return;
    const vars = themeVars(theme);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    applied = Object.keys(vars);
  },
}));

// Switching light/dark swaps which palette is in effect.
useUI.subscribe((s, prev) => {
  if (s.resolvedTheme !== prev.resolvedTheme) useThemes.getState().apply();
});
