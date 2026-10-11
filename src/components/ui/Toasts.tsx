import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useUI } from "../../state/ui";

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[max(14px,env(safe-area-inset-top))]">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="bg-raised pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-2xl border border-line px-3.5 py-2.5 shadow-pop"
          >
            <span className={`mt-0.5 ${t.tone === "error" ? "text-danger" : t.tone === "ok" ? "text-ok" : "text-muted"}`}>
              {t.tone === "error" ? <AlertCircle size={17} /> : t.tone === "ok" ? <CheckCircle2 size={17} /> : <Info size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t.title}</div>
              {t.body && <div className="selectable mt-0.5 line-clamp-3 text-[12.5px] text-muted">{t.body}</div>}
            </div>
            <button className="text-faint hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
