import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, AtSign, FileCode2, ListEnd, Navigation, Paperclip, Plus, Slash, Square, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CommandInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { AgentPicker, ModelPicker } from "./Pickers";
import { Spinner } from "../ui/AgentClock";
import { toast } from "../../state/ui";
import { useAgentName, useMascot, useTeammates } from "../../state/teammates";
import { useFace } from "../../state/face";
import { useDoing } from "../../state/tiers";
import { Bird } from "../ui/Bird";
import { FEET, FIT, type BirdId } from "../../lib/flock/birds";
import { cycleAgent } from "../../lib/actions";
import { ContextMeter } from "./SessionExtras";
import type { FsEntry } from "../../lib/opencode/client";
import { isMod } from "../../hooks/useShortcuts";
import { layerOpen } from "../../lib/layers";
import { Popover, MenuItem } from "../ui/Popover";
import { readyAttachments, useAttachments } from "../../state/attachments";
import { AttachmentTray } from "./Attachments";

/** App-level commands, handled here rather than by the server. */
const BUILTIN: { name: string; description: string; needsSession: boolean }[] = [
  { name: "compact", description: "Summarize the conversation to free up context", needsSession: true },
  { name: "undo", description: "Undo the last message and its file changes", needsSession: true },
  { name: "redo", description: "Bring back what you undid", needsSession: true },
  { name: "fork", description: "Continue this conversation in a new session", needsSession: true },
  { name: "new", description: "Start a new session", needsSession: false },
];

type Suggest = { kind: "command"; items: CommandInfo[]; query: string } | { kind: "file"; items: FsEntry[]; query: string; start: number };

/**
 * The prompt box. Enter sends (Shift+Enter newline; on touch devices Enter
 * inserts a newline). "/" opens commands, "@" mentions files.
 *
 * After DitherUI's prompt input: the writing card is raised, its tools sit on
 * their own row under the text (+ and modes on the left, model and send on the
 * right), and a `tray` (the folder and machine a new session runs on) is a
 * recessed strip the card sits in. Ice goes to focus and to the one action
 * that's next: send, or Stop while a run has nothing to steer it with.
 */
