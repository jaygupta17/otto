/**
 * Approvals and questions, docked above the composer instead of lost in the
 * scrollback. Several at once become steps (one tick each); the header shows
 * who's asking. The answer keys work from anywhere but the text you're
 * typing: ⌥↵ allow once, ⌥⇧↵ always allow, ⌥⌫ deny. They're in each
 * button's tooltip rather than printed on it.
 */
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Hand, MessageCircleQuestion, PenLine, ShieldQuestion } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { asksFor, useChat, type FormLite } from "../../state/chat";
import { useComputer } from "../../state/computer";
import { asHandoff, type Handoff } from "../../lib/handoff";
import { useLiveTarget } from "../panel/LiveScreen";
import type { PermissionRequestLite } from "../../lib/opencode/client";
import { describePermission } from "../../lib/asks";
import { ANYONE, appEffect, appRequest, JUST_YOU, resourceLabel, withoutRemembered, withRemembered, type AppRequest } from "../../lib/appPermissions";
import { appLogo } from "../../lib/composio";
import type { PermissionRule } from "../../lib/permissions";
import { useExtensions } from "../../state/extensions";
import { useTeammate, useTeammates } from "../../state/teammates";
import { AgentMark } from "../ui/Bird";
import { MenuItem, Popover } from "../ui/Popover";
import { rovingKeys } from "../../lib/layers";
import { toast } from "../../state/ui";
import { fileDiffs, firstChangedLine, type FileDiff } from "../../lib/opencode/tools";
import { layerOpen } from "../../lib/layers";
import { isMac } from "../../lib/platform";
import { Button } from "../ui/Button";
import { CopyButton, DiffView, FileIcon, OpenButton, PathLabel, ScrollBox, SplitToggle, ThreadSession, useOpenFile, useSplitDiff } from "./ToolParts";

type Ask = { type: "permission"; id: string; req: PermissionRequestLite } | { type: "form"; id: string; form: FormLite };

const alt = isMac() ? "⌥" : "Alt+";
const shift = isMac() ? "⇧" : "Shift+";

/**
 * Everything waiting on you in `sessionId` and its subagents. `inLayer`: the
 * dock lives inside a sheet (a subagent's view) and takes the keys only there.
 */
export function AskDock({ sessionId, inLayer }: { sessionId: string; inLayer?: boolean }) {
  const permissions = useChat((s) => s.permissions);
  const forms = useChat((s) => s.forms);
  const parents = useChat((s) => s.parents);
  const asks = useMemo<Ask[]>(
    () => [
      ...Object.values(permissions)
        .filter((p) => asksFor(parents, p.sessionID, sessionId))
        .map((req) => ({ type: "permission" as const, id: req.id, req })),
      ...Object.values(forms)
        .filter((f) => asksFor(parents, f.sessionID, sessionId))
        .map((form) => ({ type: "form" as const, id: form.id, form })),
    ],
    [permissions, forms, parents, sessionId],
  );
  const [pick, setPick] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const idx = Math.max(0, asks.findIndex((a) => a.id === pick));
  const cur = asks[idx];
  // A new ask expands the dock again.
  const count = asks.length;
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) setCollapsed(false);
    prev.current = count;
  }, [count]);

  return (
    <ThreadSession.Provider value={sessionId}>
      <AnimatePresence initial={false}>
        {cur && (
          <motion.div
            key="dock"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="surface-overlay mb-2 overflow-hidden rounded-2xl border !border-info/40 bg-raised shadow-float"
            role="region"
            aria-label="Waiting for you"
          >
            <DockHeader ask={cur} asks={asks} index={idx} onPick={setPick} collapsed={collapsed} onCollapse={() => setCollapsed((v) => !v)} />
            {!collapsed &&
              (cur.type === "permission" ? (
                <PermissionStep key={cur.id} req={cur.req} inLayer={inLayer} />
              ) : (
                (() => {
                  const h = asHandoff(cur.form);
                  return h ? <HandoffStep key={cur.id} h={h} inLayer={inLayer} /> : <FormStep key={cur.id} form={cur.form} inLayer={inLayer} />;
                })()
              ))}
          </motion.div>
        )}
      </AnimatePresence>
    </ThreadSession.Provider>
  );
}

