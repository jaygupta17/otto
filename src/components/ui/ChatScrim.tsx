import { memo, useId } from "react";
import { useUI, backdropSettings } from "../../state/ui";

/**
 * The panel colour rising out of the thread toward the composer. A taller
 * fade than the old strip, reaching the panel colour early so text dissolves
 * well before the composer; the top edge waves by a few pixels so it never
 * reads as a ruled line. Hidden over a photo, where ChatScrim does the work.
 */
export const PanelFade = memo(function PanelFade({ className = "" }: { className?: string }) {
  const id = `panel-fade-${useId().replace(/:/g, "")}`;
  return (
    <div aria-hidden className={`panel-fade pointer-events-none ${className}`}>
      <svg className="h-full w-full" viewBox="0 0 100 88" preserveAspectRatio="none" aria-hidden>
        <defs>
          {/* userSpaceOnUse: the stops follow the strip, not the path's wavy bounds. */}
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="88">
            <stop offset="0" style={{ stopColor: "var(--bg-panel)", stopOpacity: 0 }} />
            <stop offset="0.33" style={{ stopColor: "var(--bg-panel)", stopOpacity: 0.45 }} />
            <stop offset="0.8" style={{ stopColor: "var(--bg-panel)", stopOpacity: 1 }} />
            <stop offset="1" style={{ stopColor: "var(--bg-panel)", stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        {/* ±5px across, smooth rather than sawtoothed. */}
        <path d="M0 8.5 C 9 3.5 17 12.5 27 9 C 37 5.5 44 13 55 9.5 C 66 6 73 12 83 8 C 91 4.8 96 7.5 100 9.5 L 100 88 L 0 88 Z" fill={`url(#${id})`} />
      </svg>
    </div>
  );
});

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
  // Fade begins between 65% (weak) and 20% (full strength) of the screen; alpha ~ t^2.6.
  const start = 100 - (35 + f * 45);
  // Unevenly spaced, closely packed stops: no banding, no ruled lines. Alpha stays monotonic.
  const ts = [0, 0.07, 0.16, 0.26, 0.37, 0.47, 0.56, 0.65, 0.74, 0.83, 0.92, 1];
  const stops = ts.map((t, i) => {
    const jitter = i > 0 && i < ts.length - 1 ? 0.7 * Math.sin(i * 1.9) : 0;
    const pos = start + (100 - start) * t + jitter;
    return `color-mix(in srgb, var(--bg) ${(Math.pow(t, 2.6) * f * 100).toFixed(1)}%, transparent) ${pos.toFixed(1)}%`;
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="chat-scrim absolute inset-0" />
      {f > 0 && <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(180deg, transparent ${start}%, ${stops.join(", ")})` }} />}
    </div>
  );
});