export function Composer({ sessionId, placeholder = "Do anything…", autoFocus = false, compact = false, tray, onSent }: { sessionId: string | null; placeholder?: string; autoFocus?: boolean; compact?: boolean; tray?: ReactNode; onSent?: (id: string) => void }) {
  const draftKey = sessionId ?? "new";
  const draft = useChat((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChat((s) => s.setDraft);
  const busy = useChat((s) => (sessionId ? !!s.busy[sessionId] : false));
  const doer = useAgentName(useChat((s) => (sessionId ? s.sessions[sessionId]?.agent : undefined))) || "the agent";
  const delivery = useChat((s) => s.delivery);
  const setDeliveryMode = useChat((s) => s.setDeliveryMode);
  const shellMode = !!sessionId && draft.startsWith("!");
  const send = useChat((s) => s.send);
  const pickedAgent = useChat((s) => s.pickedAgent);
  const sessionAgent = useChat((s) => (sessionId ? s.sessions[sessionId]?.agent : undefined));
  const roster = useTeammates((s) => s.byId);
  // Teammates are the agents: a draft needs one before it can be sent.
  const needsAgent = !sessionAgent && !pickedAgent && roster !== null;
  const interrupt = useChat((s) => s.interrupt);
  const client = useChat((s) => s.client);
  const projectDir = useChat((s) => s.projectDir);
  // Uploads land in the folder the session works in (a new one: the folder it'll start in).
  const root = useChat((s) => (sessionId ? s.sessions[sessionId]?.location.directory : null) || s.projectDir || s.homeDir || "");
  const pending = useAttachments((s) => s.byKey[draftKey]);
  const addFiles = useAttachments((s) => s.add);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const attached = pending?.filter((a) => a.status === "ready").length ?? 0;
  const uploading = pending?.some((a) => a.status === "uploading") ?? false;
  const connected = useConnection((s) => s.status === "ready");
  const catalog = useConnection((s) => s.catalog);
  const catalogError = useConnection((s) => s.catalogError);
  const retryConnection = useConnection((s) => s.retry);
  const models = useChat((s) => s.models);
  // Send needs the catalog: a connected listener with no models would accept
  // the text and fail the prompt. Models already in hand also count: the
  // readiness budget can expire a moment before the catalog actually lands,
  // and a later refresh must not leave send disabled for the rest of the
  // session. A shell command (`!…`) doesn't need a model, so it stays sendable.
  const ready = connected && (shellMode || catalog === "ready" || models.length > 0);
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<CommandInfo[] | null>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const touch = useMemo(() => matchMedia("(pointer: coarse)").matches, []);

  const resize = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    const max = compact ? 160 : 280;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, max) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [compact]);

  useLayoutEffect(resize, [draft, resize]);
  // Opening a session puts the cursor here. A frame late, so a menu or the palette that opened it hands focus back first.
  // Never on touch: the keyboard would cover the conversation you just opened.
  useEffect(() => {
    if (!autoFocus || touch) return;
    const f = requestAnimationFrame(() => ta.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(f);
  }, [autoFocus, sessionId, touch]);

  // Global shortcut: "/" or Cmd/Ctrl+L focuses the composer.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (layerOpen()) return;
      if ((e.key.toLowerCase() === "l" && isMod(e) && !e.shiftKey && !e.altKey) || (!typing && e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        ta.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadCommands = useCallback(async () => {
    if (commands || !client) return commands ?? [];
    const list = await client.commands().catch(() => [] as CommandInfo[]);
    setCommands(list);
    return list;
  }, [client, commands]);

  const fileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSuggest = useCallback(
    async (text: string, caret: number) => {
      const before = text.slice(0, caret);
      const slash = /^\/(\S*)$/.exec(before);
      if (slash) {
        const server = await loadCommands();
        const builtins = BUILTIN.filter((b) => sessionId || !b.needsSession).map((b) => ({ name: b.name, description: b.description }) as CommandInfo);
        const list = [...builtins, ...server.filter((c) => !BUILTIN.some((b) => b.name === c.name))];
        const q = slash[1].toLowerCase();
        const items = list.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10);
        setSuggest(items.length ? { kind: "command", items, query: q } : null);
        setSel(0);
        return;
      }
      const at = /(^|\s)@([\w./-]*)$/.exec(before);
      if (at && client) {
        const q = at[2];
        const start = caret - q.length - 1;
        if (fileTimer.current) clearTimeout(fileTimer.current);
        fileTimer.current = setTimeout(async () => {
          const items = q ? await client.findFiles(q, projectDir ?? undefined, 8).catch(() => []) : [];
          setSuggest({ kind: "file", items, query: q, start });
          setSel(0);
        }, 120);
        return;
      }
      setSuggest(null);
    },
    [client, loadCommands, projectDir, sessionId],
  );

  async function submit() {
    const text = draft.trim();
    // Refuse before touching the draft: a cleared box with nothing sent reads
    // as a lost message. The connection/catalog state is the reason, and the
    // inline state below the box says so.
    if ((!text && !attached) || uploading || sending || !ready || needsAgent || !client) return;
    const cmd = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
    const builtin = cmd && BUILTIN.find((b) => b.name === cmd[1] && (sessionId || !b.needsSession));
    // A new chat's text stays in the box until its session takes the screen; send clears it then.
    const opening = !sessionId && !builtin;
    let opened: string | null = null;
    setSending(true);
    if (!opening) setDraft(draftKey, "");
    setSuggest(null);
    try {
      if (builtin) {
        await runBuiltin(builtin.name, sessionId);
      } else if (shellMode && sessionId) {
        await useChat.getState().runShell(sessionId, text.slice(1).trim());
      } else if (cmd && commands?.some((c) => c.name === cmd[1]) && sessionId && client) {
        await client.command(sessionId, cmd[1], cmd[2]);
      } else {
        const list = useAttachments.getState().byKey[draftKey] ?? [];
        const attachments = readyAttachments(list);
        const previews = Object.fromEntries(list.filter((a) => a.path && a.preview).map((a) => [a.path!, a.preview!]));
        if (!opening) useAttachments.getState().clear(draftKey);
        try {
          const id = await send(text, {
            sessionId,
            attachments,
            previews,
            onOpen: (id) => {
              opened = id;
              useAttachments.getState().clear(draftKey);
              onSent?.(id);
            },
          });
          if (id && !opened) onSent?.(id);
        } catch (e) {
          useAttachments.getState().restore(opened ?? draftKey, attachments, Object.fromEntries(list.filter((a) => a.preview).map((a) => [a.name, a.preview!])));
          throw e;
        }
      }
    } catch (e) {
      // Failed after the switch: the words go back in the session's own box.
      setDraft(opened ?? draftKey, text);
      if (cmd) toast({ tone: "error", title: "Command failed", body: (e as Error).message });
    } finally {
      setSending(false);
      requestAnimationFrame(() => ta.current?.focus());
    }
  }

  async function runBuiltin(name: string, id: string | null) {
    const chat = useChat.getState();
    if (name === "new") return chat.open(null);
    if (!id) return;
    if (name === "compact") return chat.compact(id);
    if (name === "undo") return chat.undo(id);
    if (name === "redo") return chat.redo(id);
    if (name === "fork") return void chat.fork(id, null);
  }

  function pick(i: number) {
    if (!suggest) return;
    if (suggest.kind === "command") {
      const c = suggest.items[i];
      if (c) setDraft(draftKey, `/${c.name} `);
    } else {
      const f = suggest.items[i];
      if (f) {
        const el = ta.current!;
        const caret = el.selectionStart;
        const next = draft.slice(0, suggest.start) + "@" + f.path + " " + draft.slice(caret);
        setDraft(draftKey, next);
      }
    }
    setSuggest(null);
    ta.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggest && suggest.items.length) {
      if (e.key === "ArrowDown") return e.preventDefault(), setSel((s) => (s + 1) % suggest.items.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setSel((s) => (s - 1 + suggest.items.length) % suggest.items.length);
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) return e.preventDefault(), pick(sel);
      if (e.key === "Escape") return e.preventDefault(), setSuggest(null);
    }
    if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Tab" && !e.altKey && !e.metaKey && !e.ctrlKey) {
      // Like the OpenCode TUI: Tab / Shift+Tab switch agents. Esc leaves the composer.
      e.preventDefault();
      cycleAgent(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (busy && sessionId) void interrupt(sessionId);
      else ta.current?.blur();
    }
  }

  const canSend = (!!draft.trim() || (attached > 0 && !shellMode)) && !uploading && ready && !sending && !needsAgent;
  // A run is never without its Stop; a draft adds Steer beside it instead of replacing it.
  const showStop = busy;
  const showSend = !busy || !!draft.trim() || attached > 0;
  // In a session the header says who you're talking to (and their bird perches on the box), so the tools skip the agent.
  const inline = !!sessionId;

  /** Start the draft with a trigger character and open its suggestions. */
  function insert(kind: "file" | "command" | "shell" | "upload") {
    if (kind === "upload") return picker.current?.click();
    const next = kind === "file" ? draft + (draft && !draft.endsWith(" ") ? " @" : "@") : kind === "command" ? "/" + draft.replace(/^\//, "") : "!" + draft.replace(/^!/, "");
    setDraft(draftKey, next);
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      const caret = kind === "file" ? next.length : 1;
      el.setSelectionRange(caret, caret);
      void updateSuggest(next, caret);
    });
  }

  const status = (
    <>
      {connected && catalog === "warming" && <div className="px-4 pb-2.5 text-[12px] text-muted">Loading models and agents…</div>}
      {connected && catalog === "degraded" && !models.length && (
        <div className="flex items-center gap-2 px-4 pb-2.5 text-[12px] text-muted">
          <span className="min-w-0 flex-1" title={catalogError}>
            Models didn't load, so sending is paused.
          </span>
          <button onClick={retryConnection} className="shrink-0 rounded-md px-1.5 py-0.5 text-ink-2 transition-colors hover:bg-hover hover:text-ink">
            Try again
          </button>
        </div>
      )}
    </>
  );

  const field = (
    <textarea
      ref={ta}
      rows={1}
      value={draft}
      placeholder={
        !connected
          ? "Connecting…"
          : busy
            ? delivery === "steer"
              ? compact ? `Steer ${doer}` : `Steer ${doer}…`
              : compact ? "Queue a message" : `Queue a follow-up for ${doer}…`
            : needsAgent
              ? "Add a teammate to start"
              : catalog === "degraded" && !models.length
                ? "Models didn't load"
                : catalog !== "ready" && !models.length
                  ? "Loading models…"
                  : placeholder
      }
      onChange={(e) => {
        setDraft(draftKey, e.target.value);
        void updateSuggest(e.target.value, e.target.selectionStart);
      }}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        // A pasted screenshot (or copied files) is an upload; pasted text stays text.
        const files = Array.from(e.clipboardData.files);
        if (!files.length) return;
        e.preventDefault();
        addFiles(draftKey, files, root);
      }}
      aria-label="Message"
      // Starting a session: the words are on their way, so they can't change under it.
      readOnly={sending && !sessionId}
      data-composer
      onBlur={() => setTimeout(() => setSuggest(null), 120)}
      // A new session's card is roomier: it's the whole page. Phones type at 16px so iOS doesn't zoom in.
      className={`scroll-quiet block w-full resize-none bg-transparent leading-[1.5] text-ink outline-none placeholder:text-faint ${shellMode ? "font-mono text-[14px]" : compact ? "text-[16px]" : "text-[15px]"} ${compact ? "px-4 pt-3" : "px-4 pt-3.5"} ${!inline && !compact ? "min-h-[72px]" : ""}`}
      spellCheck
    />
  );

  // Phones get thumb-sized tools; the row has room since it isn't sharing a line with the text.
  const round = compact ? "h-10 w-10" : "h-8 w-8";
  const tools = (
    <div className={`flex items-center gap-1 ${compact ? "px-2 pt-1.5 pb-2" : "px-2 pt-1 pb-2"}`} onClick={(e) => e.target === e.currentTarget && ta.current?.focus()}>
      <AddMenu shell={!!sessionId} onPick={insert} size={round} />
      {shellMode ? (
        // The mode shows as a pill, the way DitherUI shows its modes; tapping it goes back to a message.
        <button
          onClick={() => setDraft(draftKey, draft.replace(/^!\s*/, ""))}
          title="Runs in the session's folder; the output is shared with the agent. Tap to write a message instead."
          className={`chip flex shrink-0 items-center gap-1.5 rounded-full pr-2 pl-2.5 text-ink ${compact ? "h-9 text-[14px]" : "h-7 text-[13px]"}`}
        >
          <SquareTerminal size={14} className="text-accent-ink" /> Shell
          <X size={13} className="text-muted" />
        </button>
      ) : (
        !inline && <AgentPicker sessionId={sessionId} compact={compact} />
      )}
      {/* Steer or queue only matters once there's something to send; until then the placeholder says which. */}
      {busy && sessionId && draft.trim() && !shellMode && (
        <button
          onClick={() => setDeliveryMode(delivery === "steer" ? "queue" : "steer")}
          title={delivery === "steer" ? "Steer: the agent reads your message after its current step. Tap to queue it for after the run instead." : "Queue: the agent reads your message when the run finishes. Tap to steer instead."}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 text-ink-2 hairline transition-colors hover:bg-hover hover:text-ink ${compact ? "h-9 text-[14px]" : "h-7 text-[13px]"}`}
        >
          {delivery === "steer" ? <Navigation size={13} /> : <ListEnd size={14} />}
          {delivery === "steer" ? "Steer" : "Queue"}
        </button>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1">
        {sessionId && <ContextMeter sessionId={sessionId} compact={compact} />}
        <ModelPicker sessionId={sessionId} compact={compact} />
        {/* Stop holds its place for the whole run; a draft brings send (as Steer or Queue) back beside it, and takes the ice. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {showStop && (
            <motion.button
              key="stop"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={() => sessionId && interrupt(sessionId)}
              className={`grid shrink-0 place-items-center rounded-full ${round} ${showSend ? "text-ink hairline hover:bg-hover" : "bg-accent text-on-accent hover:brightness-110"}`}
              aria-label="Stop"
              title="Stop (Esc)"
            >
              <Square size={compact ? 12 : 11} fill="currentColor" />
            </motion.button>
          )}
          {showSend && (
            <motion.button
              key="send"
              initial={{ scale: 0.85, opacity: 0 }}
              // Dimmed ice until there's something to send (motion owns opacity here, so not a CSS variant).
              animate={{ scale: 1, opacity: canSend ? 1 : 0.35 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={() => void submit()}
              disabled={!canSend}
              className={`grid shrink-0 place-items-center rounded-full bg-accent text-on-accent enabled:hover:brightness-110 ${round}`}
              aria-label={busy ? (delivery === "steer" ? "Steer" : "Queue") : "Send"}
              title={shellMode ? "Run (Enter)" : busy ? (delivery === "steer" ? "Steer (Enter)" : "Queue (Enter)") : "Send (Enter)"}
            >
              {sending ? <Spinner size={15} /> : <ArrowUp size={compact ? 19 : 17} strokeWidth={2.25} />}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  const card = (
    <div
      className={`composer surface-float relative bg-raised ${compact ? "rounded-[22px]" : "rounded-[20px]"} ${dragging ? "ring-2 ring-accent" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) ta.current?.focus();
      }}
      // Files dropped on the box are uploaded like picked ones.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(draftKey, Array.from(e.dataTransfer.files), root);
      }}
    >
      <AttachmentTray boxKey={draftKey} />
      {field}
      {tools}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          addFiles(draftKey, files, root);
          ta.current?.focus();
        }}
      />
      {status}
    </div>
  );

  return (
    <div className="relative">
      <AnimatePresence>
        {suggest && (suggest.items.length > 0 || suggest.kind === "file") && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.1 } }}
            className="surface-overlay absolute inset-x-2 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-pop"
          >
            {suggest.items.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-muted">{suggest.query ? "No matching files" : "Type to search files"}</div>
            ) : suggest.kind === "command" ? (
              suggest.items.map((c, i) => (
                <button key={c.name} onMouseDown={(e) => (e.preventDefault(), pick(i))} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === sel ? "bg-active" : ""}`}>
                  <Slash size={14} className="text-muted" />
                  <span className="font-mono text-[13px]">{c.name}</span>
                  <span className="truncate text-[12px] text-muted">{c.description}</span>
                </button>
              ))
            ) : (
              suggest.items.map((f, i) => (
                <button key={f.path} onMouseDown={(e) => (e.preventDefault(), pick(i))} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === sel ? "bg-active" : ""}`}>
                  <FileCode2 size={14} className="text-muted" />
                  <span className="truncate font-mono text-[12px]">{f.path}</span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {tray ? (
        // The card sits in a recessed tray; the strip under it says where the session will run.
        <div className={`well p-1 ${compact ? "rounded-[26px]" : "rounded-[24px]"}`}>
          {card}
          <div className="flex min-h-9 flex-wrap items-center gap-1 px-1.5 pt-1 text-[13px]">{tray}</div>
        </div>
      ) : (
        card
      )}
    </div>
  );
}

