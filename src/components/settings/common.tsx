import { motion } from "motion/react";
import { Search } from "lucide-react";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { Effect } from "../../lib/permissions";
import { Hint } from "../ui/Tooltip";
import { EmptyState } from "../ui/EmptyState";

/**
 * Inside a settings page pushed on a phone. The page bar already names it, so
 * a tab's heading gives way to its description, and groups read like the
 * grouped list one level up: small uppercase labels flush with the cards under them.
 */
export const PhonePage = createContext(false);

/** A settings section. `page` makes it the page's heading (first section of a tab). */
export function Section({ title, desc, children, action, page }: { title: ReactNode; desc?: ReactNode; children: ReactNode; action?: ReactNode; page?: boolean }) {
  const phone = useContext(PhonePage);
  if (phone)
    return (
      <section className="mb-8 last:mb-0">
        {page ? (
          (desc || action) && (
            <div className="mb-6 flex items-start justify-between gap-3">
              <div className="min-w-0 text-[14px] leading-snug text-muted">{desc}</div>
              {action}
            </div>
          )
        ) : (
          <div className="mb-2 flex min-h-7 items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="text-[11px] font-medium tracking-[0.06em] text-accent-ink uppercase">{title}</h3>
                {typeof desc === "string" && <Hint>{desc}</Hint>}
              </div>
              {desc && typeof desc !== "string" && <div className="mt-0.5 text-[13px] text-muted">{desc}</div>}
            </div>
            {action}
          </div>
        )}
        {children}
      </section>
    );
  return (
    <section className="mb-9 last:mb-0">
      <div className={`${page ? "mb-5" : "mb-3"} flex min-h-8 items-end justify-between gap-3`}>
        {/* A plain-string description sits behind an ⓘ; anything richer (links, status) stays under the title. */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {page ? <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">{title}</h2> : <h3 className="text-[13px] font-semibold text-ink">{title}</h3>}
            {typeof desc === "string" && <Hint>{desc}</Hint>}
          </div>
          {desc && typeof desc !== "string" && <div className="mt-0.5 text-[12px] text-muted">{desc}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`group-card overflow-hidden ${className}`}>{children}</div>;
}

/** Grouped settings list: rows separated by hairlines inside one card. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="group-card divide-y divide-[var(--border)] overflow-hidden">{children}</div>;
}

/** Label on the left, control on the right. `hint` only when the label isn't self-explanatory; a string hint shows on hover of its ⓘ. */
export function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  const phone = useContext(PhonePage);
  return (
    <div className={`flex min-h-[52px] items-center justify-between px-4 py-2.5 ${phone ? "gap-4" : "gap-6"}`}>
      <label htmlFor={htmlFor} className="flex min-w-0 flex-col">
        <span className={`flex items-center gap-1.5 text-ink ${phone ? "text-[15px]" : "text-[13px]"}`}>
          {label}
          {typeof hint === "string" && <Hint>{hint}</Hint>}
        </span>
        {hint && typeof hint !== "string" && <span className="mt-0.5 block text-[12px] text-muted">{hint}</span>}
      </label>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * A labelled field inside a group card, as in iOS forms: a small label over a
 * borderless input (`formInput`), hairlines between rows. `aside` sits at the
 * label's end for a quiet note (an @handle, a count).
 */
export function FormRow({ label, hint, aside, error, htmlFor, children }: { label: ReactNode; hint?: string; aside?: ReactNode; error?: string | null; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="px-4 pt-2.5 pb-1.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <Hint>{hint}</Hint>}
        {aside && <span className="ml-auto min-w-0 truncate font-normal text-faint">{aside}</span>}
      </div>
      {children}
      {error && <div className="pb-1 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

/** The input inside a `FormRow`; 16px on phones so iOS doesn't zoom in on focus. */
export const formInput = "h-9 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-faint max-sm:text-[16px]";

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
      <span className="w-10 text-right text-[12px] text-muted font-mono tabular-nums">{format(value)}</span>
    </span>
  );
}

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="field flex h-9 items-center gap-2 rounded-lg px-3">
      <Search size={14} className="text-faint" />
      <input data-autofocus={autoFocus ? "" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
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
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 ${on ? "bg-accent" : "bg-line-strong"}`}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className={`absolute top-[3px] h-4 w-4 rounded-full shadow-soft bg-white`} style={{ left: on ? 19 : 3 }} />
    </button>
  );
}

/** `stretch` spans the width on phones, where a page's sections read as one control. */
export function Segmented<T extends string>({ options, value, onChange, size = "md", id, stretch }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md"; id: string; stretch?: boolean }) {
  return (
    <div className={`inline-flex gap-0.5 rounded-[11px] well p-[3px] ${stretch ? "max-sm:flex max-sm:w-full" : ""}`}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`relative rounded-lg font-medium transition-colors ${size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]"} ${stretch ? "max-sm:flex-1 max-sm:py-2 max-sm:text-[14px]" : ""} ${value === o.id ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          {value === o.id && <motion.span layoutId={`seg-${id}`} className="seg-pill absolute inset-0 rounded-lg shadow-soft" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const LABEL: Record<Effect, string> = { allow: "Allow", ask: "Ask", deny: "Block" };
const MEANS: Record<Effect, string> = { allow: "Goes ahead without asking", ask: "Stops and asks you first", deny: "Never allowed" };

/** Your own choice: filled in its colour. */
const EFFECT_STYLE: Record<Effect, string> = {
  allow: "bg-ok-soft text-ok",
  ask: "bg-warn-soft text-warn",
  deny: "bg-danger-soft text-danger",
};
/** Following the default: the same colour, on a plain pill, so it reads as "what happens" without looking chosen. */
const DEFAULT_STYLE: Record<Effect, string> = {
  allow: "seg-pill text-ok shadow-soft",
  ask: "seg-pill text-warn shadow-soft",
  deny: "seg-pill text-danger shadow-soft",
};

/**
 * Allow / Ask / Block, always showing what will actually happen. With
 * `allowInherit`, a row without its own choice shows the default's answer
 * marked "Default", and one with its own choice offers Reset. `noAsk` is for
 * tools that run inside the code tool, where OpenCode never stops to ask:
 * there "ask" behaves as allow, so it's shown as allow and not offered.
 */
export function EffectPicker({
  value,
  inherited,
  onChange,
  allowInherit = true,
  noAsk = false,
  marker = true,
}: {
  value: Effect | null;
  inherited?: Effect;
  onChange: (v: Effect | null) => void;
  allowInherit?: boolean;
  noAsk?: boolean;
  /** Show Default / Reset beside the picker (rows with room for it under their title pass false and use DefaultMark). */
  marker?: boolean;
}) {
  const effects: Effect[] = noAsk ? ["allow", "deny"] : ["allow", "ask", "deny"];
  let fallback: Effect = inherited ?? "ask";
  if (noAsk) {
    if (value === "ask") value = "allow";
    if (fallback === "ask") fallback = "allow";
  }
  const own = value !== null || !allowInherit;
  const shown = value ?? fallback;
  return (
    <div className="inline-flex shrink-0 items-center gap-2">
      <div className="inline-flex gap-0.5 rounded-[10px] well p-[3px]">
        {effects.map((o) => {
          const on = shown === o;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o)}
              title={MEANS[o]}
              className={`rounded-lg px-2 py-[3px] text-[12px] font-medium transition-colors ${on ? (own ? EFFECT_STYLE[o] : DEFAULT_STYLE[o]) : "text-muted hover:text-ink"}`}
            >
              {LABEL[o]}
            </button>
          );
        })}
      </div>
      {allowInherit && marker && (
        <span className="w-[46px] text-[12px]">
          <DefaultMark own={own} fallback={fallback} onReset={() => onChange(null)} />
        </span>
      )}
    </div>
  );
}

/** "Default" when nothing is set here, else Reset back to it. */
export function DefaultMark({ own, fallback, onReset, verbose }: { own: boolean; fallback: Effect; onReset: () => void; verbose?: boolean }) {
  return own ? (
    <span className="inline-flex items-center gap-1.5">
      {verbose && <span className="text-ink-2">Changed</span>}
      {verbose && <span className="text-faint">·</span>}
      <button type="button" onClick={onReset} title={`Back to the default: ${LABEL[fallback].toLowerCase()}`} className="text-muted underline-offset-2 hover:text-ink hover:underline">
      Reset
      </button>
    </span>
  ) : (
    <span className="text-faint" title="Nothing set here, so the default applies">
      Default
    </span>
  );
}

/** Nothing here yet, flat on the page (see `EmptyState`). */
export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return <EmptyState small mark={icon} title={title} body={body} action={action} />;
}

export function TextArea({ value, onChange, placeholder, rows = 6, mono = false }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      spellCheck={!mono}
      className={`field scroll-quiet w-full resize-y rounded-lg px-3 py-2 text-[14px] leading-relaxed outline-none placeholder:text-faint ${mono ? "font-mono text-[12px]" : ""}`}
    />
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{children}</span>
      {/* A word or two ("optional") reads inline; a sentence moves behind an ⓘ. */}
      {typeof hint === "string" && hint.length > 28 ? <Hint>{hint}</Hint> : hint && <span className="ml-0.5 text-[12px] text-faint">{hint}</span>}
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

