import { AnimatePresence, motion } from "motion/react";
import { ArrowRightToLine, CornerDownRight, FileDiff as FileDiffIcon, Gauge, Layers, SquarePen, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { revertIndex, useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { useExtensions } from "../../state/extensions";
import { useMemory } from "../../state/memory";
import { freshThread } from "../../lib/actions";
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

export function useUsage(sessionId: string) {
  const session = useChat((s) => s.sessions[sessionId]);
  const messages = useChat((s) => s.timelines[sessionId]?.messages);
  const models = useChat((s) => s.models);
  return useMemo(() => {
    const all = messages ?? [];
    const visible = all.slice(0, revertIndex(all, session?.revert));
    const steps = visible.filter((m): m is Assistant => m.kind === "assistant");
    // The context window as of the latest step, counted from the last compaction.
    let last: Assistant | undefined;
    let first: Assistant | undefined;
    let compacted = false;
    let compacting = false;
    let turnsSince = 0;
    for (let i = visible.length - 1; i >= 0; i--) {
      const m = visible[i];
      if (m.kind === "compaction") {
        if (m.status === "running") compacting = true;
        if (m.status === "completed") {
          compacted = !last;
          break;
        }
        continue;
      }
      if (m.kind === "user" && !m.pending) turnsSince++;
      if (m.kind === "assistant" && m.tokens && contextTokens(m.tokens)) {
        last ??= m;
        first = m;
      }
    }
    const ref = last?.model ?? session?.model;
    const info = ref ? models.find((m) => m.providerID === ref.providerID && m.id === ref.id) : undefined;
    const limit = info?.limit.context ?? 0;
    const used = contextTokens(last?.tokens);
    // How much each turn has added, after the first step (system prompt, tools).
    const growth = turnsSince >= 3 && first && last && first !== last ? (used - contextTokens(first.tokens)) / (turnsSince - 1) : 0;
    const turnsLeft = growth > 0 && limit > used ? Math.floor((limit - used) / growth) : null;
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
      /** Compacted since the last step: the window was just emptied. */
      compacted,
      compacting,
      turnsLeft,
      tokens: session?.tokens,
      cost: session?.cost ?? 0,
      turns: visible.filter((m) => m.kind === "user").length,
      speed: secs ? outTok / secs : null,
      model: info?.name ?? ref?.id,
    };
  }, [messages, session, models]);
}

/** From here the meter asks for a decision (blue): compact or start fresh. */
const FULL = 0.8;

const pctLabel = (pct: number) => (pct > 0 && pct < 0.01 ? "<1%" : `${Math.round(pct * 100)}%`);

/** Neutral while there's room; blue ("needs you") once it's nearly full. */
function Ring({ pct, size = 18 }: { pct: number; size?: number }) {
  const w = 2.5;
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  const tone = pct >= FULL ? "var(--info)" : "var(--text-2)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={w} />
      {pct > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={w}
          strokeLinecap="round"
          strokeDasharray={`${c * Math.max(pct, 0.04)} ${c}`}
          className="transition-[stroke-dasharray] duration-200 ease-out"
        />
      )}
    </svg>
  );
}

/**
 * Context-window meter for the composer: a ring and the percentage, blue once
 * it's nearly full. Opens the usage card (a popover, on phones too), which
 * offers to compact or start a fresh thread.
 */
