import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useUI } from "../../state/ui";
import { useHistoryEntry } from "../../lib/back";
import { useFocusTrap, useLayer } from "../../lib/layers";
import { EDGE, axisOf, ofHint, resist, settle, type Axis } from "../../lib/pager";
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
  const [open, setOpen] = useState<number | null>(null);
  if (!shots.length) return null;
  return (
    <>
      <div className="my-1.5 flex flex-wrap gap-2">
        {shots.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setOpen(i)}
            title={s.name}
            aria-label={`View ${s.name}`}
            className="group relative block max-w-full overflow-hidden rounded-lg border border-line bg-sunken transition-colors hover:border-line-strong"
          >
            <img src={s.src} alt={s.name} loading="lazy" decoding="async" className="block max-h-[180px] max-w-[min(100%,320px)] object-contain" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pt-4 pb-1 text-left text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {s.name}
            </span>
          </button>
        ))}
      </div>
      <ImageViewer images={shots} index={open} onClose={() => setOpen(null)} />
    </>
  );
});

export type ViewerImage = { src: string; name: string };

/**
 * Images full screen, one page each: swipe or ←/→ between them ("2 of 3" up
 * top), pull down or swipe in from the left edge to close, and Back closes it
 * too (it holds a history entry while open). A tap off the image closes.
 */
export function ImageViewer({ images, index, onClose }: { images: ViewerImage[]; index: number | null; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const open = index !== null && images.length > 0;
  useLayer(open, onClose);
  useHistoryEntry(open, onClose);
  useFocusTrap(root, open);
  return createPortal(<AnimatePresence>{open && <Pager root={root} images={images} start={index} onClose={onClose} />}</AnimatePresence>, document.body);
}

const spring = { type: "spring", stiffness: 420, damping: 42 } as const;

function Pager({ root, images, start, onClose }: { root: RefObject<HTMLDivElement | null>; images: ViewerImage[]; start: number; onClose: () => void }) {
  const count = images.length;
  const [at, setAt] = useState(() => Math.min(Math.max(start, 0), count - 1));
  const [width, setWidth] = useState(() => window.innerWidth);
  const x = useMotionValue(-at * width);
  const y = useMotionValue(0);
  // A swipe in from the left edge carries the whole viewer, like leaving a page.
  const off = useMotionValue(0);
  const drag = useRef<{ axis: Axis | null; edge: boolean }>({ axis: null, edge: false });
  const moved = useRef(false);
  // Pulling down or in from the edge lets the conversation show through as it goes.
  const away = useTransform(() => Math.max(y.get(), off.get()));
  const dim = useTransform(away, [0, 320], [1, 0.2]);
  const scale = useTransform(away, [0, 320], [1, 0.88]);

  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // A rotation or a resized window keeps the same page in view.
  useEffect(() => x.set(-at * width), [width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paging settles like any other transition: snap it when motion is reduced.
  const still = useReducedMotion() || useUI((s) => s.reduceMotion);

  const go = (n: number) => {
    const to = Math.min(Math.max(n, 0), count - 1);
    setAt(to);
    void animate(x, -to * width, still ? { duration: 0 } : spring);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        go(at + (e.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const shot = images[at];
  const hint = ofHint(at, count);
  return (
    <motion.div
      ref={root}
      role="dialog"
      aria-modal
      aria-roledescription={count > 1 ? "carousel" : undefined}
      aria-label={shot.name}
      className="fixed inset-x-0 top-0 z-50 flex h-[var(--app-h,100dvh)] flex-col overflow-hidden pt-[var(--safe-t)] pb-[var(--safe-b)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <motion.div aria-hidden style={{ opacity: dim }} className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
      <motion.div style={{ opacity: dim }} className="relative z-10 flex h-12 shrink-0 items-center gap-3 pr-2 pl-4 text-white/80">
        <span className="min-w-0 flex-1 truncate text-[13px]">{shot.name}</span>
        {hint && (
          <span aria-live="polite" className="shrink-0 font-mono text-[12px] text-white/60 tabular-nums">
            {hint}
          </span>
        )}
        <IconButton label="Close" className="text-white/80 hover:text-white" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </motion.div>
      <motion.div
        className="relative min-h-0 flex-1 touch-none select-none"
        style={{ scale, x: off }}
        onPanStart={(_, info) => {
          // Where the finger came down, not where the pan was first noticed.
          // The viewer is full width, so the screen's edge is its edge.
          drag.current = { axis: null, edge: info.point.x - info.offset.x - window.scrollX < EDGE };
          moved.current = false;
        }}
        onPan={(_, info) => {
          const g = drag.current;
          g.axis ??= axisOf(info.offset.x, info.offset.y);
          if (!g.axis) return;
          moved.current = true;
          if (g.axis === "y") y.set(Math.max(0, info.offset.y));
          else if (g.axis === "x" && g.edge && info.offset.x > 0) off.set(info.offset.x);
          else if (g.axis === "x") x.set(-at * width + resist(info.offset.x, at, count));
        }}
        onPanEnd={(_, info) => {
          const g = drag.current;
          const land = settle({ axis: g.axis, edge: g.edge, dx: info.offset.x, dy: info.offset.y, vx: info.velocity.x, vy: info.velocity.y, width, at, count });
          if (land.close) return onClose();
          go(land.to);
          void animate(y, 0, still ? { duration: 0 } : spring);
          void animate(off, 0, still ? { duration: 0 } : spring);
        }}
        onClick={() => {
          // The end of a drag isn't a tap.
          if (!moved.current) onClose();
          moved.current = false;
        }}
      >
        <motion.div className="flex h-full" style={{ x, y }}>
          {images.map((img, i) => (
            <div key={i} style={{ width }} className="flex h-full shrink-0 items-center justify-center p-4 pt-0" aria-hidden={i !== at}>
              {Math.abs(i - at) <= 1 && (
                <img src={img.src} alt={img.name} draggable={false} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
              )}
            </div>
          ))}
        </motion.div>
        {count > 1 && (
          <>
            {at > 0 && (
              <IconButton label="Previous image" className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-black/40 text-white/80 hover:text-white [@media(hover:none)]:hidden" onClick={(e) => (e.stopPropagation(), go(at - 1))}>
                <ChevronLeft size={18} />
              </IconButton>
            )}
            {at < count - 1 && (
              <IconButton label="Next image" className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-black/40 text-white/80 hover:text-white [@media(hover:none)]:hidden" onClick={(e) => (e.stopPropagation(), go(at + 1))}>
                <ChevronRight size={18} />
              </IconButton>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
