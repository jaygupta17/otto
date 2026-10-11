/**
 * The agent clock: a ring with an amber hand that turns while an agent works.
 * It is the only ambient motion in the app (see DESIGN.md).
 */
export function AgentClock({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`agent-clock ${className}`} style={{ width: size, height: size }} role="img" aria-label="Working">
      <i />
    </span>
  );
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
