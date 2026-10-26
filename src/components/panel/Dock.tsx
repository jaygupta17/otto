/**
 * The dock: a vertical, icon-only column pinned to the window's right edge,
 * vertically centred, in front of nothing. It is the panel's only navigation
 * and it never moves — the panel opens to its left, so the chat narrows while
 * the dock stays put under the pointer.
 *
 * One control, one position, both directions: a click opens a surface, and a
 * click on the same icon closes it. No second button for close, and nothing
 * that changes identity when the panel toggles.
 */
import { useUI } from "../../state/ui";
import { useTerminals } from "../../state/terminals";
import { useHandoff } from "../../state/computer";
import { useArtifacts } from "../../state/artifacts";
import { DOCK_W, SURFACES } from "./SidePanel";
import { Pip } from "../ui/Pip";
import { kbd } from "../../hooks/useShortcuts";

export function Dock() {
  const panel = useUI((s) => s.panel);
  const last = useUI((s) => s.lastPanel);
  const togglePanel = useUI((s) => s.togglePanel);
  const terms = useTerminals((s) => s.tabs.length);
  const waiting = !!useHandoff(null);
  const fresh = useArtifacts((s) => s.fresh);
  // Closed, the surface the panel would open at is still the one you're in.
  const current = panel ?? last;

  return (
    <nav aria-label="Tools" className="relative flex h-full shrink-0 flex-col items-center justify-center gap-1 border-l border-line bg-bg" style={{ width: DOCK_W }}>
      {SURFACES.map((s) => {
        const on = panel === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-label={s.label}
            aria-pressed={on}
            data-tip={s.label}
            data-tip-keys={kbd(s.keys)}
            data-tip-side="left"
            onClick={() => togglePanel(s.id)}
            className={`relative grid h-9 w-9 place-items-center rounded-lg transition-[background,color,box-shadow] duration-150 ${
              on ? "chip text-accent-ink" : current === s.id ? "text-ink-2 hover:bg-hover hover:text-ink" : "text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            {s.icon(17)}
            {/* What's waiting behind an icon, or a surface you haven't looked at yet. */}
            {s.id === "artifact" && fresh > 0 && !on && <Pip tone="new" label="New artifact" className="absolute top-1.5 right-1.5" />}
            {s.id === "browser" && waiting && !on && <Pip tone="needs" label="Waiting for you" className="absolute top-1.5 right-1.5" />}
            {s.id === "terminal" && terms > 0 && !on && (
              <span aria-hidden className="absolute right-1.5 bottom-1 font-mono text-[10px] leading-none text-faint tabular-nums">
                {terms}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
