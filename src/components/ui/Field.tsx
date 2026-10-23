import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Hint } from "./Tooltip";

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null; trailing?: ReactNode }>(
  function TextField({ label, hint, error, trailing, className = "", ...rest }, ref) {
    return (
      <label className="block">
        {/* A plain-string hint moves behind an ⓘ beside the label; errors always show. */}
        {label && (
          <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
            {label}
            {typeof hint === "string" && <Hint>{hint}</Hint>}
          </span>
        )}
        <span
          aria-invalid={error ? true : undefined}
          className="field flex h-9 items-center gap-2 rounded-lg px-3"
        >
          <input ref={ref} className={`min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none disabled:text-muted placeholder:text-faint ${className}`} {...rest} />
          {trailing}
        </span>
        {error ? <span className="mt-1.5 block text-[12px] text-danger">{error}</span> : hint && !(label && typeof hint === "string") ? <span className="mt-1.5 block text-[12px] text-muted">{hint}</span> : null}
      </label>
    );
  },
);
