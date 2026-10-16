import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "./Popover";

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  /** Plain text for type-to-find; defaults to `label` when it's a string. */
  text?: string;
  hint?: ReactNode;
  icon?: ReactNode;
}

/** Shared look for anything that opens a menu from a form field. */
export const fieldTrigger =
  "field flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px] outline-none disabled:opacity-50";

/**
 * Themed replacement for <select>: same field look as text inputs, a menu
 * from the shared popover, arrow keys / Enter / type-to-find.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  ariaLabel,
  width,
  className = "",
  maxHeight = 300,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  placeholder?: string;
  ariaLabel?: string;
  width?: number;
  className?: string;
  maxHeight?: number;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const typed = useRef({ s: "", t: 0 });
  const current = options.find((o) => o.value === value);
  const selectedIndex = useMemo(() => Math.max(0, options.findIndex((o) => o.value === value)), [options, value]);

  useEffect(() => {
    if (!open) return;
    setHi(selectedIndex);
    // Bring the selected row into view (long lists like times).
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-i="${selectedIndex}"]`)?.scrollIntoView({ block: "center" }));
  }, [open, selectedIndex]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    anchor.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(options.length - 1, h + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
    else if (e.key === "Home") (e.preventDefault(), setHi(0));
    else if (e.key === "End") (e.preventDefault(), setHi(options.length - 1));
    else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), pick(hi));
    else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : "") + e.key.toLowerCase(), t: now };
      const i = options.findIndex((o) => (o.text ?? (typeof o.label === "string" ? o.label : "")).toLowerCase().startsWith(typed.current.s));
      if (i >= 0) setHi(i);
    }
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        className={`${fieldTrigger} ${className}`}
      >
        {current?.icon && <span className="grid shrink-0 place-items-center text-muted">{current.icon}</span>}
        <span className={`min-w-0 flex-1 truncate ${current ? "text-ink" : "text-faint"}`}>{current?.label ?? placeholder}</span>
        <ChevronDown size={14} className={`shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} width={width ?? Math.max(180, anchor.current?.offsetWidth ?? 180)}>
        <div ref={list} role="listbox" className="scroll-quiet overflow-y-auto p-1" style={{ maxHeight: `min(${maxHeight}px, var(--pop-max, ${maxHeight}px))` }} onKeyDown={onKey}>
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                data-i={i}
                tabIndex={-1}
                onMouseMove={() => setHi(i)}
                onClick={() => pick(i)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-ink ${i === hi ? "bg-hover" : ""}`}
              >
                {o.icon && <span className="grid w-4 shrink-0 place-items-center text-muted">{o.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[12px] text-muted">{o.hint}</span>}
                </span>
                <Check size={14} className={`shrink-0 text-ink-2 ${on ? "" : "invisible"}`} />
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

/** "HH:MM" picker in 15-minute steps, labelled in the user's clock format. */
export function TimeSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const options = useMemo(() => {
    const fmt = (h: number, m: number) => new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const out: Option<string>[] = [];
    for (let h = 0; h < 24; h++)
      for (let m = 0; m < 60; m += 15) {
        const v = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        out.push({ value: v, label: fmt(h, m) });
      }
    if (!out.some((o) => o.value === value)) {
      const [h, m] = value.split(":").map(Number);
      out.push({ value, label: fmt(h, m) });
      out.sort((a, b) => a.value.localeCompare(b.value));
    }
    return out;
  }, [value]);
  return <Select value={value} onChange={onChange} options={options} ariaLabel="Time" className={className} maxHeight={260} />;
}