/** The bird perched on a session's reply box, if its agent has one (plain agents don't). */
export function usePerched(sessionId: string) {
  // A lead's part runs in a child session the sidebar doesn't list; it knows who's on it.
  return useMascot(useChat((s) => s.sessions[sessionId]?.agent ?? s.delegated[sessionId]));
}

/**
 * Who you're talking to, standing on the top right of the reply box (or
 * whatever is stacked on it): what they're doing, eyes on what you type, a
 * nod per word. Put it in the box's positioned column; the thread ends clear
 * of it (see `usePerched`).
 */
export function Perch({ sessionId, size }: { sessionId: string; size: number }) {
  const mate = usePerched(sessionId);
  const name = useAgentName(useChat((s) => s.sessions[sessionId]?.agent ?? s.delegated[sessionId]));
  const state = useFace(sessionId);
  const words = useChat((s) => (s.drafts[sessionId] ?? "").trim().split(/\s+/).filter(Boolean).length);
  // It follows the turn's status line: a nod at each new step, typing while a file's being written.
  const doing = useDoing(sessionId, useChat((s) => !!s.busy[sessionId]));
  const [steps, setSteps] = useState(0);
  useEffect(() => {
    if (doing) setSteps((n) => n + 1);
  }, [doing]);
  const mood = state === "working" && /^(Editing|Writing) /.test(doing) ? "type" : undefined;
  if (!mate) return null;
  // Feet on the card's edge (its 1px ring), clear of its rounded corner.
  const id = mate.bird as BirdId;
  const drop = FIT[id] ? (FEET[id] * size) / FIT[id][3] + 0.6 : 2;
  return (
    <div className="absolute right-6 bottom-full z-10 flex" style={{ transform: `translateY(${drop.toFixed(1)}px)` }}>
      <Bird bird={mate.bird} seed={mate.face} size={size} state={state} mood={mood} attentive={words > 0} pulse={words + steps} doze={false} interactive label={name || undefined} />
    </div>
  );
}

