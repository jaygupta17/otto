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
