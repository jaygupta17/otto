import { DitherOrb } from "./Dither";

/**
 * The agent mark: a small dithered orb in ice whose light circles it while an
 * agent works. It is the only ambient motion in the app besides the birds
 * (see DESIGN.md).
 */
export function AgentClock({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <DitherOrb size={size} spin label="Working" className={`text-accent ${className}`} />;
}

/** Network/loading spinner (not agent activity). */
export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
