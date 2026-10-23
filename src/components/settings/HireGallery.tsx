/**
 * Hiring: everyone Otto can introduce, by face. A tile opens their profile,
 * where they say hello in their own words; one tap hires them, and the same
 * button then takes you to them. "Your own" starts a blank teammate.
 */
import { motion } from "motion/react";
import { ArrowLeft, Check, Plus } from "lucide-react";
import { useState } from "react";
import { useChat } from "../../state/chat";
import { useTeammates } from "../../state/teammates";
import { useUI } from "../../state/ui";
import { CATALOG, hash } from "../../lib/teammates";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { TeammateFace } from "../ui/TeammateFace";

type Member = (typeof CATALOG)[number];

/** Where a catalogue member stands on this machine. */
function useStanding() {
  const roster = useTeammates((s) => s.byId);
  const agentIds = useChat((s) => s.agents.map((a) => a.id).join(" "));
  const theirs = new Set(agentIds.split(" "));
  return (id: string): "hired" | "taken" | "open" => (roster?.[id] ? "hired" : theirs.has(id) ? "taken" : "open");
}

/** On a phone the page around it carries the title and the way back, and `onTalk` opens the new session. */
export function HireGallery({ profile, onProfile, onCustom, onEdit, onTalk, compact }: { profile: string | null; onProfile: (id: string | null) => void; onCustom: () => void; onEdit: (id: string) => void; onTalk?: (id: string) => void; compact: boolean }) {
  const standing = useStanding();
  const member = profile ? CATALOG.find((t) => t.id === profile) : undefined;
  if (member) return <Profile t={member} standing={standing(member.id)} onBack={() => onProfile(null)} onEdit={onEdit} onTalk={onTalk} compact={compact} />;

  // Who's still to meet comes first; the team you have sits at the end.
  const order = [...CATALOG].sort((a, b) => Number(standing(a.id) === "hired") - Number(standing(b.id) === "hired"));
  return (
    <div>
      {!compact && <h3 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Hire a teammate</h3>}
      <p className={compact ? "text-[14px] text-muted" : "mt-1 text-[13px] text-muted"}>Each comes with a job, a way of working and a memory of their own. Change anything once they're here.</p>
      <ul className={`mt-5 grid gap-1 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
        <li>
          <button onClick={onCustom} className="group flex h-full w-full flex-col items-center rounded-2xl px-3 pb-4 pt-5 text-center transition-colors hover:bg-hover">
            <span className="grid h-14 w-14 place-items-center rounded-full border border-dashed border-line-strong text-muted transition-colors group-hover:border-ink group-hover:text-ink">
              <Plus size={20} />
            </span>
            <span className="mt-3 text-[13px] font-medium text-ink">Your own</span>
            <span className="mt-0.5 text-[12px] leading-snug text-muted">Any name, any job</span>
          </button>
        </li>
        {order.map((t, i) => {
          const s = standing(t.id);
          return (
            <motion.li key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.025 * i }}>
              <button onClick={() => onProfile(t.id)} className="flex h-full w-full flex-col items-center rounded-2xl px-3 pb-4 pt-5 text-center transition-colors hover:bg-hover">
                <TeammateFace seed={hash(t.id)} color={t.color} accessory={t.accessory} size={56} greet={false} label={t.name} />
                <span className="mt-3 flex items-center gap-1 text-[13px] font-medium text-ink">
                  {t.name}
                  {s === "hired" && <Check size={13} className="text-ok" aria-label="On the team" />}
                </span>
                <span className="mt-0.5 text-[12px] text-muted">{t.job}</span>
                {!compact && <span className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-faint">{t.tagline}</span>}
              </button>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

/** A teammate introducing themselves before you hire them. */
function Profile({ t, standing, onBack, onEdit, onTalk, compact }: { t: Member; standing: "hired" | "taken" | "open"; onBack: () => void; onEdit: (id: string) => void; onTalk?: (id: string) => void; compact: boolean }) {
  const hire = useTeammates((s) => s.hire);
  const lead = useTeammates((s) => Object.values(s.byId ?? {}).find((m) => m.leads && m.id !== t.id));
  const [busy, setBusy] = useState(false);
  // Hired here and now: they jump for joy.
  const [joined, setJoined] = useState(false);

  const big = compact ? "h-11 flex-1 text-[15px]" : undefined;

  const talk = (draft?: string) => {
    const chat = useChat.getState();
    void chat.setAgent(t.id, null);
    chat.open(null);
    if (draft) chat.setDraft("new", draft);
    useUI.getState().closeSettings();
    onTalk?.(t.id);
  };

  return (
    <div className={compact ? "" : "mx-auto max-w-[540px]"}>
      {!compact && (
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft size={15} /> Everyone
        </button>
      )}

      <div className="flex items-center gap-4">
        <TeammateFace seed={hash(t.id)} color={t.color} accessory={t.accessory} size={compact ? 64 : 80} state={joined ? "done" : "idle"} follow interactive label={t.name} />
        <div className="min-w-0">
          <div className="truncate text-[13px] text-muted">
            <span className="font-medium text-ink-2">{t.name}</span> · {t.job}
          </div>
          <h3 className={`mt-0.5 font-semibold tracking-[-0.01em] text-ink ${compact ? "text-[20px]" : "text-[24px]"}`}>{t.greeting}</h3>
        </div>
      </div>

      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{t.tagline}</p>
      {lead && !t.leads && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          <TeammateFace seed={lead.face} color={lead.color} accessory={lead.accessory} size={18} greet={false} />
          {lead.name} can hand them work.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {standing === "hired" ? (
          <>
            <Button variant="primary" className={big} onClick={() => talk()}>
              Talk to {t.name}
            </Button>
            <Button variant="secondary" className={big} onClick={() => onEdit(t.id)}>
              Settings
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            className={big}
            disabled={busy || standing === "taken"}
            onClick={async () => {
              setBusy(true);
              const added = await hire([t.id]);
              setBusy(false);
              if (added?.length) setJoined(true);
            }}
          >
            {busy ? <Spinner size={13} /> : `Hire ${t.name}`}
          </Button>
        )}
        {standing === "taken" && <span className="text-[12px] text-muted">An agent called @{t.id} is already on this machine.</span>}
      </div>

      <div className="mt-7 text-[12px] font-medium text-faint">Ask them</div>
      {/* Filled when they start a session, outlined while they're only an example. On a phone, one per line. */}
      <div className={`mt-2 flex gap-1.5 ${compact ? "flex-col" : "flex-wrap"}`}>
        {t.starters.map((text) =>
          standing === "hired" ? (
            <button key={text} onClick={() => talk(text)} title={text} className={`inline-flex max-w-full items-center bg-active text-ink-2 transition-colors hover:text-ink active:opacity-70 ${compact ? "min-h-11 rounded-xl px-3.5 py-2.5 text-left text-[15px] leading-snug" : "h-8 rounded-full px-3 text-[13px]"}`}>
              <span className={compact ? "line-clamp-2" : "truncate"}>{text}</span>
            </button>
          ) : (
            <span key={text} className={`inline-flex max-w-full items-center border border-line text-muted ${compact ? "min-h-11 rounded-xl px-3.5 py-2.5 text-[15px] leading-snug" : "h-8 rounded-full px-3 text-[13px]"}`}>
              <span className={compact ? "line-clamp-2" : "truncate"}>{text}</span>
            </span>
          ),
        )}
      </div>

      <div className="mt-7 text-[12px] font-medium text-faint">How they work</div>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-2">
        {t.instructions.split("\n").map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="text-muted">{t.voice}</p>
      </div>
    </div>
  );
}
