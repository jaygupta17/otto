import { useEffect, useMemo, useRef } from "react";
import type { SessionInfo } from "@opencode/client";
import { basename, bytes, timeAgo } from "../../lib/format";
import { viewable } from "../../lib/attachments";
import { useChat } from "../../state/chat";
import { useShare, type Incoming, type ShareTarget as Target } from "../../state/share";
import { useAgentName, useTeammateState } from "../../state/teammates";
import { useOfferedAgents, useSessionTiers } from "../../state/tiers";
import { useNow } from "../../hooks/useNow";
import { ConnectionBanner } from "../shell/Home";
import { FileIcon } from "../chat/Attachments";
import { AgentMark } from "../ui/Bird";
import { Sheet } from "../ui/Sheet";
import { Spot, spot } from "../ui/Spot";

/** Sessions offered as a place to share into: the ones that want you, then the latest. */
const SESSIONS = 12;

/**
 * Where a share from another app goes, like picking a chat to send to: a new
 * session with one of your agents, or a session you already have. Picking one
 * puts it in that reply box to add to and send.
 */
export function ShareTarget({ compact }: { compact: boolean }) {
  const incoming = useShare((s) => s.incoming);
  const dismiss = useShare((s) => s.dismiss);
  // The page still shows what was shared while it leaves.
  const last = useRef(incoming);
  if (incoming) last.current = incoming;
  return (
    <Sheet open={!!incoming} onClose={dismiss} title="Share to" compact={compact}>
      {last.current && <Picker incoming={last.current} />}
    </Sheet>
  );
}

function Picker({ incoming }: { incoming: Incoming }) {
  const deliver = useShare((s) => s.deliver);
  const ready = useChat((s) => !!s.client);
  const agents = useOfferedAgents();
  const { active, recent } = useSessionTiers("");
  const sessions = useMemo(() => [...active, ...recent].slice(0, SESSIONS), [active, recent]);
  const now = useNow(true, 30_000);
  const pick = (to: Target) => ready && deliver(to);

  return (
    <div className="pb-6">
      <Preview incoming={incoming} />
      <div className="px-4">
        <ConnectionBanner />
      </div>
      {agents.length > 0 && (
        <section className="mt-6">
          <h2 className="list-label px-4 pb-2">New session with</h2>
          <div className="space-y-0.5 px-2">
            {agents.map((a) => (
              <AgentRow key={a.id} id={a.id} name={a.name} job={a.job} disabled={!ready} onClick={() => pick({ agent: a.id })} />
            ))}
          </div>
        </section>
      )}
      {sessions.length > 0 && (
        <section className="mt-8">
          <h2 className="list-label px-4 pb-2">Sessions</h2>
          <div className="px-2">
            {sessions.map((s, i) => (
              <SessionRow key={s.id} s={s} now={now} first={i === 0} disabled={!ready} onClick={() => pick({ session: s.id })} />
            ))}
          </div>
        </section>
      )}
      {incoming.skipped.length > 0 && <p className="mt-6 px-4 text-[13px] text-muted">{incoming.skipped.join(", ")} can't be attached: files over 25 MB stay behind.</p>}
    </div>
  );
}

/** What's being shared: images as thumbnails, other files as chips, then the text. */
function Preview({ incoming }: { incoming: Incoming }) {
  const urls = useMemo(() => incoming.files.map((f) => (viewable(f.type) ? URL.createObjectURL(f) : null)), [incoming.files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  if (!incoming.files.length && !incoming.text) return null;
  return (
    <div className="px-4 pt-4">
      {incoming.files.length > 0 && (
        <div className="scroll-quiet -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {incoming.files.map((f, i) =>
            urls[i] ? (
              <img key={i} src={urls[i]!} alt={f.name} className="h-16 w-16 shrink-0 rounded-lg object-cover hairline" />
            ) : (
              <div key={i} className="flex h-16 max-w-[220px] shrink-0 items-center gap-2.5 rounded-lg pr-3 pl-2.5 hairline">
                <span className="shrink-0 text-muted">
                  <FileIcon mime={f.type} name={f.name} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-ink">{f.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">{bytes(f.size)}</span>
                </span>
              </div>
            ),
          )}
        </div>
      )}
      {incoming.text && <p className={`line-clamp-3 text-[15px] leading-snug break-words whitespace-pre-wrap text-ink-2 ${incoming.files.length ? "mt-3" : ""}`}>{incoming.text}</p>}
    </div>
  );
}

function AgentRow({ id, name, job, disabled, onClick }: { id: string; name: string; job: string; disabled: boolean; onClick: () => void }) {
  const state = useTeammateState(id);
  return (
    <button {...spot} onClick={onClick} disabled={disabled} aria-label={`New session with ${name}`} className="relative isolate flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2 text-left disabled:opacity-50">
      <Spot />
      <AgentMark id={id} size={48} state={state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-snug font-semibold text-ink">{name}</span>
        {job && <span className="mt-0.5 block truncate text-[14px] text-muted">{job}</span>}
      </span>
    </button>
  );
}

function SessionRow({ s, now, first, disabled, onClick }: { s: SessionInfo; now: number; first: boolean; disabled: boolean; onClick: () => void }) {
  const who = useAgentName(s.agent);
  const where = [who, basename(s.location.directory)].filter(Boolean).join(" · ");
  return (
    <button {...spot} onClick={onClick} disabled={disabled} className="relative isolate block w-full rounded-[14px] px-2 py-3 text-left disabled:opacity-50">
      <Spot />
      {!first && <span aria-hidden className="absolute inset-x-2 -top-px h-px bg-line" />}
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[16px] leading-snug text-ink">{s.title || "New session"}</span>
        <span className="shrink-0 text-[13px] text-faint tabular-nums">{timeAgo(s.time.updated, now)}</span>
      </span>
      <span className="mt-0.5 block truncate text-[14px] text-muted">{where}</span>
    </button>
  );
}
