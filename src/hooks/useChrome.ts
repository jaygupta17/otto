import { useEffect, useState } from "react";
import { isMac, isTauri } from "../lib/platform";

/**
 * Whether macOS traffic lights overlay the top-left of the window.
 * False in a browser, on other OSes, and in macOS full screen (where the
 * buttons are hidden), so headers don't reserve empty space for them.
 */
export function useTrafficLights(): boolean {
  const [visible, setVisible] = useState(isTauri && isMac());
  useEffect(() => {
    if (!isTauri || !isMac()) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      const check = async () => alive && setVisible(!(await w.isFullscreen()));
      await check();
      unlisten = await w.onResized(() => void check());
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  return visible;
}