function DockHeader({ ask, asks, index, onPick, collapsed, onCollapse }: { ask: Ask; asks: Ask[]; index: number; onPick: (id: string) => void; collapsed: boolean; onCollapse: () => void }) {
  const sid = ask.type === "permission" ? ask.req.sessionID : ask.form.sessionID;
  const via = useSubagentOf(sid);
  const agent = useChat((s) => agentOf(s, sid));
  const mate = useTeammate(agent);
  const handoff = ask.type === "form" && !!asHandoff(ask.form);
  const questions = ask.type === "form" && !handoff ? ask.form.fields.filter((f) => !f.hidden).length : 0;
  const title = ask.type === "permission" ? describePermission(ask.req).verb : handoff ? "Take over the screen" : questions > 1 ? `${questions} questions` : "Question";
  // Who's asking: a teammate by name and face; a plain subagent by its kind.
  const who = mate?.name ?? (via?.agent ? `${via.label} subagent` : via ? "A subagent" : null);
  const Icon = ask.type === "permission" ? ShieldQuestion : handoff ? Hand : MessageCircleQuestion;
  return (
    <div className="flex min-w-0 items-center gap-2.5 py-2.5 pr-2 pl-3.5">
      {mate ? <AgentMark id={agent} size={22} state="needs" /> : <Icon size={16} className="shrink-0 text-info" />}
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[14px] font-semibold text-ink">{title}</span>
        {who && <span className="shrink-0 truncate text-[13px] text-muted">{who}</span>}
      </div>
      {asks.length > 1 && (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[12px] text-faint font-mono tabular-nums">
            {index + 1} of {asks.length}
          </span>
          <div role="tablist" aria-label="Waiting requests" className="flex items-center">
            {asks.map((a, i) => (
              <button key={a.id} role="tab" aria-selected={i === index} aria-label={`Request ${i + 1}`} onClick={() => onPick(a.id)} className="grid h-6 w-3.5 place-items-center">
                <span className={`h-1.5 transition-[width,background-color] ${i === index ? "w-2.5 bg-info" : "w-1.5 bg-line-strong hover:bg-muted"}`} />
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={onCollapse}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show request" : "Minimise"}
        data-tip={collapsed ? "Show" : "Minimise"}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <ChevronDown size={15} className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}

/**
 * The newest step owns ⌥-keys. Inside a sheet, only while focus is in that
 * sheet; on the main view, only with no sheet or menu open.
 */
function useAnswerKeys(handlers: { once?: () => void; always?: () => void; deny?: () => void }, inLayer: boolean | undefined, enabled: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.isComposing) return;
      if (e.key !== "Enter" && e.key !== "Backspace") return;
      if (inLayer) {
        const dialog = box.current?.closest("[role=dialog]");
        if (!dialog || !dialog.contains(document.activeElement)) return;
      } else if (layerOpen()) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || t.matches?.("input, textarea")) && ((t as HTMLInputElement).value ?? t.textContent ?? "").length > 0;
      let fn: (() => void) | undefined;
      if (e.key === "Enter") fn = e.shiftKey ? h.current.always : h.current.once;
      else if (!typing && !e.shiftKey) fn = h.current.deny;
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [inLayer, enabled]);
  return box;
}

/** The answer buttons: one row, the main answer last. Full-height and shared width on phones; compact and to the right elsewhere. */
const Answers = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`flex items-center gap-2 px-3 pt-2 pb-3 sm:justify-end ${className}`}>{children}</div>;
const answerBtn = "h-11 min-w-0 flex-1 px-2 text-[14px] sm:h-8 sm:flex-none sm:px-3 sm:text-[13px]";

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

function PermissionStep({ req, inLayer }: { req: PermissionRequestLite; inLayer?: boolean }) {
  const app = useMemo(() => appRequest(req.action, req.metadata, req.resources), [req]);
  return app ? <AppPermissionStep req={req} app={app} inLayer={inLayer} /> : <ToolPermissionStep req={req} inLayer={inLayer} />;
}

function ToolPermissionStep({ req, inLayer }: { req: PermissionRequestLite; inLayer?: boolean }) {
  const reply = useChat((s) => s.replyPermission);
  const { command, targets } = describePermission(req);
  const [sent, setSent] = useState(false);
  const [all, setAll] = useState(false);
  const md = req.metadata ?? {};
  const diffs = useMemo(() => permissionDiffs(req), [req]);
  const desc = typeof md.description === "string" && md.description.trim() && md.description !== command ? md.description : undefined;
  const shown = all ? targets : targets.slice(0, 4);
  const answer = (r: "once" | "always" | "reject") => {
    if (sent) return;
    setSent(true);
    void reply(req, r).catch(() => setSent(false));
  };
  const box = useAnswerKeys({ once: () => answer("once"), always: () => answer("always"), deny: () => answer("reject") }, inLayer, !sent);
  const save = req.save?.filter(Boolean) ?? [];

  return (
    <div ref={box}>
      <div className="scroll-quiet max-h-[50vh] space-y-2 overflow-y-auto px-3 pb-1">
        {desc && <div className="text-[13px] text-ink-2">{desc}</div>}
        {command && (
          <div className="relative">
            <ScrollBox maxHeight={220}>
              <pre className="selectable px-3 py-2.5 pr-9 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-ink">{command}</pre>
            </ScrollBox>
            <div className="absolute top-1 right-1">
              <CopyButton text={command} label="Copy command" />
            </div>
          </div>
        )}
        {diffs.map((f) => (
          <PermissionDiff key={f.file} f={f} />
        ))}
        {!diffs.length && shown.length > 0 && (
          <ul className="selectable space-y-1 rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] leading-snug text-ink-2">
            {shown.map((t) => (
              <li key={t} className="break-all">
                {t}
              </li>
            ))}
            {targets.length > shown.length && (
              <li>
                <button className="font-sans text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setAll(true)}>
                  Show {targets.length - shown.length} more
                </button>
              </li>
            )}
          </ul>
        )}
        {req.message && <div className="selectable text-[13px] leading-relaxed break-words text-ink-2">{req.message}</div>}
      </div>
      <Answers>
        <Button variant="ghost" disabled={sent} className={answerBtn} onClick={() => answer("reject")} data-tip="Deny" data-tip-keys={`${alt}⌫`}>
          Deny
        </Button>
        <Button variant="secondary" disabled={sent} className={answerBtn} onClick={() => answer("always")} data-tip={save.length ? `Always allow ${save.join(", ")}` : "Always allow"} data-tip-keys={`${alt}${shift}↵`}>
          <span className="sm:hidden">Always</span>
          <span className="max-sm:hidden">Always allow</span>
        </Button>
        <Button variant="primary" disabled={sent} className={answerBtn} onClick={() => answer("once")} data-tip="Allow once" data-tip-keys={`${alt}↵`}>
          Allow once
        </Button>
      </Answers>
    </div>
  );
}

/** The change an edit / write / patch approval would make, from what the tool sent along. */
function permissionDiffs(req: PermissionRequestLite): FileDiff[] {
  const md = req.metadata ?? {};
  const files = fileDiffs(md);
  if (files.length) return files;
  const diff = typeof md.diff === "string" && md.diff.trim() ? md.diff : undefined;
  const file = typeof md.filepath === "string" ? md.filepath : typeof md.filePath === "string" ? md.filePath : typeof md.path === "string" ? md.path : req.resources[0];
  return diff && file ? [{ file, patch: diff }] : [];
}

/**
 * An app action (opencode-composio): the app, what it would do and to whom,
 * named rather than as ids. "Always" here is a rule in Otto's settings, for
 * this teammate or for every teammate, so it shows up there and can be taken
 * back, instead of OpenCode's per-project memory.
 */
function AppPermissionStep({ req, app, inLayer }: { req: PermissionRequestLite; app: AppRequest; inLayer?: boolean }) {
  const reply = useChat((s) => s.replyPermission);
  const update = useExtensions((s) => s.update);
  const agent = useChat((s) => agentOf(s, req.sessionID));
  const teammate = useTeammates((s) => (agent ? s.byId?.[agent]?.name : undefined));
  const name = teammate ?? (agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : "");
  const [sent, setSent] = useState(false);
  const [all, setAll] = useState(false);
  const connect = req.action === "composio.connect";
  const keep = req.save?.filter(Boolean).length ? req.save.filter(Boolean) : ["*"];
  const labels = keep.filter((r) => r !== "*").map((r) => resourceLabel(r, app.names));
  const targets = app.targets.map((t) => ({ id: t, label: resourceLabel(t, app.names) }));
  const shown = all ? targets : targets.slice(0, 6);
  // The thing itself when we know it (the event, the email's subject), else the action.
  const headline = connect ? `Sign in to ${app.appName}` : (app.about ?? app.preview ?? app.action);
  const preview = app.about && app.preview && app.preview !== app.about ? app.preview : undefined;
  const doing = connect ? `connect ${app.appName}` : lowerTitle(app.action);
  const reach = keep.filter((r) => r !== "*").map((r) => (r === JUST_YOU ? "just for you" : r === ANYONE ? "for anyone with the link" : `for ${resourceLabel(r, app.names)}`));

  const answer = (r: "once" | "reject") => {
    if (sent) return;
    setSent(true);
    void reply(req, r).catch(() => setSent(false));
  };

  async function remember(scope: "agent" | "everyone") {
    if (sent) return;
    setSent(true);
    const action = req.action;
    // Yes to this, and to anything else waiting that the rule covers, before
    // saving: OpenCode reloads on a config change and drops what's still waiting.
    const st = useChat.getState();
    const covered = (p: PermissionRequestLite) => p.action === action && (keep.includes("*") || p.resources.every((r) => keep.includes(r))) && (scope === "everyone" || agentOf(st, p.sessionID) === agent);
    await Promise.all([req, ...Object.values(st.permissions).filter((p) => p.id !== req.id && covered(p))].map((p) => reply(p, "once").catch(() => {})));
    const has = (rules: readonly PermissionRule[] | undefined, r: string) => !!rules?.some((x) => x.action === action && x.resource === r && x.effect === "allow");
    // Only what this adds, so Undo leaves rules you already had alone.
    const added: { global: string[]; agent: string[] } = { global: [], agent: [] };
    const ok = await update((c) => {
      const agents = { ...(c.agents ?? {}) };
      const forAgent = (id: string) => {
        const prev = agents[id] ?? {};
        added.agent = keep.filter((r) => !has(prev.permissions, r));
        agents[id] = { ...prev, permissions: withRemembered(prev.permissions ?? [], action, keep) };
      };
      if (scope === "agent") {
        if (agent) forAgent(agent);
        return { ...c, agents };
      }
      added.global = keep.filter((r) => !has(c.permissions, r));
      const permissions = withRemembered(c.permissions ?? [], action, keep);
      // A teammate's own rule about this comes after everyone's and would still ask: say yes there too.
      if (agent && keep.some((r) => appEffect(action, { global: permissions, agent: agents[agent]?.permissions ?? [] }, r) !== "allow")) forAgent(agent);
      return { ...c, permissions, agents };
    });
    if (!ok) return;
    toast({
      tone: "ok",
      title: scope === "everyone" ? "Allowed for every teammate" : `Allowed for ${name}`,
      body: `${connect ? `Connecting ${app.appName}` : app.action}${labels.length ? ` · ${labels.join(", ")}` : ""}. Change it in Permissions any time.`,
      action: {
        label: "Undo",
        run: () =>
          void update(
            (c) => ({
              ...c,
              permissions: c.permissions && withoutRemembered(c.permissions, action, added.global),
              agents: agent && added.agent.length && c.agents?.[agent] ? { ...c.agents, [agent]: { ...c.agents[agent], permissions: withoutRemembered(c.agents[agent].permissions ?? [], action, added.agent) } } : c.agents,
            }),
            { success: "Undone" },
          ),
      },
    });
  }

  const box = useAnswerKeys({ once: () => answer("once"), always: () => void remember(agent ? "agent" : "everyone"), deny: () => answer("reject") }, inLayer, !sent);
  const alwaysRef = useRef<HTMLButtonElement>(null);
  const [always, setAlways] = useState(false);

  return (
    <div ref={box}>
      <div className="scroll-quiet max-h-[50vh] space-y-2 overflow-y-auto px-3 pb-1">
        <div className="flex items-start gap-3 py-1">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white hairline">
            <img src={appLogo(app.app)} alt="" width={18} height={18} draggable={false} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="selectable text-[13px] leading-snug font-medium break-words text-ink">{headline}</div>
            <div className="text-[12px] text-muted">{connect ? "They'll give you a link to connect it; nothing happens until you sign in." : `${app.appName} · ${app.action}`}</div>
            {preview && <div className="selectable mt-1.5 line-clamp-3 text-[13px] leading-relaxed break-words text-ink-2">“{preview}”</div>}
          </div>
        </div>
        {!connect && shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[12px] text-muted">{app.kind === "write" ? "Reaches" : app.kind === "delete" ? "Affects" : "From"}</span>
            {shown.map((t) => (
              <span key={t.id} title={t.id} className="selectable max-w-full truncate rounded-full px-2 py-0.5 text-[12px] text-ink-2 hairline">
                {t.label}
              </span>
            ))}
            {targets.length > shown.length && (
              <button className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setAll(true)}>
                {targets.length - shown.length} more
              </button>
            )}
          </div>
        )}
        {req.message && <div className="selectable text-[13px] leading-relaxed break-words text-ink-2">{req.message}</div>}
      </div>
      <Answers>
        <Button variant="ghost" disabled={sent} className={answerBtn} onClick={() => answer("reject")} data-tip="Deny" data-tip-keys={`${alt}⌫`}>
          Deny
        </Button>
        {/* Who "always" covers is a choice, so it's a menu: this teammate, or all of them. */}
        <Button ref={alwaysRef} variant="secondary" disabled={sent} className={answerBtn} onClick={() => setAlways(true)} aria-haspopup="menu" aria-expanded={always} trailing={<ChevronDown size={14} className="-mr-0.5 text-muted" />}>
          <span className="sm:hidden">Always</span>
          <span className="max-sm:hidden">Always allow</span>
        </Button>
        <Button variant="primary" disabled={sent} className={answerBtn} onClick={() => answer("once")} data-tip="Allow once" data-tip-keys={`${alt}↵`}>
          Allow once
        </Button>
      </Answers>
      <Popover open={always} onClose={() => setAlways(false)} anchor={alwaysRef.current} placement="top-end" width={280} label="Always allow">
        <div role="menu" className="p-1.5">
          <div className="px-2 pt-1 pb-1.5 text-[12px] leading-snug text-muted">
            Lets them {doing}
            {reach.length ? ` ${reach.join(", ")}` : ""} without asking{reach.length || connect ? "" : ", whatever it's for"}. Change it in Permissions.
          </div>
          {agent && <MenuItem label={`For ${name}`} right={<kbd className="font-sans text-[12px] text-faint">{`${alt}${shift}↵`}</kbd>} onClick={() => (setAlways(false), void remember("agent"))} />}
          <MenuItem label="For every teammate" right={agent ? undefined : <kbd className="font-sans text-[12px] text-faint">{`${alt}${shift}↵`}</kbd>} onClick={() => (setAlways(false), void remember("everyone"))} />
        </div>
      </Popover>
    </div>
  );
}

