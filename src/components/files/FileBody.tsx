/**
 * The panel's file preview: what a file looks like — text with line numbers
 * and highlighting, markdown as a document, an image fitted to the space, a
 * PDF, a font, or a peek into bytes we can't draw.
 *
 * Artifacts render through this (the `text` and `image` renderers), so a file
 * the agent shows looks exactly like a file opened from the chat.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { useArtifacts } from "../../state/artifacts";
import { basename, bytes } from "../../lib/format";
import { HIGHLIGHT_LIMIT, highlight, langFromPath } from "../chat/highlight";
import { BinaryView, FontView, ImageView, MediaView, PdfView, PREVIEW_MAX, kindFromPath, looksBinary, mimeFor, useObjectUrl, type PreviewKind } from "./Preview";
import { Spinner } from "../ui/AgentClock";
import { Markdown } from "../chat/Markdown";

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
  const jump = useArtifacts((s) => (s.reveal?.path === path ? s.reveal.n : 0));
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
  const target = useArtifacts((s) => (s.reveal?.path === path ? s.reveal : null));
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
