/**
 * Otto mark: a ring (the machine) with an ice point (the agent at work).
 * Flat, one stroke weight, no gradients.
 */
export function Mark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="10.5" cy="13.5" r="6.75" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="19" cy="5" r="2.4" fill="var(--accent)" />
    </svg>
  );
}

/** App icon in UI (sidebar, splash, about). */
export function AppGlyph({ size = 28 }: { size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center bg-ink text-bg" style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}>
      <Mark size={Math.round(size * 0.64)} />
    </div>
  );
}
