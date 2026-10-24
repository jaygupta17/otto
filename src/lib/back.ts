/**
 * Android's back button/gesture, one step at a time.
 *
 * Anything that can be dismissed (a sheet, a menu, a pushed screen) registers
 * while it's open; back closes the most recent one. With nothing open the
 * listener is removed, so back does what Android normally does at the root
 * (leave the app).
 */
import { useEffect, useRef } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";

type PluginListener = Awaited<ReturnType<typeof onBackButtonPress>>;
import { isTauri, osName } from "./platform";

const stack: { run: () => void }[] = [];
let listener: Promise<PluginListener | null> | null = null;

function sync() {
  if (!isTauri || osName() !== "android") return;
  if (stack.length && !listener) {
    listener = onBackButtonPress(() => stack.at(-1)?.run()).catch(() => null);
  } else if (!stack.length && listener) {
    const l = listener;
    listener = null;
    void l.then((x) => x?.unregister());
  }
}

/** Close this on back while `active`. The latest registered closes first. */
export function useBack(active: boolean, onBack: () => void) {
  const fn = useRef(onBack);
  fn.current = onBack;
  useEffect(() => {
    if (!active) return;
    const entry = { run: () => fn.current() };
    stack.push(entry);
    sync();
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      sync();
    };
  }, [active]);
}

/**
 * Full-screen viewers also take a history entry while open, so whatever goes
 * "back" (Android's gesture once nothing is listening, a mouse's back button,
 * the browser's) closes the viewer instead of leaving the app. Closing it any
 * other way takes the entry back off.
 */
const entries: { mark: number; close: () => void }[] = [];
let marks = 0;
let ownPops = 0;
let listening = false;

function onPop(e: PopStateEvent) {
  if (ownPops > 0) {
    ownPops--;
    return;
  }
  const at = (e.state as { ottoLayer?: number } | null)?.ottoLayer ?? 0;
  // Everything opened after where history now stands closes, newest first.
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].mark > at) entries[i].close();
}

export function useHistoryEntry(active: boolean, onBack: () => void) {
  const fn = useRef(onBack);
  fn.current = onBack;
  useEffect(() => {
    if (!active || typeof history === "undefined") return;
    const mark = ++marks;
    const entry = { mark, close: () => fn.current() };
    if (!listening) window.addEventListener("popstate", onPop);
    listening = true;
    history.pushState({ ...(history.state as object | null), ottoLayer: mark }, "");
    entries.push(entry);
    return () => {
      entries.splice(entries.indexOf(entry), 1);
      // Closed from inside (×, Esc, a swipe): its entry is still on top, so take it off.
      if ((history.state as { ottoLayer?: number } | null)?.ottoLayer === mark) {
        ownPops++;
        history.back();
      }
    };
  }, [active]);
}
