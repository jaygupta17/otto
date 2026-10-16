import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusables, rovingKeys, useLayer } from "../../lib/layers";

type Placement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

const GAP = 6;
const EDGE = 8;

/**
 * Anchored floating panel. Positions itself in a portal, flips to whichever
 * side has room, caps its height to the space it has (inner lists can use
 * `var(--pop-max)`), closes on outside click / Escape and hands focus back.
 * Menu items (`role="menuitem"`) get arrow-key / Home / End navigation.
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = "bottom-start",
  children,
  width,
  className = "",
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  placement?: Placement;
  children: ReactNode;
  width?: number;
  className?: string;
  /** Accessible name for the panel. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(open, onClose);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; max: number; w?: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width ?? ref.current?.offsetWidth ?? 260, vw - EDGE * 2);
      // Natural height = content height without our cap.
      const h = ref.current?.scrollHeight ?? 300;
      const below = vh - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      let vertical = placement.startsWith("top") ? "top" : "bottom";
      if (vertical === "bottom" && h > below && above > below) vertical = "top";
      else if (vertical === "top" && h > above && below > above) vertical = "bottom";
      const end = placement.endsWith("end");
      let left = end ? r.right - w : r.left;
      left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
      const max = Math.max(120, vertical === "bottom" ? below : above);
      const next =
        vertical === "bottom"
          ? { left, top: r.bottom + GAP, max, w: width ? w : undefined, origin: end ? "top right" : "top left" }
          : { left, bottom: vh - r.top + GAP, max, w: width ? w : undefined, origin: end ? "bottom right" : "bottom left" };
      setPos((p) =>
        p && p.left === next.left && p.top === next.top && p.bottom === next.bottom && p.max === next.max && p.w === next.w ? p : next,
      );
    };
    place();
    const raf = requestAnimationFrame(place);
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, placement, width]);

  // autoFocus doesn't fire while the panel is still visibility:hidden; focus once placed.
  // Opened from the keyboard with no explicit target: land on the first menu item.
  const placed = !!pos;
  useEffect(() => {
    if (!open || !placed || !ref.current) return;
    const auto = ref.current.querySelector<HTMLElement>("[data-autofocus]");
    if (auto) return auto.focus();
    if (anchor && document.activeElement === anchor && anchor.matches(":focus-visible")) {
      const items = [...ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      (items.find((el) => el.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    }
  }, [open, placed, anchor]);

  // Hand focus back to the trigger when we close with focus inside.
  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    return () => {
      const a = document.activeElement;
      if (anchor?.isConnected && (!a || a === document.body || panel?.contains(a))) anchor.focus({ preventScroll: true });
    };
  }, [open, anchor]);

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
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose, anchor]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest('[role="listbox"]')) rovingKeys(e, '[role="menuitem"]');
    // Tab out of a menu closes it (focus goes back to the trigger and moves on from there).
    if (e.key === "Tab" && ref.current && !focusables(ref.current).some((el) => el.matches("input, textarea"))) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="dialog"
          aria-label={label}
          initial={{ opacity: 0, scale: 0.98, y: pos?.top !== undefined ? -2 : 2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          onKeyDown={onKeyDown}
          className={`surface-overlay scroll-quiet fixed z-50 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-line bg-raised shadow-pop ${className}`}
          style={
            {
              left: pos?.left ?? -9999,
              top: pos?.top,
              bottom: pos?.bottom,
              width: pos?.w ?? width,
              maxHeight: pos?.max,
              "--pop-max": pos ? `${pos.max - 2}px` : "60vh",
              transformOrigin: pos?.origin,
              visibility: pos ? "visible" : "hidden",
            } as React.CSSProperties
          }
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
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors outline-none hover:bg-hover focus-visible:bg-hover ${active ? "bg-active" : ""} ${danger ? "text-danger" : "text-ink"}`}
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
