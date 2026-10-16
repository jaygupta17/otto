/**
 * Stacked overlays (sheets, menus, popovers): Escape and Android back close
 * only the top-most one, focus moves into a layer when it opens and goes back
 * to whatever had it when the layer closes.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useBack } from "./back";

const stack: { close: () => void }[] = [];

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.isComposing || !stack.length) return;
  // Fields that use Escape themselves (cancel an inline edit) opt out.
  if ((e.target as HTMLElement | null)?.closest?.("[data-own-escape]")) return;
  e.preventDefault();
  e.stopPropagation();
  stack.at(-1)!.close();
}

/** Register a dismissible layer while `open`. The latest one closes first. */
export function useLayer(open: boolean, onClose: () => void) {
  const fn = useRef(onClose);
  fn.current = onClose;
  useBack(open, onClose);
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => fn.current() };
    if (!stack.length) window.addEventListener("keydown", onKey, true);
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
}

/** True while any sheet / menu is open (global shortcuts back off then). */
export const layerOpen = () => stack.length > 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[inert]") && (el.offsetParent !== null || el === document.activeElement),
  );
}

/**
 * Keep Tab inside `ref` while `active`, focus the first `[data-autofocus]`
 * (or first focusable, or the container) once it mounts, and restore focus
 * to the previously focused element on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, ready = true) {
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      // Only restore if focus is still inside us or nowhere (don't steal it from wherever the user went).
      const now = document.activeElement;
      if (prev?.isConnected && (!now || now === document.body || ref.current?.contains(now))) prev.focus({ preventScroll: true });
    };
  }, [active, ref]);

  useEffect(() => {
    if (!active || !ready) return;
    const root = ref.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) {
      // Never a text field unless asked: on a phone that pops the keyboard over the sheet.
      const first = root.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ?? focusables(root).find((el) => !el.matches("input, textarea, [contenteditable='true']")) ?? root;
      first.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables(root);
      if (!els.length) return e.preventDefault();
      const i = els.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? els.at(-1) : els[i - 1]) : i === -1 || i === els.length - 1 ? els[0] : els[i + 1];
      e.preventDefault();
      next?.focus();
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [active, ready, ref]);
}

/** ArrowUp/Down/Home/End between the items of a menu-like container. */
export function rovingKeys(e: React.KeyboardEvent<HTMLElement>, selector = '[role="menuitem"], [role="option"], button') {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const t = e.target as HTMLElement;
  // Leave arrows alone inside text fields (cursor movement).
  if (t.matches("input, textarea, [contenteditable='true']") && (e.key === "Home" || e.key === "End")) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
  );
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
  e.preventDefault();
  items[next].focus();
  items[next].scrollIntoView({ block: "nearest" });
}
