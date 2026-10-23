/**
 * One styled tooltip for the whole app. Anything with `data-tip` gets it on
 * hover or keyboard focus; a native `title` is moved to `data-tip` the first
 * time it's pointed at, so the browser's own slow, unstyled tooltip never
 * shows. `data-tip-side` picks a side (default top), `data-tip-keys` adds a
 * shortcut. Elements marked `data-tip-tap` (like Hint) also show it on tap,
 * which is how phones read them.
 */
import { Info } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "left" | "right";
interface Tip {
  el: HTMLElement;
  text: string;
  keys?: string;
  side: Side;
}

const DELAY = 450;
/** Moving between tooltipped controls inside this window shows the next one at once, as on macOS. */
const WARM = 400;
const GAP = 6;
const EDGE = 8;

function target(node: EventTarget | null): HTMLElement | null {
  const el = node instanceof Element ? node.closest<HTMLElement>("[data-tip],[title]") : null;
  if (!el || el.tagName === "IFRAME" || el.closest("[data-tip-off]")) return null;
  const title = el.getAttribute("title");
  if (title !== null) {
    // Keep the accessible name the title gave an icon-only control.
    if (title && !el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
    el.removeAttribute("title");
    if (title) el.dataset.tip = title;
  }
  return el.dataset.tip ? el : null;
}

function read(el: HTMLElement): Tip {
  return { el, text: el.dataset.tip!, keys: el.dataset.tipKeys, side: (el.dataset.tipSide as Side) || "top" };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number>(0);
  const lastHide = useRef(0);
  const shown = useRef<Tip | null>(null);
  shown.current = tip;

  useEffect(() => {
    const hover = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const clear = () => window.clearTimeout(timer.current);
    const hide = () => {
      clear();
      if (shown.current) lastHide.current = Date.now();
      setTip(null);
    };
    const show = (el: HTMLElement, wait: number) => {
      clear();
      if (shown.current?.el === el) return;
      const warm = Date.now() - lastHide.current < WARM || !!shown.current;
      timer.current = window.setTimeout(() => el.isConnected && setTip(read(el)), warm ? 0 : wait);
    };

    const over = (e: PointerEvent) => {
      if (!hover || e.pointerType !== "mouse") return;
      const el = target(e.target);
      if (el) show(el, DELAY);
      else if (shown.current || timer.current) hide();
    };
    const out = (e: PointerEvent) => {
      const el = target(e.target);
      if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = target(e.target);
      if (el && (e.target as Element).matches(":focus-visible")) show(el, 0);
    };
    const down = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tip-tap]") : null;
      if (el?.dataset.tip) {
        // A second tap on the same hint closes it; a click with the mouse leaves it up.
        if (shown.current?.el === el) {
          if (e.pointerType !== "mouse") hide();
        }
        else {
          clear();
          setTip(read(el));
        }
        return;
      }
      hide();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();

    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("wheel", hide, { passive: true, capture: true });
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      clear();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // A control that unmounts or loses its tip takes the tooltip with it.
  useEffect(() => {
    if (!tip) return;
    const id = window.setInterval(() => !tip.el.isConnected && setTip(null), 250);
    return () => window.clearInterval(id);
  }, [tip]);

  return tip ? createPortal(<Bubble tip={tip} />, document.body) : null;
}

function Bubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const r = tip.el.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = tip.side;
    if (side === "top" && r.top - h - GAP < EDGE) side = "bottom";
    else if (side === "bottom" && r.bottom + h + GAP > vh - EDGE) side = "top";
    else if (side === "left" && r.left - w - GAP < EDGE) side = "right";
    else if (side === "right" && r.right + w + GAP > vw - EDGE) side = "left";
    let x = side === "left" ? r.left - w - GAP : side === "right" ? r.right + GAP : r.left + r.width / 2 - w / 2;
    let y = side === "top" ? r.top - h - GAP : side === "bottom" ? r.bottom + GAP : r.top + r.height / 2 - h / 2;
    x = Math.min(Math.max(EDGE, x), vw - w - EDGE);
    y = Math.min(Math.max(EDGE, y), vh - h - EDGE);
    setPos({ x, y });
  }, [tip]);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="tip pointer-events-none fixed top-0 left-0 z-[1000] max-w-[260px] rounded-[7px] px-2 py-[5px] text-[12px] leading-[1.35] font-medium"
      style={{ transform: pos ? `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)` : undefined, visibility: pos ? "visible" : "hidden" }}
    >
      {tip.text}
      {tip.keys && <span className="ml-1.5 opacity-55">{tip.keys}</span>}
    </div>
  );
}

/**
 * A quiet ⓘ beside a label for the explanation that used to sit under it.
 * Hover, focus or tap shows it; screen readers get it as the button's name.
 */
export function Hint({ children, className = "" }: { children: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={children}
      data-tip={children}
      data-tip-tap
      onClick={(e) => e.preventDefault()}
      className={`inline-grid h-4 w-4 shrink-0 place-items-center rounded-full align-middle text-faint transition-colors outline-none hover:text-ink-2 focus-visible:text-ink ${className}`}
    >
      <Info size={13} />
    </button>
  );
}
