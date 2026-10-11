import { motion } from "motion/react";
import { Search } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Effect } from "../../lib/permissions";

/** A settings section. `page` makes it the page's heading (first section of a tab). */
export function Section({ title, desc, children, action, page }: { title: ReactNode; desc?: ReactNode; children: ReactNode; action?: ReactNode; page?: boolean }) {
  return (
    <section className="mb-9 last:mb-0">
      <div className={`${page ? "mb-5" : "mb-3"} flex min-h-8 items-end justify-between gap-3`}>
        <div className="min-w-0">
          {page ? <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</h2> : <h3 className="text-[14px] font-semibold text-ink">{title}</h3>}
          {desc && <p className="mt-0.5 text-[13px] text-muted">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-2xl bg-raised hairline ${className}`}>{children}</div>;
}

/** Grouped settings list: rows separated by hairlines inside one card. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl bg-raised hairline">{children}</div>;
}

/** Label on the left, control on the right. `hint` only when the label isn't self-explanatory. */
export function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-6 px-4 py-2.5">
      <label htmlFor={htmlFor} className="min-w-0">
        <span className="block text-[13.5px] text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] text-muted">{hint}</span>}
      </label>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Themed range input with its value beside it. */
export function Slider({ value, min, max, step = 0.01, format, onChange, label }: { value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void; label: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <span className="flex w-[240px] items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider min-w-0 flex-1"
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />
      <span className="w-10 text-right text-[12.5px] text-muted tabular-nums">{format(value)}</span>
    </span>
  );
}

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="field flex h-9 items-center gap-2 rounded-lg px-3">
      <Search size={14} className="text-faint" />
      <input data-autofocus={autoFocus ? "" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 ${on ? "bg-ink" : "bg-line-strong"}`}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className={`absolute top-[3px] h-4 w-4 rounded-full shadow-soft ${on ? "bg-bg" : "bg-white"}`} style={{ left: on ? 19 : 3 }} />
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange, size = "md", id }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md"; id: string }) {
  return (
    <div className="inline-flex gap-0.5 rounded-xl bg-sunken p-0.5 hairline">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`relative rounded-lg font-medium transition-colors ${size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]"} ${value === o.id ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          {value === o.id && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-raised shadow-soft" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const DOT: Record<Effect, string> = { allow: "bg-ok", ask: "bg-warn", deny: "bg-danger" };

const EFFECT_STYLE: Record<Effect, string> = {
  allow: "bg-ok-soft text-ok",
  ask: "bg-warn-soft text-warn",
  deny: "bg-danger-soft text-danger",
};

/**
 * Inherit / Allow / Ask / Deny. When inheriting, the effective value is shown
 * faintly so people see what will actually happen.
 */
export function EffectPicker({ value, inherited, onChange, allowInherit = true }: { value: Effect | null; inherited?: Effect; onChange: (v: Effect | null) => void; allowInherit?: boolean }) {
  const opts: (Effect | null)[] = allowInherit ? [null, "allow", "ask", "deny"] : ["allow", "ask", "deny"];
  return (
    <div className="inline-flex shrink-0 gap-0.5 rounded-lg bg-sunken p-0.5 hairline">
      {opts.map((o) => {
        const active = value === o;
        return (
          <button
            key={String(o)}
            type="button"
            onClick={() => onChange(o)}
            title={o === null ? `Automatic. Currently “${inherited ?? "ask"}” from the defaults.` : o}
            className={`rounded-lg px-2 py-[3px] text-[12px] font-medium capitalize transition-colors ${active ? (o ? EFFECT_STYLE[o] : "bg-raised text-ink shadow-soft") : "text-muted hover:text-ink"}`}
          >
            {o === null ? (
              <span className="inline-flex items-center gap-1">
                Auto
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[inherited ?? "ask"]}`} />
              </span>
            ) : (
              o
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line px-5 py-6">
      <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
        <span className="text-muted">{icon}</span>
        {title}
      </div>
      {body && <div className="mt-1 max-w-[440px] text-[14px] text-muted">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 6, mono = false }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      spellCheck={!mono}
      className={`field scroll-quiet w-full resize-y rounded-lg px-3 py-2 text-[14px] leading-relaxed outline-none placeholder:text-faint ${mono ? "font-mono text-[12.5px]" : ""}`}
    />
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <span className="text-[12.5px] font-medium text-ink-2">{children}</span>
      {hint && <span className="ml-2 text-[12px] text-faint">{hint}</span>}
    </div>
  );
}

/** Calls `onVisible` whenever the sentinel scrolls into view (infinite lists). */
export function LoadMore({ onVisible, active }: { onVisible: () => void; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && cb.current(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  return <div ref={ref} className="h-1" />;
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" | "muted" }) {
  const c = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "danger" ? "bg-danger" : "bg-line-strong";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}
