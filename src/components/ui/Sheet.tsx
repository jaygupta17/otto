import { AnimatePresence, motion, useDragControls } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom sheet on phones, centered dialog on larger screens.
 * Drag the grabber down to dismiss on touch.
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
  wide = false,
  compact,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  wide?: boolean;
  compact: boolean;
}) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div
            className="absolute inset-0 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          {compact ? (
            <motion.div
              className="safe-bottom absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-surface-solid surface-overlay"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "tween", duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              drag="y"
              dragControls={drag}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 600) onClose();
              }}
            >
              <div className="flex touch-none justify-center pt-2.5 pb-1" onPointerDown={(e) => drag.start(e)}>
                <div className="h-1.5 w-10 rounded-full bg-line-strong" />
              </div>
              {title && <div className="px-5 pt-1 pb-2 text-center text-[15px] font-semibold">{title}</div>}
              <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{children}</div>
            </motion.div>
          ) : (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
              <motion.div
                className={`pointer-events-auto flex max-h-[86vh] w-full flex-col overflow-hidden surface-overlay rounded-3xl border border-line bg-surface-solid shadow-pop ${wide ? "max-w-[1060px]" : "max-w-[520px]"}`}
                initial={{ opacity: 0, scale: 0.985, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.12 } }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {title && <div className="border-b border-line px-6 py-4 text-[15px] font-semibold">{title}</div>}
                <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{children}</div>
              </motion.div>
            </div>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
