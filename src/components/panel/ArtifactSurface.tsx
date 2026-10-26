/**
 * The Artifact surface: what this session has shown, newest first, and the
 * thing itself.
 *
 * A short list, not a tree — one row per presentation, and the agent is the
 * one that decides what goes on it. Nothing here browses the filesystem: a
 * path only appears because the agent presented it (or because you clicked a
 * path in the chat or in Context).
 *
 * Everything an agent hands over is treated as content, never as UI:
 *   - a path is resolved inside the session root before it is read at all,
 *   - markup and HTML files go into a sandboxed frame through `srcDoc`, with
 *     no `allow-same-origin`, so they run in an opaque origin and can't reach
 *     this app, its storage or its DOM,
 *   - a URL has to pass `isPreviewable` before it is framed.
 */
import { CodeXml, Download, FileText, Globe, Image as ImageIcon, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useChat } from "../../state/chat";
import { useArtifacts, artifactsFor, selectedArtifact, type Artifact } from "../../state/artifacts";
import { basename, timeAgo } from "../../lib/format";
import { fileSize, localAddress, type ArtifactKind } from "../../lib/artifacts";
import { isPreviewable } from "../../lib/linkPreview";
import { previewUrl } from "../../lib/preview";
import { openExternal } from "../../lib/platform";
import { Button, IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { toast } from "../../state/ui";
import { FileBody } from "../files/FileBody";
import { PanelEmpty, PanelHeader, PanelTitle, useSurfaceVisible } from "./SidePanel";

/** How much HTML is read to be framed. Past this the agent should trim it. */
const MAX_HTML = 2_000_000;
/** How much a download row will fetch. */
const MAX_DOWNLOAD = 32 * 1024 * 1024;

const ICON: Record<ArtifactKind, (size: number) => React.ReactNode> = {
  image: (s) => <ImageIcon size={s} />,
  html: (s) => <CodeXml size={s} />,
  url: (s) => <Globe size={s} />,
  text: (s) => <FileText size={s} />,
  download: (s) => <Download size={s} />,
};

export function ArtifactSurface({ root, sessionId }: { root: string | null; sessionId: string | null }) {
  const parentOf = useChat((s) => s.parents);
  const bySession = useArtifacts((s) => s.bySession);
  const selectedId = useArtifacts((s) => (sessionId ? s.selected[sessionId] : undefined));
  const list = useMemo(() => artifactsFor(bySession, sessionId, parentOf), [bySession, sessionId, parentOf]);
  const onShow = useMemo(() => selectedArtifact(selectedId, list), [selectedId, list]);
  const seen = useArtifacts((s) => s.seen);
  const visible = useSurfaceVisible("artifact");

  // Looking at the surface is looking at what it holds: the dock's pip clears
  // only while it's the surface on screen, not when a presentation lands in a
  // panel that's closed.
  useEffect(() => {
    if (visible) seen();
  }, [seen, visible, list.length, sessionId]);

  return (
    <>
      <PanelHeader>
        <PanelTitle label="Artifact" />
      </PanelHeader>
      {!sessionId ? (
        <PanelEmpty icon={<ImageIcon size={18} />} title="No session open" body="Open a session, and what its agent shows will land here." />
      ) : !list.length ? (
        <PanelEmpty
          icon={<ImageIcon size={18} />}
          title="Nothing presented yet"
          body="When the agent has something to look at — a page, a screenshot, a report — it shows it here instead of describing it."
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ul aria-label="Presented artifacts" className="scroll-quiet max-h-[42%] min-h-0 shrink-0 overflow-y-auto border-b border-line p-1.5">
            {list.map((a) => {
              const on = a.id === onShow?.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => sessionId && useArtifacts.getState().select(sessionId, a.id)}
                    aria-current={on || undefined}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors [@media(pointer:coarse)]:py-2.5 ${on ? "chip text-ink" : "text-ink-2 hover:bg-hover"}`}
                  >
                    <span className={`shrink-0 ${on ? "text-accent-ink" : "text-muted"}`}>{ICON[a.kind](14)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] [@media(pointer:coarse)]:text-[15px]">{a.title}</span>
                    {a.problem && <span className="shrink-0 text-[11px] text-danger">Can't show</span>}
                    <span className="shrink-0 text-[11px] text-faint tabular-nums">{timeAgo(a.at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Only the surface on screen runs what it frames: an agent's page
              keeps its scripts to itself while the panel is closed or elsewhere. */}
          <div className="flex min-h-0 flex-1 flex-col">{onShow && visible && <ArtifactView a={onShow} root={root} />}</div>
        </div>
      )}
    </>
  );
}

function ArtifactView({ a, root }: { a: Artifact; root: string | null }) {
  if (a.problem) return <PanelEmpty icon={ICON[a.kind](18)} title="Can't show this one" body={a.problem} />;
  if (a.markup) return <Frame html={a.markup} title={a.title} />;
  if (a.url) return <UrlFrame url={a.url} title={a.title} />;
  if (!a.path) return null;
  switch (a.kind) {
    case "image":
    case "text":
      // The panel's existing file preview: images fit, code is coloured,
      // markdown reads as a document, PDFs page.
      return <FileBody path={a.path} root={root ?? ""} />;
    case "html":
      return <HtmlFile path={a.path} root={root} title={a.title} />;
    default:
      return <DownloadRow path={a.path} root={root} />;
  }
}

/**
 * An agent-supplied document, framed. `sandbox` with no `allow-same-origin`
 * gives it an opaque origin: scripts may run (a page that doesn't run is not
 * reviewable), but it can't read this app's DOM, storage or cookies, and
 * without `allow-top-navigation` it can't send the window anywhere.
 */
const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals allow-downloads";

function Frame({ html, title }: { html: string; title: string }) {
  return <iframe title={title} srcDoc={html} sandbox={SANDBOX} referrerPolicy="no-referrer" className="h-full w-full flex-1 border-0 bg-white" />;
}

/** HTML in the workspace: read through the fs API, framed the same way. */
function HtmlFile({ path, root, title }: { path: string; root: string | null; title: string }) {
  const client = useChat((s) => s.client);
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    setHtml(null);
    setProblem(null);
    client
      .readFileBytes(path, root ?? undefined, { maxBytes: MAX_HTML })
      .then((r) => {
        if (!live) return;
        if (!r.bytes) return setProblem(`This page is ${fileSize(r.size)} — too big to frame. Trim it, or present it as a download.`);
        setHtml(new TextDecoder().decode(r.bytes));
      })
      .catch((e) => live && setProblem((e as Error).message));
    return () => {
      live = false;
    };
  }, [client, path, root]);
  if (problem) return <PanelEmpty icon={<CodeXml size={18} />} title="Couldn't show this page" body={problem} />;
  if (html === null)
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <Spinner size={16} />
      </div>
    );
  return <Frame html={html} title={title} />;
}

type UrlState = { src: string } | { problem: string } | null;

/**
 * A page by address. A dev server the agent names as `localhost:3000` is on
 * the agent machine, so it goes through the provider's port forwarding first
 * (preview.ts); whatever comes out — forwarded or not — has to pass
 * `isPreviewable` before it is framed. Loopback and private addresses are
 * never framed, even when the agent is on this same machine: the rule in
 * linkPreview.ts is what keeps an agent (or a page it read) from pointing this
 * app at the user's own network.
 */
function UrlFrame({ url, title }: { url: string; title: string }) {
  const [state, setState] = useState<UrlState>(null);
  const [bar, setBar] = useState<string>("");

  useEffect(() => {
    let live = true;
    setState(null);
    void (async () => {
      const forward = localAddress(url);
      let resolved = url;
      if (forward) {
        try {
          resolved = (await previewUrl(forward.port)) + forward.rest;
        } catch (e) {
          if (live) setState({ problem: (e as Error).message });
          return;
        }
      }
      if (!live) return;
      setBar(shortUrl(resolved));
      if (!isPreviewable(resolved)) {
        setState({ problem: "That address is on a local or private network, so it isn't shown here. Open it in your browser instead." });
        return;
      }
      setState({ src: resolved });
    })();
    return () => {
      live = false;
    };
  }, [url]);

  if (state && "problem" in state)
    return (
      <PanelEmpty icon={<Globe size={18} />} title="Can't show this page" body={state.problem}>
        <Button size="sm" onClick={() => openExternal(url.startsWith("http") ? url : `http://${url}`)}>
          Open in your browser
        </Button>
      </PanelEmpty>
    );
  if (!state)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={state.src}>
          {bar}
        </span>
        <IconButton label="Open in your browser" size={24} onClick={() => void openExternal(state.src)}>
          <Globe size={12} />
        </IconButton>
      </div>
      <iframe title={title} src={state.src} sandbox={SANDBOX} referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Archives, binaries and anything unrecognised: the name, its size, and a way to take it. */
function DownloadRow({ path, root }: { path: string; root: string | null }) {
  const client = useChat((s) => s.client);
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!client) return;
    let live = true;
    // `maxBytes: 1` asks the server for the size without bringing the file.
    client
      .readFileBytes(path, root ?? undefined, { maxBytes: 1 })
      .then((r) => live && setSize(r.bytes ? r.bytes.byteLength : r.size))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, path, root]);

  const save = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const r = await client.readFileBytes(path, root ?? undefined, { maxBytes: MAX_DOWNLOAD });
      if (!r.bytes) {
        toast({ tone: "error", title: "Too big to save from here", body: `${fileSize(r.size)} — open it in the terminal instead.` });
        return;
      }
      const href = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime || "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = href;
      a.download = basename(path);
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save that file", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex w-full max-w-[420px] items-center gap-3 rounded-xl border border-line px-4 py-3">
        <Download size={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink" title={path}>
            {basename(path)}
          </div>
          <div className="truncate font-mono text-[11px] text-faint tabular-nums">{size === null ? "…" : fileSize(size)}</div>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
