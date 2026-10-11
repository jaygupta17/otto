import { memo } from "react";
import { useUI, backdropSettings } from "../../state/ui";

/**
 * The user's background photo, behind the whole window. Visibility, fade
 * and blur come from Settings → General.
 */
export const Backdrop = memo(function Backdrop() {
  const b = useUI((s) => s.backdrop);
  const s = backdropSettings(b);
  if (!s.on) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(${b.image})`,
          opacity: s.intensity,
          filter: s.blur ? `blur(${s.blur}px)` : undefined,
          transform: s.blur ? "scale(1.06)" : undefined,
        }}
      />
      {s.fade > 0 && <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 30%, var(--bg) 100%)`, opacity: s.fade }} />}
    </div>
  );
});
