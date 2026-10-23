import { Check, ChevronDown, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../ui/Popover";
import { Row } from "./common";
import { useUI, toast } from "../../state/ui";
import { useThemes } from "../../state/themes";
import { BUILTIN_THEMES, themeById, themePreview, type Theme, type ThemeVariant } from "../../lib/themes";

/** Picks the palette for each mode: two rows in system mode, one otherwise. */
export function ThemePicker() {
  const mode = useUI((s) => s.theme);
  if (mode === "system") {
    return (
      <>
        <ThemeRow variant="light" label="Light theme" />
        <ThemeRow variant="dark" label="Dark theme" />
      </>
    );
  }
  return <ThemeRow variant={mode} label="Theme" />;
}

function ThemeRow({ variant, label }: { variant: ThemeVariant; label: string }) {
  const lightId = useThemes((s) => s.lightId);
  const darkId = useThemes((s) => s.darkId);
  const custom = useThemes((s) => s.custom);
  const id = variant === "light" ? lightId : darkId;
  const theme = themeById(id, custom) ?? themeById(`otto-${variant}`)!;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const meta = [theme.name, theme.author, theme.license].filter(Boolean).join(" · ");

  const themes = [...BUILTIN_THEMES, ...custom].filter((t) => t.variant === variant);
  const groups = [
    { label: "Otto", themes: themes.filter((t) => t.builtin && t.id.startsWith("otto")) },
    { label: "Built-in", themes: themes.filter((t) => t.builtin && !t.id.startsWith("otto")) },
    { label: "Yours", themes: themes.filter((t) => !t.builtin) },
  ].filter((g) => g.themes.length > 0);

  async function onFiles(list: File[]) {
    if (!list.length) return;
    setBusy(true);
    const { imported, errors } = await useThemes.getState().importFiles(list);
    setBusy(false);
    if (imported.length) {
      toast({
        tone: "ok",
        title: `Imported ${imported.length} theme${imported.length === 1 ? "" : "s"}`,
        body: errors[0],
      });
    } else {
      toast({ tone: "error", title: errors[0] ?? "Couldn't import that file" });
    }
  }

  return (
    <>
      <Row label={label}>
        <button
          ref={anchor}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${theme.name}`}
          title={meta}
          onClick={() => setOpen((v) => !v)}
          className="field flex h-8 w-[220px] items-center gap-2 rounded-lg pr-2 pl-1.5 text-left outline-none"
        >
          <Swatch theme={theme} width={30} height={18} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{theme.name}</span>
          <ChevronDown size={14} className={`shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </button>
      </Row>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} width={264} label={`${label} theme`}>
        <div className="p-1.5">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2 pt-1.5 pb-1 text-[12px] text-muted">{g.label}</div>
              {g.themes.map((t) => (
                <ThemeItem
                  key={t.id}
                  theme={t}
                  selected={t.id === theme.id}
                  onSelect={() => {
                    useThemes.getState().select(variant, t.id);
                    setOpen(false);
                    anchor.current?.focus();
                  }}
                  onRemove={
                    t.builtin
                      ? undefined
                      : () => {
                          useThemes.getState().remove(t.id);
                        }
                  }
                />
              ))}
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => file.current?.click()}
            className="mt-1 flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            <Upload size={14} className="shrink-0" />
            Import theme…
          </button>
          <input
            ref={file}
            type="file"
            multiple
            accept=".json,.jsonc,.css,application/json,text/css"
            className="hidden"
            onChange={(e) => {
              // Read before clearing: FileList is live and empties with the input.
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void onFiles(files);
            }}
          />
        </div>
      </Popover>
    </>
  );
}

function ThemeItem({ theme, selected, onSelect, onRemove }: { theme: Theme; selected: boolean; onSelect: () => void; onRemove?: () => void }) {
  return (
    <div className="group flex h-9 items-center rounded-md transition-colors hover:bg-hover focus-within:bg-hover">
      <button
        type="button"
        role="menuitem"
        aria-checked={selected}
        onClick={onSelect}
        className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left outline-none"
      >
        <Swatch theme={theme} width={36} height={22} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${selected ? "text-ink" : "text-ink-2"}`}>{theme.name}</span>
        {selected && <Check size={14} className="shrink-0 text-ink" />}
      </button>
      {onRemove && (
        <button
          type="button"
          title="Remove theme"
          aria-label={`Remove ${theme.name}`}
          onClick={onRemove}
          className="mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-active hover:text-ink focus-visible:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function Swatch({ theme, width, height }: { theme: Theme; width: number; height: number }) {
  const p = themePreview(theme);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 overflow-hidden rounded-[5px] shadow-[0_0_0_1px_rgba(128,128,128,0.32)]"
      style={{ width, height }}
    >
      <span style={{ width: "38%", background: p.bg }} />
      <span style={{ width: "34%", background: p.panel }} />
      <span style={{ width: "28%", background: p.accent }} />
    </span>
  );
}
