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
import { ChevronRight, CodeXml, Copy, Download, ExternalLink, FileText, Globe, Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useChat } from "../../state/chat";
import { useArtifacts, artifactsFor, openedByYou, selectedArtifact, type Artifact } from "../../state/artifacts";
import { basename, timeAgo } from "../../lib/format";
import { fileSize, localAddress, type ArtifactKind } from "../../lib/artifacts";
import { isPreviewable } from "../../lib/linkPreview";
import { previewUrl } from "../../lib/preview";
import { isTauri, openExternal } from "../../lib/platform";
import type { OpenCode } from "../../lib/opencode/client";
import { Button, IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { toast } from "../../state/ui";
import { FileBody } from "../files/FileBody";
import { PanelEmpty, PanelHeader, PanelTitle, useSurfaceVisible } from "./SidePanel";

/** How much HTML is read to be framed. Past this the agent should trim it. */
const MAX_HTML = 2_000_000;
/** How much a save will fetch. */
const MAX_DOWNLOAD = 32 * 1024 * 1024;
/** How big an image may be to draw as a thumbnail in the list. */
const MAX_THUMB = 3 * 1024 * 1024;

const ICON: Record<ArtifactKind, (size: number) => ReactNode> = {
  image: (s) => <ImageIcon size={s} />,
  html: (s) => <CodeXml size={s} />,
  url: (s) => <Globe size={s} />,
  text: (s) => <FileText size={s} />,
  download: (s) => <Download size={s} />,
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  image: "Image",
  html: "Page",
  url: "Website",
  text: "File",
  download: "Download",
};

/** Where an artifact came from, said briefly: a path inside the folder, a host, or "HTML". */
function whereOf(a: Artifact, root: string | null): string {
  if (a.markup) return "HTML from the agent";
  if (a.url) return hostOf(a.url);
  const p = a.path ?? a.source;
  const r = root?.replace(/\/$/, "");
  return r && p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

function hostOf(url: string): string {
  try {
    const u = new URL(/^\w+:\/\//.test(url) ? url : `http://${url}`);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * The surface is two places, like a phone page: the list of what this session
 * has shown, and one artifact at the panel's full size with a way back. Opening
 * one (a row here, a chip in chat, a path in a message) never splits the panel.
 */
export function ArtifactSurface({ root, sessionId }: { root: string | null; sessionId: string | null }) {
  const parentOf = useChat((s) => s.parents);
  const bySession = useArtifacts((s) => s.bySession);
  const selectedId = useArtifacts((s) => (sessionId ? s.selected[sessionId] : undefined));
  const list = useMemo(() => artifactsFor(bySession, sessionId, parentOf), [bySession, sessionId, parentOf]);
  const open = useMemo(() => selectedArtifact(selectedId, list), [selectedId, list]);
  const seen = useArtifacts((s) => s.seen);
  const visible = useSurfaceVisible("artifact");

  // Looking at the surface is looking at what it holds: the dock's pip clears
  // only while it's the surface on screen, not when a presentation lands in a
  // panel that's closed.
  useEffect(() => {
    if (visible) seen();
  }, [seen, visible, list.length, sessionId]);

  if (open && sessionId) return <ArtifactPage a={open} root={root} visible={visible} onBack={() => useArtifacts.getState().back(sessionId)} />;

  return (
    <>
      <PanelHeader>
        <PanelTitle label="Artifacts" />
      </PanelHeader>
      {!sessionId ? (
        <PanelEmpty icon={<ImageIcon size={18} />} title="No session open" body="Open a session, and what its agent shows you will gather here." />
      ) : !list.length ? (
        <PanelEmpty
          icon={<ImageIcon size={18} />}
          title="Nothing to look at yet"
          body="When the agent makes something worth seeing (a page, a screenshot, a chart, a report) it shows it here. Files you open from the chat land here too."
        />
      ) : (
        <ArtifactList list={list} root={root} sessionId={sessionId} />
      )}
    </>
  );
}

function ArtifactList({ list, root, sessionId }: { list: Artifact[]; root: string | null; sessionId: string }) {
  const shown = list.filter((a) => !openedByYou(a));
  const opened = list.filter(openedByYou);
  const open = (a: Artifact) => useArtifacts.getState().show(sessionId, a.id);
  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {shown.length > 0 && (
        <Group title="From the agent">
          {shown.map((a) => (
            <ArtifactRow key={a.id} a={a} root={root} onOpen={() => open(a)} />
          ))}
        </Group>
      )}
      {opened.length > 0 && (
        <Group title="You opened">
          {opened.map((a) => (
            <ArtifactRow key={a.id} a={a} root={root} onOpen={() => open(a)} />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-3">
      <h3 className="px-2 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-accent-ink uppercase">{title}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function ArtifactRow({ a, root, onOpen }: { a: Artifact; root: string | null; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-[10px] border border-transparent px-2 py-1.5 text-left transition-colors hover:border-line hover:bg-hover/60 [@media(pointer:coarse)]:py-2.5"
      >
        <Thumb a={a} root={root} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink-2 group-hover:text-ink [@media(pointer:coarse)]:text-[15px]">{a.title}</span>
          <span className={`block truncate text-[11px] [@media(pointer:coarse)]:text-[13px] ${a.problem ? "text-danger" : "text-faint"}`}>
            {a.problem ? "Can't show this one" : (
              <>
                {KIND_LABEL[a.kind]} · <span className="font-mono">{whereOf(a, root)}</span>
              </>
            )}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">{timeAgo(a.at)}</span>
        <ChevronRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted" />
      </button>
    </li>
  );
}

/** Thumbnails already drawn, so scrolling the list or going back doesn't fetch them again. */
const thumbs = new Map<string, string | null>();

/** A 40px tile: the image itself for an image, the kind's icon in a well for anything else. */
function Thumb({ a, root }: { a: Artifact; root: string | null }) {
  const client = useChat((s) => s.client);
  const want = a.kind === "image" && !!a.path && !a.problem;
  const [src, setSrc] = useState<string | null>(() => (a.path ? thumbs.get(a.path) ?? null : null));
  useEffect(() => {
    if (!want || !client || !a.path || thumbs.has(a.path)) return;
    let live = true;
    const path = a.path;
    client
      .readFileBytes(path, root ?? undefined, { maxBytes: MAX_THUMB })
      .then((r) => {
        const url = r.bytes ? URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime || "image/png" })) : null;
        if (thumbs.size > 60) {
          const [k, v] = thumbs.entries().next().value as [string, string | null];
          if (v) URL.revokeObjectURL(v);
          thumbs.delete(k);
        }
        thumbs.set(path, url);
        if (live) setSrc(url);
      })
      .catch(() => thumbs.set(path, null));
    return () => {
      live = false;
    };
  }, [want, client, a.path, root]);
  return (
    <span className="well grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg text-accent-ink">
      {want && src ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" /> : ICON[a.kind](16)}
    </span>
  );
}

/** One artifact at the panel's full size: back to the list, what it is, and what you can do with it. */
function ArtifactPage({ a, root, visible, onBack }: { a: Artifact; root: string | null; visible: boolean; onBack: () => void }) {
  const client = useChat((s) => s.client);
  const [saving, setSaving] = useState(false);
  const where = whereOf(a, root);
  const actions = a.problem ? null : (
    <>
      {a.url && (
        <IconButton label="Open in your browser" size={28} onClick={() => void openUrl(a.url!)}>
          <ExternalLink size={14} />
        </IconButton>
      )}
      {a.path && (
        <>
          <IconButton
            label="Copy path"
            size={28}
            onClick={() => {
              void navigator.clipboard?.writeText(a.path!);
              toast({ tone: "ok", title: "Path copied" });
            }}
          >
            <Copy size={13} />
          </IconButton>
          <IconButton
            label="Save a copy"
            size={28}
            disabled={saving || !client}
            onClick={async () => {
              if (!client) return;
              setSaving(true);
              await saveFile(client, a.path!, root);
              setSaving(false);
            }}
          >
            {saving ? <Spinner size={12} /> : <Download size={14} />}
          </IconButton>
        </>
      )}
    </>
  );
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        // Escape steps back to the list, unless something inside wants it.
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <PanelHeader onBack={onBack} backLabel="All artifacts" actions={actions}>
        <span className="shrink-0 text-accent-ink">{ICON[a.kind](15)}</span>
        <span className="flex min-w-0 flex-col leading-tight" data-tauri-drag-region>
          <span className="truncate text-[13px] font-semibold text-ink [@media(pointer:coarse)]:text-[16px]" title={a.title}>
            {a.title}
          </span>
          {where !== a.title && (
            <span className="truncate font-mono text-[11px] text-faint" title={a.path ?? a.url ?? undefined}>
              {where}
            </span>
          )}
        </span>
      </PanelHeader>
      {/* Only the surface on screen runs what it frames: an agent's page
          keeps its scripts to itself while the panel is closed or elsewhere. */}
      <div className="flex min-h-0 flex-1 flex-col">{visible && <ArtifactView a={a} root={root} />}</div>
    </div>
  );
}

/** A dev server on the agent machine goes through the provider's forwarding; anything else as it is. */
async function resolveUrl(url: string): Promise<string> {
  const forward = localAddress(url);
  return forward ? (await previewUrl(forward.port)) + forward.rest : url;
}

async function openUrl(url: string) {
  try {
    await openExternal(await resolveUrl(url));
  } catch {
    await openExternal(url.startsWith("http") ? url : `http://${url}`);
  }
}

async function saveFile(client: OpenCode, path: string, root: string | null) {
  try {
    const r = await client.readFileBytes(path, root ?? undefined, { maxBytes: MAX_DOWNLOAD });
    if (!r.bytes) {
      toast({ tone: "error", title: "Too big to save from here", body: `${fileSize(r.size)}. Copy it off the machine from the terminal instead.` });
      return;
    }
    const name = basename(path);
    // A webview has no download manager: WKWebView and Android ignore an
    // anchor to a blob. In the app, ask where to put it and write it there;
    // in a browser, the anchor still downloads the way it always did.
    if (isTauri) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({ title: "Save a copy", defaultPath: name });
      if (!dest) return; // the dialog was closed
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await writeFile(dest, r.bytes);
      toast({ tone: "ok", title: "Saved", body: name });
      return;
    }
    const href = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime || "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch (e) {
    toast({ tone: "error", title: "Couldn't save that file", body: (e as Error).message });
  }
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
      <div className="flex flex-1 items-center justify-center text-muted">
        <Spinner size={16} />
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The address actually framed, which a forwarded dev server changes. */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <Globe size={12} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={state.src}>
          {bar}
        </span>
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
    await saveFile(client, path, root);
    setBusy(false);
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="bezel flex w-full max-w-[420px] items-center gap-3 rounded-xl px-3 py-3">
        <span className="well grid h-10 w-10 shrink-0 place-items-center rounded-lg text-accent-ink">
          <Download size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink" title={path}>
            {basename(path)}
          </div>
          <div className="truncate font-mono text-[11px] text-faint tabular-nums">{size === null ? "…" : fileSize(size)}</div>
        </div>
        <Button size="sm" disabled={busy || !client} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
