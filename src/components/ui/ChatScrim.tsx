import { memo, useId } from "react";

/**
 * The panel colour rising out of the thread toward the composer. A taller
 * fade than the old strip, reaching the panel colour early so text dissolves
 * well before the composer; the top edge waves by a few pixels so it never
 * reads as a ruled line.
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

