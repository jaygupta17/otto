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

export function HireGallery({ profile, onProfile, onCustom, onEdit, compact }: { profile: string | null; onProfile: (id: string | null) => void; onCustom: () => void; onEdit: (id: string) => void; compact: boolean }) {
  const standing = useStanding();
  const member = profile ? CATALOG.find((t) => t.id === profile) : undefined;
  if (member) return <Profile t={member} standing={standing(member.id)} onBack={() => onProfile(null)} onEdit={onEdit} compact={compact} />;

  // Who's still to meet comes first; the team you have sits at the end.
  const order = [...CATALOG].sort((a, b) => Number(standing(a.id) === "hired") - Number(standing(b.id) === "hired"));
  return (
    <div>
      <h3 className={`font-semibold tracking-[-0.01em] text-ink ${compact ? "text-[17px]" : "text-[20px]"}`}>Hire a teammate</h3>
      <p className="mt-1 text-[13px] text-muted">Each comes with a job, a way of working and a memory of their own. Change anything once they're here.</p>
      <ul className={`mt-5 grid gap-1 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
        <li>
          <button onClick={onCustom} className="group flex h-full w-full flex-col items-center rounded-2xl px-3 pb-4 pt-5 text-center transition-colors hover:bg-hover">
            <span className="grid h-14 w-14 place-items-center rounded-full border border-dashed border-line-strong text-muted transition-colors group-hover:border-ink group-hover:text-ink">
              <Plus size={20} />
            </span>
            <span className="mt-3 text-[13.5px] font-medium text-ink">Your own</span>
            <span className="mt-0.5 text-[12.5px] leading-snug text-muted">Any name, any job</span>
          </button>
        </li>
        {order.map((t, i) => {
          const s = standing(t.id);
          return (
            <motion.li key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.025 * i }}>
              <button onClick={() => onProfile(t.id)} className="flex h-full w-full flex-col items-center rounded-2xl px-3 pb-4 pt-5 text-center transition-colors hover:bg-hover">
                <TeammateFace seed={hash(t.id)} color={t.color} accessory={t.accessory} size={56} greet={false} label={t.name} />
                <span className="mt-3 flex items-center gap-1 text-[13.5px] font-medium text-ink">
                  {t.name}
                  {s === "hired" && <Check size={13} className="text-ok" aria-label="On the team" />}
                </span>
                <span className="mt-0.5 text-[12.5px] text-muted">{t.job}</span>
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
function Profile({ t, standing, onBack, onEdit, compact }: { t: Member; standing: "hired" | "taken" | "open"; onBack: () => void; onEdit: (id: string) => void; compact: boolean }) {
  const hire = useTeammates((s) => s.hire);
  const lead = useTeammates((s) => Object.values(s.byId ?? {}).find((m) => m.leads && m.id !== t.id));
  const [busy, setBusy] = useState(false);
  // Hired here and now: they jump for joy.
  const [joined, setJoined] = useState(false);

  const talk = (draft?: string) => {
    const chat = useChat.getState();
    void chat.setAgent(t.id, null);
    chat.open(null);
    if (draft) chat.setDraft("new", draft);
    useUI.getState().closeSettings();
  };

  return (
    <div className={compact ? "" : "mx-auto max-w-[540px]"}>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Everyone
      </button>

      <div className="flex items-center gap-4">
        <TeammateFace seed={hash(t.id)} color={t.color} accessory={t.accessory} size={compact ? 64 : 80} state={joined ? "done" : "idle"} follow interactive label={t.name} />
        <div className="min-w-0">
          <div className="truncate text-[13px] text-muted">
            <span className="font-medium text-ink-2">{t.name}</span> · {t.job}
          </div>
          <h3 className={`mt-0.5 font-semibold tracking-[-0.01em] text-ink ${compact ? "text-[19px]" : "text-[24px]"}`}>{t.greeting}</h3>
        </div>
      </div>

      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{t.tagline}</p>
      {lead && !t.leads && (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
          <TeammateFace seed={lead.face} color={lead.color} accessory={lead.accessory} size={18} greet={false} />
          {lead.name} can hand them work.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {standing === "hired" ? (
          <>
            <Button variant="primary" onClick={() => talk()}>
              Talk to {t.name}
            </Button>
            <Button variant="secondary" onClick={() => onEdit(t.id)}>
              Settings
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
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
        {standing === "taken" && <span className="text-[12.5px] text-muted">An agent called @{t.id} is already on this machine.</span>}
      </div>

      <div className="mt-7 text-[12px] font-medium text-faint">Ask them</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {t.starters.map((text) =>
          standing === "hired" ? (
            <button key={text} onClick={() => talk(text)} title={text} className="surface-thin inline-flex h-8 max-w-full items-center rounded-full px-3 text-[13px] text-ink-2 hover:text-ink">
              <span className="truncate">{text}</span>
            </button>
          ) : (
            <span key={text} className="inline-flex h-8 max-w-full items-center rounded-full border border-line px-3 text-[13px] text-muted">
              <span className="truncate">{text}</span>
            </span>
          ),
        )}
      </div>

      <div className="mt-7 text-[12px] font-medium text-faint">How they work</div>
      <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-ink-2">
        {t.instructions.split("\n").map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="text-muted">{t.voice}</p>
      </div>
    </div>
  );
}
