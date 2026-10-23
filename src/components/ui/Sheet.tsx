import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ChevronLeft } from "lucide-react";
import { createContext, useContext, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap, useLayer } from "../../lib/layers";

/** Inside a phone page: how to go back. Content with its own header uses it for its back button. */
const PageCtx = createContext<{ back: () => void } | null>(null);
export const usePage = () => useContext(PageCtx);

/** The back button a phone page's header leads with. */
export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} aria-label={label} className="grid h-11 w-10 shrink-0 place-items-center rounded-full text-ink transition-colors active:bg-hover">
      <ChevronLeft size={26} strokeWidth={2} />
    </button>
  );
}

/**
 * A full-screen page on phones, pushed in from the right like a session
 * (back button, or swipe from the left edge, to leave); a centered dialog on
 * larger screens. Small dialogs (`narrow`) stay centered dialogs everywhere.
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
  wide = false,
  narrow = false,
  bare = false,
  grouped = false,
  compact,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  wide?: boolean;
  /** A small dialog (confirmations, one-field prompts). */
  narrow?: boolean;
  /** Page only: the content draws its own header (with `usePage().back`). */
  bare?: boolean;
  /** Page only: the grouped-list background, for pages of cards (settings). */
  grouped?: boolean;
  compact: boolean;
}) {
  const drag = useDragControls();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(open, onClose);
  useFocusTrap(panel, open);
  const page = compact && !narrow;
  const dialog = {
    ref: panel,
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": title ? titleId : undefined,
    tabIndex: -1,
  } as const;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-x-0 top-0 z-40 h-[var(--app-h,100dvh)]">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          {page ? (
            <motion.div
              {...dialog}
              className={`${grouped ? "bg-bg" : "surface-panel"} absolute inset-0 flex flex-col overflow-hidden shadow-pop outline-none`}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
              drag="x"
              dragControls={drag}
              dragListener={false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.9 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 110 || info.velocity.x > 500) onClose();
              }}
            >
              <div aria-hidden className="absolute inset-y-0 left-0 z-30 w-5 touch-none" onPointerDown={(e) => drag.start(e)} />
              <PageCtx.Provider value={{ back: onClose }}>
                {!bare && (
                  <header className="safe-top shrink-0">
                    <div className="flex h-[60px] items-center gap-2 border-b border-line pr-4 pl-3">
                      <BackButton onClick={onClose} />
                      {title && (
                        <div id={titleId} className="flex min-w-0 flex-1 items-center truncate text-[17px] font-semibold">
                          {title}
                        </div>
                      )}
                    </div>
                  </header>
                )}
                <div className={`safe-bottom flex min-h-0 flex-1 flex-col ${bare ? "safe-top" : "scroll-quiet overflow-y-auto"}`}>{children}</div>
              </PageCtx.Provider>
            </motion.div>
          ) : (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
              <motion.div
                {...dialog}
                className={`pointer-events-auto flex max-h-[86vh] w-full flex-col overflow-hidden surface-overlay rounded-3xl border border-line bg-surface-solid shadow-pop ${wide ? "max-w-[1060px]" : narrow ? "max-w-[400px]" : "max-w-[520px]"}`}
                initial={{ opacity: 0, scale: 0.985, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.12 } }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {title && <div id={titleId} className="border-b border-line px-6 py-4 text-[15px] font-semibold">{title}</div>}
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