export function ContextMeter({ sessionId, compact = false }: { sessionId: string; compact?: boolean }) {
  const u = useUsage(sessionId);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!u.limit || (!u.used && !u.compacted && !u.compacting)) return null;
  const full = u.pct >= FULL;
  // Phones are tight: the number shows once it starts to matter.
  const showPct = !u.compacting && !u.compacted && (!compact || u.pct >= 0.5);
  const title = u.compacting
    ? "Compacting the conversation…"
    : u.compacted
      ? "Context compacted. It refills as the conversation goes on."
      : `Context ${pctLabel(u.pct)} full · ${compactNumber(u.used)} of ${compactNumber(u.limit)} tokens${full ? ". Compact or start a fresh thread." : ""}`;
  const card = <UsageCard sessionId={sessionId} phone={compact} onDone={() => setOpen(false)} />;
  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label={`Context usage: ${u.compacting ? "compacting" : u.compacted ? "compacted" : `${pctLabel(u.pct)} full`}`}
        aria-expanded={open}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium tabular-nums transition-colors hover:bg-hover ${full ? "text-info" : "text-muted hover:text-ink"} ${open ? "bg-hover" : ""}`}
      >
        {u.compacting ? <Spinner size={16} /> : <Ring pct={u.compacted ? 0 : u.pct} />}
        {showPct && <span>{pctLabel(u.pct)}</span>}
      </button>
      {/* A small card, so a popover by the meter on phones too, not a page. */}
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="top-end" width={Math.min(320, window.innerWidth - 16)} label="Context usage">
        {card}
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

export function UsageCard({ sessionId, phone = false, onDone }: { sessionId: string; phone?: boolean; onDone?: () => void }) {
  const u = useUsage(sessionId);
  const compact = useChat((s) => s.compact);
  const busy = useChat((s) => !!s.busy[sessionId]);
  const autoCompact = useExtensions((s) => (s.config as { compaction?: { auto?: boolean } } | null)?.compaction?.auto !== false);
  const remembers = useMemory((s) => s.installed === true);
  const t = u.tokens;
  const full = u.pct >= FULL;
  const known = !!u.limit;
  const headline = !known
    ? "Context"
    : u.compacting
      ? "Compacting…"
      : u.compacted
        ? "Compacted"
        : `${pctLabel(u.pct)} of context used`;
  const note = !known
    ? "This model doesn't report its context size."
    : u.compacting
      ? "Summarizing older messages to make room."
      : u.compacted
        ? "Older messages were summarized. The agent keeps the summary and the latest turns."
        : full
          ? autoCompact
            ? "Nearly full. Older messages get summarized automatically soon; compact now or start fresh to choose when."
            : "Nearly full. Compact or start a fresh thread before the model runs out of room."
          : u.turnsLeft !== null && u.turnsLeft <= 30
            ? `Room for about ${u.turnsLeft} more ${u.turnsLeft === 1 ? "turn" : "turns"} like these.`
            : autoCompact
              ? "Plenty of room. When it fills up, older messages are summarized automatically."
              : "Plenty of room.";
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-[14px] font-semibold tabular-nums ${full && !u.compacted && !u.compacting ? "text-info" : "text-ink"}`}>{headline}</span>
        {known && !u.compacting && !u.compacted && <span className="shrink-0 text-[12px] text-muted tabular-nums">{`${compactNumber(u.used)} / ${compactNumber(u.limit)}`}</span>}
      </div>
      {known && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-active" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.pct * 100)} aria-label="Context used">
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{ width: u.compacted || u.compacting ? 0 : `${Math.max(u.pct * 100, u.used ? 1.5 : 0)}%`, background: full ? "var(--info)" : "var(--text-2)" }}
          />
        </div>
      )}
      <p className="mt-2 text-[12.5px] leading-snug text-muted">{note}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size={phone ? "lg" : "sm"}
          icon={<Layers size={13} />}
          disabled={busy || u.compacting}
          title={busy ? "Wait for the agent to finish" : "Summarize the conversation so far to free up context"}
          onClick={() => {
            void compact(sessionId);
            onDone?.();
          }}
        >
          Compact
        </Button>
        <Button
          size={phone ? "lg" : "sm"}
          icon={<SquarePen size={13} />}
          title={`A new, empty session with the same agent, model and folder${remembers ? ". Teammates keep their memory." : ""}`}
          onClick={() => {
            onDone?.();
            freshThread(sessionId, phone);
          }}
        >
          Fresh thread
        </Button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-[12.5px]">
        <Stat label="Input" value={t ? compactNumber(t.input) : "—"} />
        <Stat label="Output" value={t ? compactNumber(t.output + t.reasoning) : "—"} />
        <Stat label="Cache read" value={t ? compactNumber(t.cache.read) : "—"} />
        <Stat label="Cost" value={u.cost ? money(u.cost) : "Free"} />
        <Stat label="Turns" value={String(u.turns)} />
        <Stat label="Speed" value={u.speed ? `${Math.round(u.speed)} tok/s` : "—"} />
      </dl>
      {u.model && <div className="mt-2 truncate text-[12px] text-faint">{u.model}</div>}
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

/** Files this session changed. `fill` lets the list take the full height (right panel). */
export function Changes({ sessionId, onOpen, fill = false }: { sessionId: string; onOpen?: () => void; fill?: boolean }) {
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
        <div className={`scroll-quiet overflow-y-auto px-1.5 pb-2 ${fill ? "" : "max-h-[220px]"}`}>
          {files.map((f) => (
            <button
              key={f.file}
              onClick={() => {
                if (f.status !== "deleted") useUI.getState().openInEditor(f.file.startsWith("/") ? f.file : `${root.replace(/\/$/, "")}/${f.file}`);
                onOpen?.();
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