/** The +: the things the box can do besides plain text. */
function AddMenu({ shell, size, onPick }: { shell: boolean; size: string; onPick: (kind: "file" | "command" | "shell" | "upload") => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const choose = (kind: "file" | "command" | "shell" | "upload") => {
    setOpen(false);
    onPick(kind);
  };
  return (
    <>
      <button ref={anchor} onClick={() => setOpen((v) => !v)} aria-label="Add" aria-haspopup="menu" aria-expanded={open} title={shell ? "Upload, files, commands, shell" : "Upload, files and commands"} className={`grid shrink-0 place-items-center rounded-full text-ink-2 hairline transition-colors hover:bg-hover hover:text-ink ${size} ${open ? "bg-hover text-ink" : ""}`}>
        <Plus size={18} className={`transition-transform duration-200 ${open ? "rotate-45" : ""}`} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="top-start" width={240} label="Add">
        <div role="menu" className="p-1.5">
          <MenuItem icon={<Paperclip size={15} />} label="Upload files" onClick={() => choose("upload")} />
          <MenuItem icon={<AtSign size={15} />} label="Mention a file" right={<kbd className="text-[12px] text-faint">@</kbd>} onClick={() => choose("file")} />
          <MenuItem icon={<Slash size={15} />} label="Run a command" right={<kbd className="text-[12px] text-faint">/</kbd>} onClick={() => choose("command")} />
          {shell && <MenuItem icon={<SquareTerminal size={15} />} label="Run in the shell" right={<kbd className="text-[12px] text-faint">!</kbd>} onClick={() => choose("shell")} />}
        </div>
      </Popover>
    </>
  );
}
