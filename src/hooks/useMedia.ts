import { useSyncExternalStore } from "react";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-sized layout (also true for narrow desktop windows). */
export const useCompact = () => useMedia("(max-width: 760px)");

/** A finger, not a mouse: full-screen pages beat popovers here. */
export const useTouch = () => useMedia("(pointer: coarse)");

/** The system's "reduce motion" setting: the floor for the app's own Reduce motion. */
export const useOsReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");
