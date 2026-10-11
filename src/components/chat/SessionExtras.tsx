import { AnimatePresence, motion } from "motion/react";
import { ArrowRightToLine, CornerDownRight, FileDiff as FileDiffIcon, Gauge, Layers, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { revertIndex, useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { contextTokens, tokensPerSecond, type UIMessage } from "../../lib/opencode/projection";
import type { FileDiff } from "../../lib/opencode/client";
import { compactNumber, money } from "../../lib/format";
import { Popover } from "../ui/Popover";
import { Button, IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";

type Assistant = Extract<UIMessage, { kind: "assistant" }>;

// ---------------------------------------------------------------------------
// Inbox: messages sent mid-run, waiting for the agent
// ---------------------------------------------------------------------------

/** Steer = read after the current step. Queue = read when the run finishes. */
export function InboxTray({ sessionId }: { sessionId: string }) {
  const messages = useChat((s) => s.timelines[sessionId]?.messages);
  const cancel = useChat((s) => s.cancelInbox);
  const setDelivery = useChat((s) => s.setInboxDelivery);
  const items = useMemo(() => (messages ?? []).filter((m): m is Extract<UIMessage, { kind: "user" }> => m.kind === "user" && !!m.pending && !!m.delivery), [messages]);
  return (
    <AnimatePresence initial={false}>
      {items.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="surface-float mb-2 overflow-hidden rounded-2xl border border-line bg-raised">
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
              <CornerDownRight size={13} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2">{m.text}</span>
              <button
                onClick={() => void setDelivery(sessionId, m.id, m.delivery === "steer" ? "queue" : "steer")}
                title={m.delivery === "steer" ? "Read after the current step. Click to wait for the run to finish." : "Read when the run finishes. Click to send after the current step."}
                className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-muted hairline transition-colors hover:bg-hover hover:text-ink"
              >
                {m.delivery === "steer" ? "Steering" : "Queued"}
              </button>
              <IconButton label="Cancel" size={24} onClick={() => void cancel(sessionId, m.id)}>
                <X size={13} />
              </IconButton>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function useUsage(sessionId: string) {
  const session = useChat((s) => s.sessions[sessionId]);
  const messages = useChat((s) => s.timelines[sessionId]?.messages);
  const models = useChat((s) => s.models);
  return useMemo(() => {
    const all = messages ?? [];
    const visible = all.slice(0, revertIndex(all, session?.revert));
    const steps = visible.filter((m): m is Assistant => m.kind === "assistant");
    let last: Assistant | undefined;
    let compactedAfter = false;
    for (let i = visible.length - 1; i >= 0; i--) {
      const m = visible[i];
      if (m.kind === "compaction" && m.status === "completed") compactedAfter = true;
      if (m.kind === "assistant" && m.tokens) {
        last = m;
        break;
      }
    }
    const ref = last?.model ?? session?.model;
    const info = ref ? models.find((m) => m.providerID === ref.providerID && m.id === ref.id) : undefined;
    const limit = info?.limit.context ?? 0;
    const used = compactedAfter ? 0 : contextTokens(last?.tokens);
    let outTok = 0;
    let secs = 0;
    for (const m of steps) {
      const tps = tokensPerSecond(m);
      if (!tps) continue;
      const out = (m.tokens?.output ?? 0) + (m.tokens?.reasoning ?? 0);
      outTok += out;
      secs += out / tps;
    }
    return {
      used,
      limit,
      pct: limit ? Math.min(1, used / limit) : 0,
      tokens: session?.tokens,
      cost: session?.cost ?? 0,
      turns: visible.filter((m) => m.kind === "user").length,
      speed: secs ? outTok / secs : null,
      model: info?.name ?? ref?.id,
    };
  }, [messages, session, models]);
}

function Ring({ pct, size = 16 }: { pct: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const tone = pct > 0.85 ? "var(--danger)" : pct > 0.6 ? "var(--text-2)" : "var(--muted)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={2} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" strokeDasharray={`${c * Math.max(pct, 0.02)} ${c}`} />
    </svg>
  );
}

/** Context-window meter for the composer; opens the usage card. */
export function ContextMeter({ sessionId }: { sessionId: string }) {
  const u = useUsage(sessionId);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!u.limit || !u.used) return null;
  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((v) => !v)}
        title={`Context: ${compactNumber(u.used)} of ${compactNumber(u.limit)} tokens`}
        aria-label="Context usage"
        className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted tabular-nums transition-colors hover:bg-hover hover:text-ink"
      >
        <Ring pct={u.pct} />
        {u.pct >= 0.5 && <span>{Math.round(u.pct * 100)}%</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="top-end" width={300}>
        <UsageCard sessionId={sessionId} onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
}

/** Header button: usage and the files this session changed. */
export function SessionInfoButton({ sessionId }: { sessionId: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton ref={anchor} label="Usage and changes" className="no-drag" active={open} onClick={() => setOpen((v) => !v)}>
        <Gauge size={16} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="bottom-end" width={340}>
        <UsageCard sessionId={sessionId} onDone={() => setOpen(false)} />
        <Changes sessionId={sessionId} onOpen={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function UsageCard({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const u = useUsage(sessionId);
  const compact = useChat((s) => s.compact);
  const busy = useChat((s) => !!s.busy[sessionId]);
  const t = u.tokens;
  return (
    <div className="p-4">
      <div className="mb-2 flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-ink">Context</span>
        <span className="text-muted tabular-nums">{u.limit ? `${compactNumber(u.used)} / ${compactNumber(u.limit)}` : "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-active">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(u.pct * 100, u.used ? 1.5 : 0)}%`, background: u.pct > 0.85 ? "var(--danger)" : "var(--text-2)" }} />
      </div>
      <div className="mt-1.5 text-[12px] text-faint">{u.model}</div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
        <Stat label="Input" value={t ? compactNumber(t.input) : "—"} />
        <Stat label="Output" value={t ? compactNumber(t.output + t.reasoning) : "—"} />
        <Stat label="Cache read" value={t ? compactNumber(t.cache.read) : "—"} />
        <Stat label="Cost" value={u.cost ? money(u.cost) : "Free"} />
        <Stat label="Turns" value={String(u.turns)} />
        <Stat label="Speed" value={u.speed ? `${Math.round(u.speed)} tok/s` : "—"} />
      </dl>

      <Button
        size="sm"
        className="mt-4 w-full"
        icon={<Layers size={13} />}
        disabled={busy}
        title="Summarize the conversation so far to free up context"
        onClick={() => {
          void compact(sessionId);
          onDone();
        }}
      >
        Compact conversation
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Changes({ sessionId, onOpen }: { sessionId: string; onOpen: () => void }) {
  const client = useChat((s) => s.client);
  const root = useChat((s) => s.sessions[sessionId]?.location.directory ?? "");
  const updated = useChat((s) => s.sessions[sessionId]?.time.updated);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  useEffect(() => {
    if (!client) return;
    client
      .diff(sessionId)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [client, sessionId, updated]);
  const add = files?.reduce((a, f) => a + f.additions, 0) ?? 0;
  const del = files?.reduce((a, f) => a + f.deletions, 0) ?? 0;
  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5 text-[13px]">
        <span className="font-medium text-ink">Changes</span>
        {files && files.length > 0 && (
          <span className="text-[12px] tabular-nums">
            <span className="text-ok">+{add}</span> <span className="text-danger">−{del}</span>
          </span>
        )}
      </div>
      {files === null ? (
        <div className="flex justify-center pb-4 text-muted">
          <Spinner size={14} />
        </div>
      ) : files.length === 0 ? (
        <div className="px-4 pb-4 text-[12.5px] text-faint">No file changes yet.</div>
      ) : (
        <div className="scroll-quiet max-h-[220px] overflow-y-auto px-1.5 pb-2">
          {files.map((f) => (
            <button
              key={f.file}
              onClick={() => {
                if (f.status !== "deleted") useUI.getState().openInEditor(f.file.startsWith("/") ? f.file : `${root.replace(/\/$/, "")}/${f.file}`);
                onOpen();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover"
            >
              <FileDiffIcon size={13} className={f.status === "added" ? "text-ok" : f.status === "deleted" ? "text-danger" : "text-muted"} />
              <span className={`min-w-0 flex-1 truncate font-mono ${f.status === "deleted" ? "text-muted line-through" : "text-ink-2"}`}>{f.file}</span>
              <span className="shrink-0 tabular-nums">
                <span className="text-ok">+{f.additions}</span> <span className="text-danger">−{f.deletions}</span>
              </span>
              <ArrowRightToLine size={12} className="shrink-0 text-faint" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
