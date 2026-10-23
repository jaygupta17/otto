import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "glass";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:opacity-88 active:opacity-80",
  secondary: "bg-raised text-ink border border-line hover:bg-hover active:bg-active",
  ghost: "text-ink-2 hover:bg-hover active:bg-active",
  danger: "bg-danger text-white hover:opacity-90",
  glass: "bg-raised border border-line text-ink hover:bg-hover",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  lg: "h-10 px-4 text-[14px] gap-2 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, trailing, className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background,opacity,color] duration-150 disabled:pointer-events-none disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: number; active?: boolean; /** Shortcut, shown dimmed in the tooltip. */ keys?: string }>(
  function IconButton({ label, size = 32, active, keys, className = "", children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        data-tip={label}
        data-tip-keys={keys}
        className={`inline-grid shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink active:bg-active disabled:opacity-40 ${active ? "bg-active text-ink" : ""} ${className}`}
        style={{ width: size, height: size }}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
