import { memo } from "react";
import { useUI, backdropSettings } from "../../state/ui";

/**
 * Behind a chat that sits on the bare photo: an even shade for legibility
 * (heavier when the photo fights the theme, via --mismatch in CSS) plus a
 * bottom fade into the app colour that grows exponentially toward the
 * composer. Strength comes from Settings → General → "Fade behind the composer".
 */
export const ChatScrim = memo(function ChatScrim() {
  const b = useUI((s) => s.backdrop);
  const s = backdropSettings(b);
  if (!s.on) return null;
  const f = s.chatFade;
  // Fade covers the bottom 30–75% of the screen depending on strength; alpha ~ t^3.
  const start = 100 - (30 + f * 45);
  const stops = [0, 0.2, 0.4, 0.55, 0.7, 0.82, 0.92, 1].map((t) => `color-mix(in srgb, var(--bg) ${(Math.pow(t, 2.6) * f * 100).toFixed(1)}%, transparent) ${(start + (100 - start) * t).toFixed(1)}%`);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="chat-scrim absolute inset-0" />
      {f > 0 && <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(180deg, transparent ${start}%, ${stops.join(", ")})` }} />}
    </div>
  );
});
