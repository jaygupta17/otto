import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Placement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

/**
 * Anchored floating panel. Positions itself in a portal, flips when it
 * would overflow, closes on outside click / Escape.
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = "bottom-start",
  children,
  width,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  placement?: Placement;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = width ?? ref.current?.offsetWidth ?? 260;
      const h = ref.current?.offsetHeight ?? 300;
      let vertical = placement.startsWith("top") ? "top" : "bottom";
      if (vertical === "bottom" && r.bottom + h + 8 > vh && r.top > h + 8) vertical = "top";
      if (vertical === "top" && r.top - h - 8 < 0 && vh - r.bottom > h) vertical = "bottom";
      let left = placement.endsWith("end") ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      setPos(
        vertical === "bottom"
          ? { left, top: r.bottom + 6, origin: placement.endsWith("end") ? "top right" : "top left" }
          : { left, bottom: vh - r.top + 6, origin: placement.endsWith("end") ? "bottom right" : "bottom left" },
      );
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, placement, width]);

  // autoFocus doesn't fire while the panel is still visibility:hidden; focus once placed.
  useEffect(() => {
    if (open && pos) ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [open, pos]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    // Capture phase + stopPropagation: Escape closes only the top-most layer (not a sheet underneath).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.98, y: pos?.top !== undefined ? -2 : 2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className={`fixed z-50 overflow-hidden rounded-2xl border border-line bg-raised shadow-pop ${className}`}
          style={{ left: pos?.left ?? -9999, top: pos?.top, bottom: pos?.bottom, width, transformOrigin: pos?.origin, visibility: pos ? "visible" : "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  onClick,
  active,
  danger,
  right,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  right?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${active ? "bg-active" : ""} ${danger ? "text-danger" : "text-ink"}`}
    >
      {icon && <span className={`grid w-4 shrink-0 place-items-center ${danger ? "" : "text-muted"}`}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block truncate text-[12px] text-muted">{hint}</span>}
      </span>
      {right}
    </button>
  );
}
