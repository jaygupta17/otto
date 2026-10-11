import { ChevronRight, File, FileCode2, Folder, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { basename } from "../../lib/format";
import type { FsEntry } from "../../lib/opencode/client";
import { highlight, langFromPath } from "../chat/highlight";
import { IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";

/** Join a possibly-relative path onto a root. */
function resolvePath(root: string, p: string) {
  if (p.startsWith("/")) return p;
  return `${root.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;
}

/** File tree. Clicking a file opens it in the editor panel (or the viewer sheet on phones). */
export function FilesPanel({ root, onClose }: { root: string; onClose?: () => void }) {
  const [filter, setFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag flex h-[52px] shrink-0 items-center gap-1 px-3" data-tauri-drag-region>
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold" data-tauri-drag-region>
          {basename(root)}
        </div>
        <IconButton label="Refresh" className="no-drag" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw size={14} />
        </IconButton>
        {onClose && (
          <IconButton label="Close files" className="no-drag" onClick={onClose}>
            <X size={16} />
          </IconButton>
        )}
      </div>
      <div className="px-2 pb-2">
        <div className="field flex h-8 items-center gap-2 rounded-lg px-2.5">
          <Search size={13} className="text-faint" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find files" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </div>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-auto px-1.5 pb-4">
        {filter.trim() ? <FindResults root={root} query={filter.trim()} /> : <Dir key={`${root}-${refreshKey}`} root={root} path={root} depth={0} initiallyOpen />}
      </div>
    </div>
  );
}

const Dir = memo(function Dir({ root, path, depth, initiallyOpen = false, name }: { root: string; path: string; depth: number; initiallyOpen?: boolean; name?: string }) {
  const client = useChat((s) => s.client);
  const [open, setOpen] = useState(initiallyOpen);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || entries || !client) return;
    client
      .listDir(path, root)
      .then((list) =>
        setEntries(
          list
            .filter((e) => !/^(\.git|node_modules|\.DS_Store)\/?$/.test(e.path))
            .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1)),
        ),
      )
      .catch((e) => setError((e as Error).message));
  }, [open, entries, client, path, root]);

  const children = (
    <>
      {open && !entries && !error && (
        <div className="py-1 text-muted" style={{ paddingLeft: depth * 14 + 26 }}>
          <Spinner size={12} />
        </div>
      )}
      {error && <div className="py-1 text-[12px] text-danger" style={{ paddingLeft: depth * 14 + 26 }}>{error}</div>}
      {open &&
        entries?.map((e) => {
          const full = `${path.replace(/\/$/, "")}/${e.path.replace(/\/$/, "")}`;
          const label = e.path.replace(/\/$/, "");
          return e.type === "directory" ? <Dir key={full} root={root} path={full} depth={depth + (depth === 0 && initiallyOpen ? 0 : 1)} name={label} /> : <FileRow key={full} path={full} name={label} depth={depth + (depth === 0 && initiallyOpen ? 0 : 1)} />;
        })}
      {open && entries?.length === 0 && <div className="py-1 text-[12px] text-faint" style={{ paddingLeft: depth * 14 + 26 }}>Empty</div>}
    </>
  );

  if (initiallyOpen && depth === 0) return children;

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-ink-2 hover:bg-hover" style={{ paddingLeft: depth * 14 + 6 }}>
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        {open ? <FolderOpen size={14} className="shrink-0 text-muted" /> : <Folder size={14} className="shrink-0 text-muted" />}
        <span className="truncate">{name}</span>
      </button>
      {children}
    </div>
  );
});

function FileRow({ path, name, depth }: { path: string; name: string; depth: number }) {
  const openInEditor = useUI((s) => s.openInEditor);
  const active = useUI((s) => s.activeFile === path);
  const code = langFromPath(name) !== "text";
  return (
    <button onClick={() => openInEditor(path)} className={`flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] ${active ? "bg-active text-ink" : "text-ink-2 hover:bg-hover"}`} style={{ paddingLeft: depth * 14 + 25 }}>
      {code ? <FileCode2 size={14} className="shrink-0 text-muted" /> : <File size={14} className="shrink-0 text-faint" />}
      <span className="truncate">{name}</span>
    </button>
  );
}

function FindResults({ root, query }: { root: string; query: string }) {
  const client = useChat((s) => s.client);
  const [results, setResults] = useState<FsEntry[] | null>(null);
  useEffect(() => {
    if (!client) return;
    setResults(null);
    const t = setTimeout(() => {
      client
        .findFiles(query, root, 60)
        .then(setResults)
        .catch(() => setResults([]));
    }, 160);
    return () => clearTimeout(t);
  }, [client, query, root]);
  if (!results)
    return (
      <div className="flex justify-center py-4 text-muted">
        <Spinner />
      </div>
    );
  if (!results.length) return <div className="py-6 text-center text-[12.5px] text-faint">No files match</div>;
  return (
    <>
      {results.map((r) => (
        <FileRow key={r.path} path={resolvePath(root, r.path)} name={r.path} depth={0} />
      ))}
    </>
  );
}

/** Read-only file body with line numbers and syntax highlighting. */
export function FileBody({ path, root, onText }: { path: string; root: string; onText?: (t: string | null) => void }) {
  const client = useChat((s) => s.client);
  const [text, setText] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = useMemo(() => langFromPath(path), [path]);

  const load = useCallback(() => {
    if (!client) return;
    setText(null);
    setHtml(null);
    setError(null);
    client
      .readFile(path, root)
      .then((t) => {
        setText(t);
        if (t.length < 400_000) void highlight(t, lang).then(setHtml);
      })
      .catch((e) => setError((e as Error).message));
  }, [client, path, root, lang]);

  useEffect(load, [load]);
  useEffect(() => onText?.(text), [text, onText]);

  return (
    <div className="scroll-quiet code-body code-lines selectable min-h-0 flex-1 overflow-auto">
      {error ? (
        <div className="p-6 text-[13px] text-danger">{error}</div>
      ) : text === null ? (
        <div className="flex justify-center p-8 text-muted">
          <Spinner />
        </div>
      ) : html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="text-ink-2">{text}</pre>
      )}
    </div>
  );
}
