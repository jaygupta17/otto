/** The bell: recent alerts from agents, newest first. Tap one to open its session. */
import { AlertCircle, Bell, CheckCircle2, CircleHelp, ShieldQuestion } from "lucide-react";
import { useRef, useState } from "react";
import { openFromAlert, unreadCount, useNotifications, type AlertKind } from "../../state/notifications";
import { useNow } from "../../hooks/useNow";
import { timeAgo } from "../../lib/format";
import { Popover } from "../ui/Popover";
import { IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Pip } from "../ui/Pip";

const ICON: Record<AlertKind, React.ReactNode> = {
  finished: <CheckCircle2 size={15} className="text-ok" />,
  failed: <AlertCircle size={15} className="text-danger" />,
  permission: <ShieldQuestion size={15} className="text-info" />,
  question: <CircleHelp size={15} className="text-info" />,
};

export function InboxButton({ size = 32, className = "", buttonClassName = "" }: { size?: number; className?: string; buttonClassName?: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const unread = useNotifications(unreadCount);
  return (
    <>
      <span className={`relative inline-grid ${className}`}>
        <IconButton ref={anchor} label={unread ? `Notifications (${unread} new)` : "Notifications"} size={size} active={open} className={buttonClassName} onClick={() => setOpen((v) => !v)}>
          <Bell size={size > 36 ? 19 : 16} />
        </IconButton>
        {unread > 0 && (
          <span className="pointer-events-none absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-[5px] bg-accent px-1 font-mono text-[10px] font-semibold text-bg tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="bottom-end" width={340}>
        <InboxList onPick={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function InboxList({ onPick }: { onPick: () => void }) {
  const items = useNotifications((s) => s.items);
  const markRead = useNotifications((s) => s.markRead);
  const clear = useNotifications((s) => s.clear);
  const now = useNow(true, 30_000);
  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[13px] font-semibold">Notifications</span>
        {items.length > 0 && (
          <span className="flex gap-3 text-[12px] text-muted">
            <button className="hover:text-ink" onClick={() => markRead()}>
              Mark all read
            </button>
            <button className="hover:text-ink" onClick={clear}>
              Clear
            </button>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState small title="All quiet" body="You'll see here when an agent finishes or needs you." />
      ) : (
        <div className="scroll-quiet max-h-[360px] overflow-y-auto p-1.5">
          {items.map((a) => (
            <button
              key={a.id}
              disabled={!a.sessionId}
              onClick={() => {
                if (a.sessionId) openFromAlert(a.sessionId);
                onPick();
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover disabled:hover:bg-transparent"
            >
              <span className="mt-0.5 shrink-0">{ICON[a.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`min-w-0 flex-1 truncate text-[13px] ${a.read ? "text-ink-2" : "font-medium text-ink"}`}>{a.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">{timeAgo(a.time, now)}</span>
                </span>
                {a.body && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug break-words text-muted">{a.body}</span>}
              </span>
              {!a.read && <Pip tone="new" label="New" className="mt-1.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
