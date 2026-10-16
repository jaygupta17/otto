import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap, useLayer } from "../../lib/layers";
import type { Block } from "../../lib/opencode/projection";
import { IconButton } from "../ui/Button";

type Shot = { key: string; src: string; name: string };

/** Images the agent's tools brought back (a file it read, a screenshot), inline. */
export function imagesOf(blocks: Block[]): Shot[] {
  const out: Shot[] = [];
  for (const b of blocks) {
    if (b.kind !== "tool") continue;
    (b.files ?? []).forEach((f, i) => {
      // Only what the browser can show as-is; a bare path would need a fetch from the machine.
      if (f.mime.startsWith("image/") && /^(data:|https?:)/.test(f.uri)) out.push({ key: `${b.key}:${i}`, src: f.uri, name: f.name?.split("/").pop() || "Image" });
    });
  }
  return out;
}

/** What the agent looked at: thumbnails under its run; one opens full size. */
export const ImageStrip = memo(function ImageStrip({ blocks }: { blocks: Block[] }) {
  const shots = useMemo(() => imagesOf(blocks), [blocks]);
  const [open, setOpen] = useState<Shot | null>(null);
  if (!shots.length) return null;
  return (
    <>
      <div className="my-1.5 flex flex-wrap gap-2">
        {shots.map((s) => (
          <button
            key={s.key}
            onClick={() => setOpen(s)}
            title={s.name}
            aria-label={`View ${s.name}`}
            className="group relative block max-w-full overflow-hidden rounded-lg border border-line bg-sunken transition-colors hover:border-line-strong"
          >
            <img src={s.src} alt={s.name} loading="lazy" decoding="async" className="block max-h-[180px] max-w-[min(100%,320px)] object-contain" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pt-4 pb-1 text-left text-[11.5px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {s.name}
            </span>
          </button>
        ))}
      </div>
      <Viewer shot={open} onClose={() => setOpen(null)} />
    </>
  );
});

function Viewer({ shot, onClose }: { shot: Shot | null; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayer(!!shot, onClose);
  useFocusTrap(root, !!shot);
  return createPortal(
    <AnimatePresence>
      {shot && (
        <motion.div
          ref={root}
          role="dialog"
          aria-modal
          aria-label={shot.name}
          className="fixed inset-x-0 top-0 z-50 flex h-[var(--app-h,100dvh)] flex-col bg-black/85 pt-[var(--safe-t)] pb-[var(--safe-b)] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4 text-white/80">
            <span className="min-w-0 flex-1 truncate text-[13px]">{shot.name}</span>
            <IconButton label="Close" className="text-white/80 hover:text-white" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
            <img src={shot.src} alt={shot.name} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
