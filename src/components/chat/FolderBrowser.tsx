/**
 * Pick any folder on the server: type a path (with completion) or walk the
 * tree. The path field is the whole UI — what's before the last "/" is the
 * folder being listed, what's after it filters the list.
 *
 *   ↑ ↓      move through the list
 *   Tab →    complete into the highlighted folder
 *   Enter    open the highlighted folder (or use this one when nothing is typed)
 *   ⌘Enter   use the folder shown
 */
import { ChevronRight, CornerLeftUp, Eye, EyeOff, Folder, FolderPlus, Home as HomeIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { toast } from "../../state/ui";
import { isMod, kbd } from "../../hooks/useShortcuts";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";

type Entry = { name: string; path: string };

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function FolderBrowser({
  open,
  onClose,
  onPick,
  start,
  compact,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (dir: string) => void;
  start?: string | null;
  compact: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} compact={compact} title="Choose a folder">
      {open && <Browser start={start} onPick={onPick} onCancel={onClose} compact={compact} />}
    </Sheet>
  );
}

function Browser({ start, onPick, onCancel, compact }: { start?: string | null; onPick: (dir: string) => void; onCancel: () => void; compact: boolean }) {
  const client = useChat((s) => s.client);
  const home = trim(useChat((s) => s.homeDir) ?? "/");
  const tilde = (p: string) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);
  const expand = (p: string) => (p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p);

  const [query, setQuery] = useState(() => `${tilde(trim(start || home))}/`);
  const cut = query.lastIndexOf("/");
  const dirShown = cut <= 0 ? (query.startsWith("/") ? "/" : query.startsWith("~") ? "~" : "/") : query.slice(0, cut);
  const leaf = cut === -1 ? (query.startsWith("~") ? "" : query) : query.slice(cut + 1);
  const dir = trim(expand(dirShown)) || "/";

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [hi, setHi] = useState(0);
  const [making, setMaking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!client) return;
    let off = false;
    setError(null);
    const t = setTimeout(() => {
      setEntries(null);
      client
        .listFolders(dir, home)
        .then((r) => !off && setEntries(r.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))))
        .catch((e) => {
          if (off) return;
          setEntries([]);
          setError((e as Error).message);
        });
    }, 120);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [client, dir, home, reload]);

  const shown = useMemo(() => {
    const f = leaf.toLowerCase();
    const showDot = hidden || f.startsWith(".");
    const base = (entries ?? []).filter((e) => showDot || !e.name.startsWith("."));
    if (!f) return base;
    // Prefix matches first, then anywhere.
    const pre = base.filter((e) => e.name.toLowerCase().startsWith(f));
    const mid = base.filter((e) => !e.name.toLowerCase().startsWith(f) && e.name.toLowerCase().includes(f));
    return [...pre, ...mid];
  }, [entries, leaf, hidden]);

  useEffect(() => setHi(0), [dir, leaf]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const go = (path: string) => {
    setQuery(`${tilde(trim(path))}/`.replace(/^\/\/$/, "/"));
    input.current?.focus();
  };
  const up = () => {
    if (dir === "/") return;
    go(dir.slice(0, dir.lastIndexOf("/")) || "/");
  };

  const crumbs = useMemo(() => {
    const out: { label: string; path: string }[] = [];
    const inHome = dir === home || dir.startsWith(home + "/");
    let acc = inHome ? home : "";
    out.push(inHome ? { label: "~", path: home } : { label: "/", path: "/" });
    const rest = inHome ? dir.slice(home.length) : dir;
    for (const seg of rest.split("/").filter(Boolean)) {
      acc = `${acc}/${seg}`.replace(/^\/\//, "/");
      out.push({ label: seg, path: acc });
    }
    return out;
  }, [dir, home]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const cur = shown[hi];
    if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(shown.length - 1, h + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
    else if ((e.key === "Tab" && !e.shiftKey) || (e.key === "ArrowRight" && e.currentTarget.selectionStart === query.length && cur)) {
      if (!cur) return;
      e.preventDefault();
      go(cur.path);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isMod(e)) return onPick(dir);
      if (leaf && cur) go(cur.path);
      else if (!leaf) onPick(dir);
    } else if (e.key === "Backspace" && !leaf && query.endsWith("/") && query.length > 1 && e.currentTarget.selectionStart === query.length && !e.altKey && !e.metaKey) {
      // One keystroke goes up a level instead of eating the "/" and filtering the parent.
      e.preventDefault();
      up();
    }
  };

  async function mkdir(name: string) {
    if (!client) return;
    const clean = name.trim().replace(/[/\\]+/g, "-");
    if (!clean) return;
    setBusy(true);
    try {
      const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
      const target = `${dir === "/" ? "" : dir}/${clean}`;
      const r = await client.exec(`mkdir -p -- ${q(target)}`, { timeoutMs: 15_000 });
      if (r.exit !== 0) throw new Error(r.output.slice(0, 200) || "mkdir failed");
      setMaking(null);
      setReload((n) => n + 1);
      go(target);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't create the folder", body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const name = dir === home ? "home" : dir === "/" ? "/" : dir.split("/").pop();

  return (
    <div className="flex min-h-0 flex-col" style={{ height: compact ? "70vh" : "min(560px, 70vh)" }}>
      <div className="space-y-2 border-b border-line px-4 pt-3 pb-3">
        <nav aria-label="Folder path" className="scroll-quiet flex items-center gap-0.5 overflow-x-auto text-[12.5px] whitespace-nowrap text-muted">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight size={12} className="shrink-0 text-faint" />}
              <button
                className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-hover hover:text-ink ${i === crumbs.length - 1 ? "font-medium text-ink" : ""}`}
                onClick={() => go(c.path)}
                aria-current={i === crumbs.length - 1 ? "location" : undefined}
              >
                {c.label === "~" ? <HomeIcon size={12} aria-label="Home" /> : c.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <div className="field flex h-9 min-w-0 flex-1 items-center rounded-lg px-2.5">
            <input
              ref={input}
              data-autofocus
              role="combobox"
              aria-expanded
              aria-controls="folder-list"
              aria-activedescendant={shown[hi] ? `folder-${hi}` : undefined}
              aria-label="Folder path"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={`min-w-0 flex-1 bg-transparent font-mono outline-none ${compact ? "text-[16px]" : "text-[13px]"}`}
            />
          </div>
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink disabled:opacity-40" aria-label="Up one folder" title="Up one folder" disabled={dir === "/"} onClick={up}>
            <CornerLeftUp size={15} />
          </button>
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-pressed={hidden} aria-label={hidden ? "Hide hidden folders" : "Show hidden folders"} title={hidden ? "Hide hidden folders" : "Show hidden folders"} onClick={() => setHidden((v) => !v)}>
            {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        </div>
      </div>

      <div ref={list} id="folder-list" role="listbox" aria-label={`Folders in ${tilde(dir)}`} className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-1.5">
        {entries === null ? (
          <div className="flex justify-center py-6 text-muted">
            <Spinner />
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted">{error}</div>
        ) : shown.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted">{leaf ? `No folder here matches “${leaf}”.` : "No folders inside. You can use this one."}</div>
        ) : (
          shown.map((e, i) => (
            <div
              key={e.path}
              id={`folder-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === hi}
              onMouseMove={() => setHi(i)}
              onClick={() => go(e.path)}
              className={`group flex items-center gap-2.5 rounded-lg px-2.5 ${compact ? "py-2.5" : "py-1.5"} text-[13.5px] ${i === hi ? "bg-hover" : ""}`}
            >
              <Folder size={15} className="shrink-0 text-muted" />
              <span className={`min-w-0 flex-1 truncate ${e.name.startsWith(".") ? "text-muted" : "text-ink"}`}>{e.name}</span>
              <button
                tabIndex={-1}
                className={`shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium text-ink-2 hover:bg-active hover:text-ink ${i === hi || compact ? "" : "invisible group-hover:visible"}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onPick(e.path);
                }}
              >
                Use
              </button>
              <ChevronRight size={14} className="shrink-0 text-faint" />
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        {making === null ? (
          <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => setMaking("")}>
            New folder
          </Button>
        ) : (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void mkdir(making);
            }}
          >
            <input
              autoFocus
              aria-label="New folder name"
              data-own-escape
              value={making}
              onChange={(e) => setMaking(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setMaking(null);
                  input.current?.focus();
                }
              }}
              placeholder="my-app"
              className="field h-8 min-w-0 flex-1 rounded-lg px-2.5 text-[13px] outline-none"
            />
            <Button size="sm" type="submit" disabled={busy || !making.trim()}>
              {busy ? <Spinner size={12} /> : "Create"}
            </Button>
          </form>
        )}
        {making === null && <div className="flex-1" />}
        {making === null && (
          <>
            <span className="hidden text-[12px] text-faint sm:inline">{kbd("⌘↩")}</span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => onPick(dir)} className="max-w-[220px]">
              <span className="truncate">Use {name}</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