/** "Create Event" → "create event", keeping acronyms ("Get ACL rule" → "get ACL rule"). */
const lowerTitle = (t: string) => t.replace(/\b[A-Z][a-z]+\b/g, (w) => w.toLowerCase());

/** The agent working in a session: a subagent's, or the session's own. */
function agentOf(s: { delegated: Record<string, string>; sessions: Record<string, { agent?: string } | undefined> }, sessionID: string): string | undefined {
  return s.delegated[sessionID] || s.sessions[sessionID]?.agent || undefined;
}

function PermissionDiff({ f }: { f: FileDiff }) {
  const open = useOpenFile();
  const [split] = useSplitDiff();
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line">
      <div className="flex h-8 min-w-0 items-center gap-1.5 border-b border-line pr-1 pl-2.5 text-[12px]">
        <FileIcon path={f.file} />
        <PathLabel path={f.file} className="font-mono text-[12px]" />
        {f.status === "added" && <span className="shrink-0 text-[11px] text-ok">new</span>}
        {f.status === "deleted" && <span className="shrink-0 text-[11px] text-danger">deleted</span>}
        {(f.additions || f.deletions) && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            {f.additions ? <span className="text-ok">+{f.additions}</span> : null} {f.deletions ? <span className="text-danger">−{f.deletions}</span> : null}
          </span>
        )}
        <div className="flex-1" />
        <SplitToggle />
        {f.status !== "added" && <OpenButton label="Open file" onClick={() => open(f.file, firstChangedLine(f.patch))} />}
      </div>
      {f.patch ? <DiffView patch={f.patch} split={split} /> : <div className="px-3 py-2 text-[12px] text-faint">{f.status === "deleted" ? "Deletes the file" : "No textual changes"}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

/**
 * The agent stopped for something only the person should do on its screen
 * (sign in, a code, a CAPTCHA). Take control opens the live view; handing
 * back answers the agent's question, and it carries on from there.
 */
function HandoffStep({ h, inLayer }: { h: Handoff; inLayer?: boolean }) {
  // No live screen here (not a Boat machine): the person does it their own way and says so.
  const live = !!useLiveTarget();
  const control = useComputer((s) => s.control) || !live;
  const [sent, setSent] = useState(false);
  const run = (fn: () => Promise<void>) => {
    if (sent) return;
    setSent(true);
    void fn().catch(() => setSent(false));
  };
  const take = () => void useComputer.getState().takeControl(h.form.sessionID);
  const back = () => run(() => useComputer.getState().handBack(h.form.sessionID));
  const cancel = () => run(() => useComputer.getState().cancelHandoff(h));
  const box = useAnswerKeys({ once: control ? back : take, deny: cancel }, inLayer, !sent);

  return (
    <div ref={box}>
      <div className="px-3 pb-1">
        <div className="selectable text-[14px] leading-snug break-words whitespace-pre-wrap text-ink">{h.reason}</div>
        <div className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {!live ? "The agent is waiting. Tell it when you're done." : control ? "When you've finished on the screen, hand it back and the agent carries on." : "The agent is waiting. Take control and do it on its screen; what you type there goes straight to the machine, never through the chat."}
        </div>
      </div>
      <Answers>
        <Button variant="ghost" disabled={sent} className={answerBtn} onClick={cancel} data-tip="Cancel" data-tip-keys={`${alt}⌫`}>
          Cancel
        </Button>
        {control ? (
          <Button variant="primary" disabled={sent} className={answerBtn} onClick={back} data-tip="Hand back" data-tip-keys={`${alt}↵`}>
            {live ? "Done, hand back" : "Done"}
          </Button>
        ) : (
          <Button variant="primary" disabled={sent} className={answerBtn} onClick={take} data-tip="Take control" data-tip-keys={`${alt}↵`}>
            Take control
          </Button>
        )}
      </Answers>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question
// ---------------------------------------------------------------------------

type Field = FormLite["fields"][number];
/** A single-choice field's "something else" pick; the words live in `other`. */
const OTHER = "\u0000other";

/**
 * The agent's questions, one at a time when there are several (a tab per
 * question, by its short header). Choices are a list with their
 * explanations; where the agent allows it (OpenCode's default), the last
 * row takes your own words instead. Other forms show every field at once.
 */
function FormStep({ form, inLayer }: { form: FormLite; inLayer?: boolean }) {
  const reply = useChat((s) => s.replyForm);
  const question = form.metadata?.kind === "question";
  const visible = form.fields.filter((f) => !f.hidden);
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(visible.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])));
  const [other, setOther] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState(false);
  const stepped = question && visible.length > 1;
  const last = !stepped || step === visible.length - 1;
  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));

  const valueOf = (f: Field): unknown => {
    const v = values[f.key];
    const own = other[f.key]?.trim();
    if (f.type === "multiselect") return [...((v as string[] | undefined) ?? []), ...(own ? [own] : [])];
    if (v === OTHER) return own || undefined;
    return v;
  };
  const answered = (f: Field) => {
    const v = valueOf(f);
    return v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "number" && Number.isNaN(v));
  };
  // A question needs an answer; other forms say which fields they need.
  const needs = (f: Field) => question || !!f.required;
  const ready = visible.every((f) => !needs(f) || answered(f));
  const send = (skip?: boolean) => {
    if (sent || (!skip && !ready)) return;
    setSent(true);
    const out = Object.fromEntries(visible.filter(answered).map((f) => [f.key, valueOf(f)]));
    void reply(form, skip ? null : out).catch(() => setSent(false));
  };
  const next = () => {
    if (!last) answered(visible[step]) && setStep((i) => i + 1);
    else send();
  };
  const box = useAnswerKeys({ once: () => send(), deny: () => send(true) }, inLayer, !sent);
  const shown = stepped ? [visible[step]] : visible;
  const cur = visible[step];

  return (
    <div ref={box}>
      {stepped && (
        <div role="tablist" aria-label="Questions" className="scroll-none flex gap-1 overflow-x-auto px-3 pb-2">
          {visible.map((f, i) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={i === step}
              onClick={() => setStep(i)}
              className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] transition-colors ${i === step ? "bg-accent text-on-accent" : "text-muted hover:bg-hover hover:text-ink"}`}
            >
              {answered(f) && i !== step && <Check size={12} className="text-ok" />}
              {f.title || `Question ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="scroll-quiet max-h-[50vh] overflow-y-auto px-3 pb-1">
        {!question && form.title && <div className="selectable mb-3 px-0.5 text-[15px] leading-snug font-semibold break-words whitespace-pre-wrap">{form.title}</div>}
        <div className="space-y-4">
          {shown.map((f) => (
            <FieldInput
              key={f.key}
              f={f}
              question={question}
              labelled={!question && (!!f.title || visible.length > 1)}
              value={values[f.key]}
              other={other[f.key] ?? ""}
              onChange={(v) => set(f.key, v)}
              onOther={(t) => setOther((p) => ({ ...p, [f.key]: t }))}
              // A single choice moves on to the next question by itself.
              onChosen={() => stepped && !last && window.setTimeout(() => setStep((i) => Math.min(i + 1, visible.length - 1)), 160)}
              onEnter={next}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 pt-3 pb-3">
        <Button variant="ghost" disabled={sent} className="h-11 px-3 text-[14px] text-muted sm:h-8 sm:text-[13px]" onClick={() => send(true)} data-tip="Skip and let the agent carry on" data-tip-keys={`${alt}⌫`}>
          Skip
        </Button>
        <div className="flex-1" />
        {stepped && step > 0 && (
          <Button variant="secondary" disabled={sent} className="h-11 px-3 text-[14px] sm:h-8 sm:text-[13px]" onClick={() => setStep((i) => i - 1)}>
            Back
          </Button>
        )}
        {last ? (
          <Button variant="primary" disabled={!ready || sent} className="h-11 min-w-[88px] px-4 text-[14px] sm:h-8 sm:min-w-0 sm:text-[13px]" onClick={() => send()} data-tip="Send" data-tip-keys={`${alt}↵`}>
            Send
          </Button>
        ) : (
          <Button variant="primary" disabled={!answered(cur)} className="h-11 min-w-[88px] px-4 text-[14px] sm:h-8 sm:min-w-0 sm:text-[13px]" onClick={next}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

/** One field: a list of choices (with room for your own words), yes or no, or a text box. */
function FieldInput({ f, question, labelled, value, other, onChange, onOther, onChosen, onEnter }: { f: Field; question: boolean; labelled: boolean; value: unknown; other: string; onChange: (v: unknown) => void; onOther: (t: string) => void; onChosen: () => void; onEnter: () => void }) {
  const multi = f.type === "multiselect";
  const otherRef = useRef<HTMLInputElement>(null);
  // OpenCode's questions allow an answer of your own unless they say otherwise.
  const custom = f.custom !== false && (f.type === "string" || multi);
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onEnter();
    }
  };
  const heading = question ? (f.description || f.title) : f.title ?? f.key;
  const sub = question ? undefined : f.description;

  return (
    <div>
      {(question || labelled) && heading && <div className={`selectable px-0.5 break-words whitespace-pre-wrap ${question ? "mb-2.5 text-[15px] leading-snug font-medium text-ink" : "mb-1 text-[13px] font-medium text-ink-2"}`}>{heading}</div>}
      {sub && <div className="selectable mb-2 px-0.5 text-[12px] leading-relaxed break-words whitespace-pre-wrap text-muted">{sub}</div>}
      {f.options?.length ? (
        <div role={multi ? "group" : "radiogroup"} aria-label={heading} className="-mx-1 space-y-0.5" onKeyDown={(e) => rovingKeys(e, '[role="radio"], [role="checkbox"], input')}>
          {f.options.map((o) => {
            const on = multi ? Array.isArray(value) && value.includes(o.value) : value === o.value;
            const label = o.label ?? o.value;
            const desc = o.description && o.description.trim() !== label.trim() ? o.description : undefined;
            return (
              <button
                key={o.value}
                role={multi ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => {
                  if (multi) return onChange(on ? (value as string[]).filter((x) => x !== o.value) : [...((value as string[]) ?? []), o.value]);
                  onChange(o.value);
                  onChosen();
                }}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-info/40 sm:py-2 ${on ? "chip" : "hover:bg-hover"}`}
              >
                <Mark on={on} multi={multi} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug break-words text-ink sm:text-[14px]">{label}</span>
                  {desc && <span className="mt-0.5 block text-[13px] leading-snug break-words text-muted sm:text-[12px]">{desc}</span>}
                </span>
              </button>
            );
          })}
          {custom && (
            <label className={`flex w-full cursor-text items-center gap-3 rounded-xl px-3 py-1 transition-colors ${(multi ? !!other.trim() : value === OTHER) ? "chip" : "hover:bg-hover"}`}>
              {multi || value === OTHER ? <Mark on={multi ? !!other.trim() : true} multi={multi} /> : <PenLine size={16} className="mt-px shrink-0 text-faint" />}
              <input
                ref={otherRef}
                value={other}
                onFocus={() => !multi && onChange(OTHER)}
                onChange={(e) => {
                  onOther(e.target.value);
                  if (!multi) onChange(OTHER);
                }}
                onKeyDown={enter}
                placeholder={multi ? "Add your own" : "Something else…"}
                aria-label="Your own answer"
                className="h-9 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted sm:text-[14px]"
              />
            </label>
          )}
        </div>
      ) : f.type === "boolean" ? (
        <div className="flex gap-1.5" role="radiogroup" aria-label={heading}>
          {[true, false].map((v) => (
            <button key={String(v)} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`h-10 flex-1 rounded-xl text-[14px] transition-colors sm:h-8 sm:flex-none sm:px-4 sm:text-[13px] ${value === v ? "bg-accent text-on-accent" : "bg-hover text-ink hover:bg-active"}`}>
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
      ) : (
        <input
          className="field h-11 w-full rounded-xl px-3 text-[16px] outline-none sm:h-9 sm:text-[14px]"
          type={f.type === "number" || f.type === "integer" ? "number" : "text"}
          placeholder={f.placeholder ?? (question ? "Your answer" : undefined)}
          aria-label={heading}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(f.type === "number" || f.type === "integer" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
          onKeyDown={enter}
        />
      )}
    </div>
  );
}

/** A radio dot or a checkbox tick, ice when on. */
const Mark = ({ on, multi }: { on: boolean; multi: boolean }) => (
  <span className={`mt-[3px] grid h-4 w-4 shrink-0 place-items-center border transition-colors ${multi ? "rounded-[5px]" : "rounded-full"} ${on ? "border-accent bg-accent text-on-accent" : "border-faint"}`}>
    {on && (multi ? <Check size={11} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-on-accent" />)}
  </span>
);

/** The subagent behind a session (from the call that spawned it), or null for a top-level session. */
function useSubagentOf(sessionID: string): { agent?: string; label: string } | null {
  const parent = useChat((s) => s.parents[sessionID]);
  const agent = useChat((s) => {
    if (!parent) return undefined;
    for (const m of s.timelines[parent]?.messages ?? []) {
      if (m.kind !== "assistant") continue;
      for (const b of m.blocks) {
        if (b.kind !== "tool" || (b.metadata?.sessionID ?? b.metadata?.sessionId) !== sessionID) continue;
        const a = b.input?.agent ?? b.input?.subagent_type;
        return typeof a === "string" && a ? a : "";
      }
    }
    return "";
  });
  if (!parent) return null;
  return { agent: agent || undefined, label: agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : "" };
}
