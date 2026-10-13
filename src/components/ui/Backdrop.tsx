import { memo, useSyncExternalStore } from "react";
import { useUI, backdropSettings, BUILTIN_BACKDROPS } from "../../state/ui";

/**
 * The user's background (photo or colour/gradient), behind the whole window. Visibility, fade
 * and blur come from Settings → General.
 */
export const Backdrop = memo(function Backdrop() {
  const b = useUI((s) => s.backdrop);
  const s = backdropSettings(b);
  const tall = useTall();
  if (!s.on) return null;
  const image = (tall && BUILTIN_BACKDROPS.find((x) => x.id === b.activeId)?.tall) || b.image;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          // One property for both kinds: mixing the `background` shorthand with
          // `backgroundImage` makes React wipe one when switching between them.
          backgroundImage: b.kind === "fill" ? asImage(b.css ?? "") : `url(${image})`,
          opacity: s.intensity,
          filter: s.blur ? `blur(${s.blur}px)` : undefined,
          transform: s.blur ? "scale(1.06)" : undefined,
        }}
      />
      {s.fade > 0 && <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 30%, var(--bg) 100%)`, opacity: s.fade }} />}
    </div>
  );
});

/** A plain colour isn't a background-image; express it as a flat gradient. */
export function asImage(css: string) {
  return /gradient\(/.test(css) ? css : `linear-gradient(${css}, ${css})`;
}

const portrait = typeof window !== "undefined" ? window.matchMedia("(max-aspect-ratio: 4/5)") : null;
/** The window is tall enough that a portrait crop fits better (phones). */
function useTall() {
  return useSyncExternalStore(
    (cb) => {
      portrait?.addEventListener("change", cb);
      return () => portrait?.removeEventListener("change", cb);
    },
    () => !!portrait?.matches,
  );
}
