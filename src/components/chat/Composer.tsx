import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, AtSign, FileCode2, Slash, Square, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CommandInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { AgentPicker, ModelPicker } from "./Pickers";
import { Spinner } from "../ui/AgentClock";
import { toast } from "../../state/ui";
import { cycleAgent } from "../../lib/actions";
import { ContextMeter } from "./SessionExtras";
import type { FsEntry } from "../../lib/opencode/client";

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
 */
export function Composer({ sessionId, placeholder = "Do anything…", autoFocus = false, compact = false, onSent }: { sessionId: string | null; placeholder?: string; autoFocus?: boolean; compact?: boolean; onSent?: (id: string) => void }) {
  const draftKey = sessionId ?? "new";
  const draft = useChat((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChat((s) => s.setDraft);
  const busy = useChat((s) => (sessionId ? !!s.busy[sessionId] : false));
  const delivery = useChat((s) => s.delivery);
  const setDeliveryMode = useChat((s) => s.setDeliveryMode);
  const shellMode = !!sessionId && draft.startsWith("!");
  const send = useChat((s) => s.send);
  const interrupt = useChat((s) => s.interrupt);
  const client = useChat((s) => s.client);
  const projectDir = useChat((s) => s.projectDir);
  const ready = useConnection((s) => s.status === "ready");
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
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
  useEffect(() => {
    if (autoFocus && !touch) ta.current?.focus();
  }, [autoFocus, sessionId, touch]);

  // Global shortcut: "/" or Cmd/Ctrl+L focuses the composer.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if ((e.key === "l" && (e.metaKey || e.ctrlKey)) || (!typing && e.key === "/" && !e.metaKey)) {
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
    if (!text || sending || !ready) return;
    const cmd = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
    setSending(true);
    setDraft(draftKey, "");
    setSuggest(null);
    try {
      const builtin = cmd && BUILTIN.find((b) => b.name === cmd[1] && (sessionId || !b.needsSession));
      if (builtin) {
        await runBuiltin(builtin.name, sessionId);
      } else if (shellMode && sessionId) {
        await useChat.getState().runShell(sessionId, text.slice(1).trim());
      } else if (cmd && commands?.some((c) => c.name === cmd[1]) && sessionId && client) {
        await client.command(sessionId, cmd[1], cmd[2]);
      } else {
        const id = await send(text, { sessionId });
        if (id) onSent?.(id);
      }
    } catch (e) {
      setDraft(draftKey, text);
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

  const canSend = !!draft.trim() && ready && !sending;
  const showStop = busy && !draft.trim();

  return (
    <div className="relative">
      <AnimatePresence>
        {suggest && (suggest.items.length > 0 || suggest.kind === "file") && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.1 } }}
            className="surface-overlay absolute inset-x-2 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-line bg-raised p-1 shadow-pop"
          >
            {suggest.items.length === 0 ? (
              <div className="px-3 py-2 text-[12.5px] text-muted">{suggest.query ? "No matching files" : "Type to search files"}</div>
            ) : suggest.kind === "command" ? (
              suggest.items.map((c, i) => (
                <button key={c.name} onMouseDown={(e) => (e.preventDefault(), pick(i))} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === sel ? "bg-active" : ""}`}>
                  <Slash size={14} className="text-muted" />
                  <span className="font-mono text-[13px]">{c.name}</span>
                  <span className="truncate text-[12.5px] text-muted">{c.description}</span>
                </button>
              ))
            ) : (
              suggest.items.map((f, i) => (
                <button key={f.path} onMouseDown={(e) => (e.preventDefault(), pick(i))} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === sel ? "bg-active" : ""}`}>
                  <FileCode2 size={14} className="text-muted" />
                  <span className="truncate font-mono text-[12.5px]">{f.path}</span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`surface-float relative rounded-3xl border bg-raised shadow-float transition-colors duration-150 ${focused ? "border-line-strong" : "border-line"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) ta.current?.focus();
        }}
      >
        <textarea
          ref={ta}
          rows={1}
          value={draft}
          placeholder={!ready ? "Connecting…" : busy ? (delivery === "steer" ? "Steer the agent…" : "Queue a follow-up…") : placeholder}
          onChange={(e) => {
            setDraft(draftKey, e.target.value);
            void updateSuggest(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setTimeout(() => setSuggest(null), 120);
          }}
          className={`scroll-quiet block w-full resize-none bg-transparent px-4 pt-3.5 leading-[1.5] text-ink outline-none placeholder:text-faint ${shellMode ? "font-mono text-[14px]" : "text-[15px]"} ${compact ? "pb-1" : "min-h-[56px] pb-1.5"}`}
          spellCheck
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <button
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
            aria-label="Mention a file"
            title="Mention a file (@)"
            onClick={() => {
              const next = draft + (draft && !draft.endsWith(" ") ? " @" : "@");
              setDraft(draftKey, next);
              ta.current?.focus();
              void updateSuggest(next, next.length);
            }}
          >
            <AtSign size={17} />
          </button>
          {shellMode ? (
            <span className="flex h-8 items-center gap-1.5 px-2 text-[13px] text-ink-2" title="Runs in the session's folder; the output is shared with the agent">
              <SquareTerminal size={14} className="text-muted" /> Shell
            </span>
          ) : (
            <AgentPicker sessionId={sessionId} />
          )}
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {busy && sessionId && (
              <button
                onClick={() => setDeliveryMode(delivery === "steer" ? "queue" : "steer")}
                title={delivery === "steer" ? "Steer: the agent reads your message after its current step. Click to queue it for after the run instead." : "Queue: the agent reads your message when the run finishes. Click to steer instead."}
                className="h-7 rounded-full px-2.5 text-[12.5px] text-ink-2 hairline transition-colors hover:bg-hover hover:text-ink"
              >
                {delivery === "steer" ? "Steer" : "Queue"}
              </button>
            )}
            {sessionId && <ContextMeter sessionId={sessionId} />}
            <ModelPicker sessionId={sessionId} compact={compact} />
            <AnimatePresence mode="wait" initial={false}>
              {showStop ? (
                <motion.button
                  key="stop"
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => sessionId && interrupt(sessionId)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-ink text-bg hover:opacity-85"
                  aria-label="Stop"
                  title="Stop (Esc)"
                >
                  <Square size={11} fill="currentColor" />
                </motion.button>
              ) : (
                <motion.button
                  key="send"
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => void submit()}
                  disabled={!canSend}
                  className="grid h-8 w-8 place-items-center rounded-full bg-ink text-bg transition-opacity hover:opacity-85 disabled:bg-active disabled:text-muted"
                  aria-label={busy ? (delivery === "steer" ? "Steer" : "Queue") : "Send"}
                  title={shellMode ? "Run (Enter)" : busy ? (delivery === "steer" ? "Steer (Enter)" : "Queue (Enter)") : "Send (Enter)"}
                >
                  {sending ? <Spinner size={15} /> : <ArrowUp size={16} strokeWidth={2.2} />}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
