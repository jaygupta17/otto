/**
 * Approvals and questions, docked above the composer instead of lost in the
 * scrollback. Several at once become steps (one dot each); one from a
 * subagent says which. The answer keys work from anywhere but the text
 * you're typing: ⌥↵ allow once, ⌥⇧↵ always allow, ⌥⌫ deny.
 */
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Hand, MessageCircleQuestion, ShieldQuestion } from "lucide-react";
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
import { useTeammates } from "../../state/teammates";
import { toast } from "../../state/ui";
import { fileDiffs, firstChangedLine, type FileDiff } from "../../lib/opencode/tools";
import { agentColor } from "../../lib/agentColor";
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
  const handoff = ask.type === "form" && !!asHandoff(ask.form);
  const title = ask.type === "permission" ? describePermission(ask.req).verb : handoff ? "Take over the screen" : "Question";
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      {ask.type === "permission" ? (
        <ShieldQuestion size={15} className="shrink-0 text-info" />
      ) : handoff ? (
        <Hand size={15} className="shrink-0 text-info" />
      ) : (
        <MessageCircleQuestion size={15} className="shrink-0 text-info" />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[13.5px] font-semibold text-ink">{title}</span>
        {via !== null && (
          <span className="inline-flex max-w-[45%] shrink-0 items-center gap-1.5 truncate rounded-full border border-line px-2 py-px text-[11.5px] text-muted" title="Asked by a subagent">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: agentColor(via.agent) }} />
            <span className="truncate">
              {via.agent ? via.label : "Subagent"}
              {via.agent && <span className="max-sm:hidden"> subagent</span>}
            </span>
          </span>
        )}
      </div>
      {asks.length > 1 && (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11.5px] text-faint tabular-nums">
            {index + 1} of {asks.length}
          </span>
          <div role="tablist" aria-label="Waiting requests" className="flex items-center">
            {asks.map((a, i) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={i === index}
                aria-label={`Request ${i + 1}`}
                onClick={() => onPick(a.id)}
                className="grid h-5 w-3.5 place-items-center"
              >
                <span className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? "bg-info" : "bg-line-strong hover:bg-muted"}`} />
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={onCollapse}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show request" : "Minimise"}
        title={collapsed ? "Show" : "Minimise"}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink"
      >
        <ChevronDown size={14} className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
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

const Kbd = ({ children }: { children: string }) => <kbd className="ml-1.5 hidden font-sans text-[11px] opacity-60 sm:inline">{children}</kbd>;

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
              <pre className="selectable px-3 py-2.5 pr-9 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">{command}</pre>
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
          <ul className="selectable space-y-1 rounded-lg bg-sunken px-3 py-2 font-mono text-[12.5px] leading-snug text-ink-2">
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
        {save.length > 0 && (
          <div className="text-[12px] leading-relaxed break-words text-muted">
            Always allow remembers <span className="font-mono text-ink-2">{save.join(", ")}</span>
          </div>
        )}
      </div>
      {/* Phones: full-width buttons, the safe answer last. */}
      <div className="flex flex-col-reverse gap-2 px-3 pt-2 pb-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" disabled={sent} className="h-10 w-full sm:h-7 sm:w-auto" size="sm" onClick={() => answer("reject")} title={`Deny (${alt}⌫)`}>
          Deny
          <Kbd>{`${alt}⌫`}</Kbd>
        </Button>
        <Button variant="secondary" disabled={sent} className="h-10 w-full sm:h-7 sm:w-auto" size="sm" onClick={() => answer("always")} title={save.length ? `Always allow ${save.join(", ")} (${alt}${shift}↵)` : `Always allow (${alt}${shift}↵)`}>
          Always allow
          <Kbd>{`${alt}${shift}↵`}</Kbd>
        </Button>
        <Button variant="primary" disabled={sent} className="h-10 w-full sm:h-7 sm:w-auto" size="sm" onClick={() => answer("once")} title={`Allow once (${alt}↵)`}>
          Allow once
          <Kbd>{`${alt}↵`}</Kbd>
        </Button>
      </div>
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
  const btn = "h-10 w-full sm:h-7 sm:w-auto";

  return (
    <div ref={box}>
      <div className="scroll-quiet max-h-[50vh] space-y-2 overflow-y-auto px-3 pb-1">
        <div className="flex items-start gap-3 rounded-xl bg-sunken px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white hairline">
            <img src={appLogo(app.app)} alt="" width={18} height={18} draggable={false} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="selectable text-[13.5px] leading-snug font-medium break-words text-ink">{headline}</div>
            <div className="text-[12px] text-muted">{connect ? "They'll give you a link to connect it; nothing happens until you sign in." : `${app.appName} · ${app.action}`}</div>
            {preview && <div className="selectable mt-1.5 line-clamp-3 text-[13px] leading-relaxed break-words text-ink-2">“{preview}”</div>}
          </div>
        </div>
        {!connect && shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[12px] text-muted">{app.kind === "write" ? "Reaches" : app.kind === "delete" ? "Affects" : "From"}</span>
            {shown.map((t) => (
              <span key={t.id} title={t.id} className="selectable max-w-full truncate rounded-full px-2 py-0.5 text-[12.5px] text-ink-2 hairline">
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
        <div className="text-[12px] leading-relaxed break-words text-muted">
          “Always” lets them {doing}
          {reach.length ? ` ${reach.join(", ")} without asking` : connect ? " without asking" : " without asking, whatever it's for"}. You can change it in Permissions.
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 px-3 pt-2 pb-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" disabled={sent} className={btn} size="sm" onClick={() => answer("reject")} title={`Deny (${alt}⌫)`}>
          Deny
          <Kbd>{`${alt}⌫`}</Kbd>
        </Button>
        <Button variant="secondary" disabled={sent} className={btn} size="sm" onClick={() => void remember("everyone")} title="Remember this for every teammate">
          Always for every teammate
          {!agent && <Kbd>{`${alt}${shift}↵`}</Kbd>}
        </Button>
        {agent && (
          <Button variant="secondary" disabled={sent} className={btn} size="sm" onClick={() => void remember("agent")} title={`Remember this for ${name} (${alt}${shift}↵)`}>
            Always for {name}
            <Kbd>{`${alt}${shift}↵`}</Kbd>
          </Button>
        )}
        <Button variant="primary" disabled={sent} className={btn} size="sm" onClick={() => answer("once")} title={`Allow once (${alt}↵)`}>
          Allow once
          <Kbd>{`${alt}↵`}</Kbd>
        </Button>
      </div>
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
      <div className="flex h-8 min-w-0 items-center gap-1.5 border-b border-line pr-1 pl-2.5 text-[12.5px]">
        <FileIcon path={f.file} />
        <PathLabel path={f.file} className="font-mono text-[12px]" />
        {f.status === "added" && <span className="shrink-0 text-[11.5px] text-ok">new</span>}
        {f.status === "deleted" && <span className="shrink-0 text-[11.5px] text-danger">deleted</span>}
        {(f.additions || f.deletions) && (
          <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
            {f.additions ? <span className="text-ok">+{f.additions}</span> : null} {f.deletions ? <span className="text-danger">−{f.deletions}</span> : null}
          </span>
        )}
        <div className="flex-1" />
        <SplitToggle />
        {f.status !== "added" && <OpenButton label="Open file" onClick={() => open(f.file, firstChangedLine(f.patch))} />}
      </div>
      {f.patch ? <DiffView patch={f.patch} split={split} /> : <div className="px-3 py-2 text-[12.5px] text-faint">{f.status === "deleted" ? "Deletes the file" : "No textual changes"}</div>}
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
        <div className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          {!live ? "The agent is waiting. Tell it when you're done." : control ? "When you've finished on the screen, hand it back and the agent carries on." : "The agent is waiting. Take control and do it on its screen; what you type there goes straight to the machine, never through the chat."}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 px-3 pt-2 pb-3 sm:flex-row sm:justify-end">
        <Button size="sm" variant="ghost" disabled={sent} className="h-10 w-full sm:h-7 sm:w-auto" onClick={cancel} title={`Cancel (${alt}⌫)`}>
          Cancel
          <Kbd>{`${alt}⌫`}</Kbd>
        </Button>
        {control ? (
          <Button size="sm" variant="primary" disabled={sent} className="h-10 w-full sm:h-7 sm:w-auto" onClick={back} title={`Hand back (${alt}↵)`}>
            {live ? "I'm done, hand back" : "Done"}
            <Kbd>{`${alt}↵`}</Kbd>
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={sent} className="h-10 w-full sm:h-7 sm:w-auto" onClick={take} title={`Take control (${alt}↵)`}>
            Take control
            <Kbd>{`${alt}↵`}</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question
// ---------------------------------------------------------------------------

function FormStep({ form, inLayer }: { form: FormLite; inLayer?: boolean }) {
  const reply = useChat((s) => s.replyForm);
  const visible = form.fields.filter((f) => !f.hidden);
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(visible.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])));
  const [sent, setSent] = useState(false);
  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));
  const ready = visible.every((f) => !f.required || (values[f.key] !== undefined && values[f.key] !== "" && !(Array.isArray(values[f.key]) && (values[f.key] as unknown[]).length === 0)));
  const send = (v: Record<string, unknown> | null) => {
    if (sent || (v && !ready)) return;
    setSent(true);
    void reply(form, v).catch(() => setSent(false));
  };
  const box = useAnswerKeys({ once: () => send(values), deny: () => send(null) }, inLayer, !sent);

  return (
    <div ref={box}>
      <div className="scroll-quiet max-h-[50vh] overflow-y-auto px-3 pb-1">
        <div className="selectable text-[14.5px] leading-snug font-semibold break-words whitespace-pre-wrap">{form.title}</div>
        <div className="space-y-4 py-2.5">
          {visible.map((f) => (
            <div key={f.key}>
              {(f.title || visible.length > 1) && <div className="selectable mb-1 text-[13px] font-medium break-words text-ink-2">{f.title ?? f.key}</div>}
              {f.description && <div className="selectable mb-2 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-muted">{f.description}</div>}
              {f.options?.length ? (
                <div className="flex flex-wrap gap-1.5" role={f.type === "multiselect" ? "group" : "radiogroup"}>
                  {f.options.map((o) => {
                    const multi = f.type === "multiselect";
                    const cur = values[f.key];
                    const on = multi ? Array.isArray(cur) && cur.includes(o.value) : cur === o.value;
                    return (
                      <button
                        key={o.value}
                        role={multi ? "checkbox" : "radio"}
                        aria-checked={on}
                        onClick={() => set(f.key, multi ? (on ? (cur as string[]).filter((x) => x !== o.value) : [...((cur as string[]) ?? []), o.value]) : o.value)}
                        className={`max-w-full rounded-lg border px-3 py-2 text-left text-[13px] leading-snug break-words transition-colors sm:py-1.5 ${on ? "border-ink bg-ink text-bg" : "border-line-strong bg-raised text-ink hover:bg-hover"}`}
                      >
                        {o.label ?? o.value}
                      </button>
                    );
                  })}
                </div>
              ) : f.type === "boolean" ? (
                <div className="flex gap-1.5" role="radiogroup">
                  {[true, false].map((v) => (
                    <button key={String(v)} role="radio" aria-checked={values[f.key] === v} onClick={() => set(f.key, v)} className={`rounded-lg border px-3 py-1.5 text-[13px] ${values[f.key] === v ? "border-ink bg-ink text-bg" : "border-line-strong bg-raised hover:bg-hover"}`}>
                      {v ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  className="field h-10 w-full rounded-lg px-3 text-[16px] outline-none sm:h-9 sm:text-[14px]"
                  type={f.type === "number" || f.type === "integer" ? "number" : "text"}
                  placeholder={f.placeholder}
                  aria-label={f.title ?? f.key}
                  value={(values[f.key] as string) ?? ""}
                  onChange={(e) => set(f.key, f.type === "number" || f.type === "integer" ? Number(e.target.value) : e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(values);
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 px-3 pt-1 pb-3 sm:flex-row sm:justify-end">
        <Button size="sm" variant="ghost" disabled={sent} className="h-10 w-full sm:h-7 sm:w-auto" onClick={() => send(null)} title={`Skip (${alt}⌫)`}>
          Skip
          <Kbd>{`${alt}⌫`}</Kbd>
        </Button>
        <Button size="sm" variant="primary" className="h-10 w-full sm:h-7 sm:w-auto" disabled={!ready || sent} onClick={() => send(values)} title={`Send (${alt}↵)`}>
          Send
          <Kbd>{`${alt}↵`}</Kbd>
        </Button>
      </div>
    </div>
  );
}

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
