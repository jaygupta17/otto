import { ChevronRight, File, FileCode2, Folder, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { basename, bytes } from "../../lib/format";
import type { FsEntry } from "../../lib/opencode/client";
import { HIGHLIGHT_LIMIT, highlight, langFromPath } from "../chat/highlight";
import { BinaryView, FontView, ImageView, MediaView, PdfView, PREVIEW_MAX, kindFromPath, looksBinary, mimeFor, useObjectUrl, type PreviewKind } from "./Preview";
import { IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { Markdown } from "../chat/Markdown";

/** Join a possibly-relative path onto a root. */
function resolvePath(root: string, p: string) {
  if (p.startsWith("/")) return p;
  return `${root.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;
}

/**
 * File tree. Clicking a file opens it in the editor panel (or the file page on phones).
 * `bare` drops the header, for when the tree sits inside the right panel.
 */
export function FilesPanel({ root, onClose, bare = false }: { root: string; onClose?: () => void; bare?: boolean }) {
  const [filter, setFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {!bare && (
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
      )}
      <div className={`flex items-center gap-1 px-2 pb-2 ${bare ? "pt-2" : ""}`}>
        <div className="field flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5">
          <Search size={13} className="text-faint" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find files" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </div>
        {bare && (
          <IconButton label="Refresh" size={28} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw size={13} />
          </IconButton>
        )}
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
            .filter((e) => !/^(\.git|node_modules|\.DS_Store)$/.test(baseName(e.path)))
            .sort((a, b) => (a.type === b.type ? baseName(a.path).localeCompare(baseName(b.path)) : a.type === "directory" ? -1 : 1)),
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
          // Entry paths are relative to the location root, not the listed folder,
          // so join the leaf name onto the folder we asked for.
          const label = baseName(e.path);
          const full = `${path.replace(/\/$/, "")}/${label}`;
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

const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;

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
  if (!results.length) return <div className="py-6 text-center text-[12px] text-faint">No files match</div>;
  return (
    <>
      {results.map((r) => (
        <FileRow key={r.path} path={resolvePath(root, r.path)} name={r.path} depth={0} />
      ))}
    </>
  );
}

/** Read-only file body with line numbers and syntax highlighting. */
type Loaded =
  | { kind: "text"; text: string; size: number; partial: boolean }
  | { kind: Exclude<PreviewKind, "text">; bytes: Uint8Array | null; mime: string; size: number; tooLarge?: boolean };

/** Text past this opens truncated (with "Show all"); highlighting has its own, lower, limit. */
const TEXT_CHUNK = 1_000_000;

export function FileBody({ path, root, onText }: { path: string; root: string; onText?: (t: string | null) => void }) {
  const client = useChat((s) => s.client);
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [source, setSource] = useState(false);
  // A jump to a line while it's open wants the lines, not the rendered page.
  const jump = useUI((s) => (s.editorLine?.path === path ? s.editorLine.n : 0));
  const jumped = useRef(jump);
  useEffect(() => {
    if (jump !== jumped.current) setSource(true);
    jumped.current = jump;
  }, [jump]);

  useEffect(() => {
    if (!client) return;
    let off = false;
    setFile(null);
    setError(null);
    setAll(false);
    setSource(false);
    const guess = kindFromPath(path);
    client
      .readFileBytes(path, root, { maxBytes: PREVIEW_MAX })
      .then(({ bytes, mime, size, truncated }) => {
        if (off) return;
        if (!bytes) return setFile({ kind: guess === "text" ? "binary" : guess, bytes: null, mime, size, tooLarge: true });
        if (guess !== "text" && guess !== "svg") return setFile({ kind: guess, bytes, mime: mimeFor(path, guess, mime), size });
        if (guess === "text" && (mime.startsWith("image/") || looksBinary(bytes))) {
          const k: PreviewKind = mime.startsWith("image/") && mime !== "image/svg+xml" ? "image" : "binary";
          return setFile({ kind: k, bytes, mime, size });
        }
        if (guess === "svg") return setFile({ kind: "svg", bytes, mime: "image/svg+xml", size });
        setFile({ kind: "text", text: new TextDecoder().decode(bytes), size, partial: !!truncated });
      })
      .catch((e) => !off && setError((e as Error).message));
    return () => {
      off = true;
    };
  }, [client, path, root]);

  const text = useMemo(() => (file?.kind === "text" ? file.text : file?.kind === "svg" && file.bytes ? new TextDecoder().decode(file.bytes) : null), [file]);
  useEffect(() => onText?.(text), [text, onText]);

  if (error) return <div className="p-6 text-[13px] text-danger">{error}</div>;
  if (!file)
    return (
      <div className="flex flex-1 justify-center p-8 text-muted">
        <Spinner />
      </div>
    );
  const name = basename(path);
  // Markdown reads as the document it is; its source is one click away.
  if (file.kind === "text" && MARKDOWN.test(path) && !source)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewToggle label="Show source" onToggle={() => setSource(true)} />
        <div className="scroll-quiet selectable min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="mx-auto max-w-[720px]">
            <Markdown text={file.partial ? `${file.text}\n\n…` : file.text} streaming={false} />
          </div>
        </div>
      </div>
    );
  if (file.kind === "text")
    return MARKDOWN.test(path) ? (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewToggle label="Show rendered" onToggle={() => setSource(false)} />
        <TextBody path={path} text={file.text} partial={file.partial} all={all} onAll={() => setAll(true)} />
      </div>
    ) : (
      <TextBody path={path} text={file.text} partial={file.partial} all={all} onAll={() => setAll(true)} />
    );
  if (file.kind === "svg" && source && text !== null)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewToggle label="Show image" onToggle={() => setSource(false)} />
        <TextBody path={path} text={text} partial={false} all onAll={() => {}} />
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {file.kind === "svg" && <ViewToggle label="Show source" onToggle={() => setSource(true)} />}
      <BinaryBody file={file} path={path} name={name} />
    </div>
  );
}

const MARKDOWN = /\.(md|markdown|mdx)$/i;

function ViewToggle({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <div className="flex shrink-0 justify-end border-b border-line px-2 py-1">
      <button className="rounded-md px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-ink" onClick={onToggle}>
        {label}
      </button>
    </div>
  );
}

function BinaryBody({ file, path, name }: { file: Exclude<Loaded, { kind: "text" }>; path: string; name: string }) {
  const viewable = file.bytes && !file.tooLarge && file.kind !== "binary" && file.kind !== "font";
  const url = useObjectUrl(viewable ? file.bytes : null, file.mime);
  if (file.kind === "binary" || file.tooLarge || !file.bytes) return <BinaryView bytes={file.bytes} path={path} size={file.size} mime={file.mime} tooLarge={file.tooLarge} />;
  if (file.kind === "font") return <FontView bytes={file.bytes} name={name} size={file.size} />;
  if (!url) return null;
  if (file.kind === "image" || file.kind === "svg") return <ImageView src={url} name={name} size={file.size} />;
  if (file.kind === "pdf") return <PdfView src={url} name={name} size={file.size} />;
  return <MediaView src={url} kind={file.kind} name={name} size={file.size} />;
}

function TextBody({ path, text, partial, all, onAll }: { path: string; text: string; partial: boolean; all: boolean; onAll: () => void }) {
  const lang = useMemo(() => langFromPath(path), [path]);
  const cut = !all && text.length > TEXT_CHUNK;
  const shown = cut ? text.slice(0, text.lastIndexOf("\n", TEXT_CHUNK) + 1 || TEXT_CHUNK) : text;
  const [html, setHtml] = useState<{ for: string; html: string } | null>(null);
  useEffect(() => {
    let off = false;
    if (shown.length <= HIGHLIGHT_LIMIT) void highlight(shown, lang).then((h) => !off && h && setHtml({ for: shown, html: h }));
    return () => {
      off = true;
    };
  }, [shown, lang]);
  const lines = useMemo(() => (shown.length > HIGHLIGHT_LIMIT ? countLines(text) : 0), [shown, text]);

  // "Open at line" from a tool row: scroll there and flash it once the body is rendered.
  const box = useRef<HTMLDivElement>(null);
  const target = useUI((s) => (s.editorLine?.path === path ? s.editorLine : null));
  const ready = !!html && html.for === shown;
  useEffect(() => {
    const el = box.current;
    if (!target || !el) return;
    const row = ready ? el.querySelectorAll<HTMLElement>(".line")[target.line - 1] : null;
    if (row) {
      row.scrollIntoView({ block: "center" });
      row.classList.remove("line-flash");
      void row.offsetWidth;
      row.classList.add("line-flash");
    } else if (!ready) {
      const pre = el.querySelector("pre");
      const lh = pre ? parseFloat(getComputedStyle(pre).lineHeight) || 18 : 18;
      el.scrollTop = Math.max(0, (target.line - 1) * lh - el.clientHeight / 2);
    }
  }, [target, ready]);

  return (
    <div ref={box} className="scroll-quiet code-body code-lines selectable min-h-0 flex-1 overflow-auto">
      {(cut || partial || shown.length > HIGHLIGHT_LIMIT) && (
        <div className="sticky top-0 left-0 z-[1] flex items-center gap-2 border-b border-line bg-raised px-3 py-1.5 font-sans text-[12px] text-muted">
          <span className="min-w-0 flex-1 truncate">
            {partial ? "Showing the start of this file." : cut ? `Showing the first ${bytes(shown.length)} of ${bytes(text.length)}.` : `${lines.toLocaleString()} lines · too big to colour`}
          </span>
          {cut && (
            <button className="rounded-md px-2 py-0.5 font-medium text-ink hover:bg-hover" onClick={onAll}>
              Show all
            </button>
          )}
        </div>
      )}
      {html && html.for === shown ? <div dangerouslySetInnerHTML={{ __html: html.html }} /> : <pre className="text-ink-2">{shown}</pre>}
    </div>
  );
}

function countLines(s: string) {
  let n = 1;
  for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) n++;
  return n;
}
