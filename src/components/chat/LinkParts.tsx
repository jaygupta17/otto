/**
 * GitHub-style affordances for what a message points at: URLs get a compact
 * preview card (title, domain, favicon, Open Graph when the page offers it and
 * the user has turned on link previews — it fetches from their machine, so it
 * is opt-in), and local file paths get a link that opens the file. A path is only linked
 * once it resolves to a file; otherwise it stays plain text. A paragraph that
 * is just one link or path grows into a card, with the file's own preview
 * (`files/Preview`) one tap away.
 */
import { Eye, Globe, EyeOff } from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { absolutePath, checkFile, pathFromHref } from "../../lib/mdLinks";
import { faviconGuess, isPreviewable, linkMeta, type LinkMeta } from "../../lib/linkPreview";
import { openLink } from "../../lib/preview";
import { FileIcon, PathLabel, useOpenFile, useSessionRoot } from "./ToolParts";

/** Resolve an href to a file target, and whether that file exists. */
function useFileTarget(href: string) {
  const client = useChat((s) => s.client);
  const root = useSessionRoot();
  const open = useOpenFile();
  const target = pathFromHref(href);
  const path = target?.path;
  const line = target?.line;
  const abs = path ? absolutePath(root, path) : null;
  const [exists, setExists] = useState(false);
  useEffect(() => {
    setExists(false);
    // Debounced: while a reply streams the path is still growing, and each
    // settled shape only needs one check (cached inside `checkFile`).
    if (!client || !root || !path) return;
    let live = true;
    const timer = setTimeout(() => {
      checkFile(client, root, path).then((v) => live && setExists(v));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, root, path]);
  return { target, path, line, abs, exists, open };
}

/** A path in message text: plain until it resolves, then a link to the file. */
export function FileLink({ href, children }: { href: string; children?: ReactNode }) {
  const { path, line, exists, open } = useFileTarget(href);
  if (!path || !exists) return <>{children}</>;
  const go = () => open(path, line);
  return (
    <a
      role="button"
      tabIndex={0}
      className="cursor-pointer"
      title={`${path}${line ? `:${line}` : ""}`}
      onClick={(e) => {
        e.preventDefault();
        go();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
    >
      {children}
    </a>
  );
}

/** A paragraph holding just a file path: the row opens it, the button previews it. */
export function FileCard({ href }: { href: string }) {
  const { path, line, abs, exists, open } = useFileTarget(href);
  const root = useSessionRoot();
  const [show, setShow] = useState(false);
  const [Body, setBody] = useState<null | ((props: { path: string; root: string }) => ReactNode)>(null);
  useEffect(() => {
    if (!show || Body) return;
    let live = true;
    // The preview views load only when asked for.
    void import("../files/FilesPanel").then((m) => live && setBody(() => m.FileBody));
    return () => {
      live = false;
    };
  }, [show, Body]);

  if (!path || !exists) return <FileLink href={href}>{href}</FileLink>;
  return (
    <div className="my-3 overflow-hidden rounded-2xl hairline">
      <div className="flex items-center gap-2 px-3 py-2 [@media(pointer:coarse)]:min-h-11">
        <FileIcon path={path} size={14} />
        <button
          type="button"
          className="min-w-0 flex-1 text-left [@media(pointer:coarse)]:min-h-11"
          title={`${path}${line ? `:${line}` : ""}`}
          onClick={() => open(path, line)}
        >
          <PathLabel path={abs ?? path} className="font-mono text-[12px]" />
        </button>
        <button
          type="button"
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-ink [@media(pointer:coarse)]:min-h-11"
          onClick={() => setShow((v) => !v)}
        >
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
          {show ? "Hide preview" : "Show preview"}
        </button>
      </div>
      {show && Body && abs && (
        <div className="flex h-[420px] flex-col border-t border-line">
          <Body path={abs} root={root} />
        </div>
      )}
    </div>
  );
}

/** An image URL from a page is only ever loaded when it passes `isPreviewable`. */
function safeImage(url: string | undefined): string | undefined {
  return url && isPreviewable(url) ? url : undefined;
}

/** A paragraph holding just a URL: a compact preview card that opens the link. */
export const LinkCard = memo(function LinkCard({ href, label }: { href: string; label?: string }) {
  const previews = useUI((s) => s.linkPreviews);
  const [meta, setMeta] = useState<LinkMeta | null>(null);
  const [iconOk, setIconOk] = useState(true);
  // Previews are opt-in. With them off this card makes zero network requests:
  // it renders from the URL alone, so no one learns when a message was read.
  const fetchable = previews && isPreviewable(href);
  useEffect(() => {
    if (!fetchable) return;
    let live = true;
    linkMeta(href).then((m) => live && setMeta(m));
    return () => {
      live = false;
    };
  }, [href, fetchable]);
  let host = href;
  try {
    host = new URL(href).host || href;
  } catch {
    /* keep the raw href */
  }
  const info = fetchable ? meta : null;
  const icon = safeImage(info?.favicon ?? (fetchable ? faviconGuess(href) : undefined));
  const image = safeImage(info?.image);
  return (
    <button type="button" onClick={() => openLink(href)} className="my-3 flex w-full items-start gap-3 rounded-2xl hairline p-3 text-left hover:bg-hover">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center overflow-hidden rounded-md">
        {icon && iconOk ? <img src={icon} alt="" className="size-4 rounded-[3px]" loading="lazy" onError={() => setIconOk(false)} /> : <Globe size={15} className="text-faint" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-ink">{info?.title ?? label ?? href}</span>
        <span className="truncate font-mono text-[12px] text-faint">{host}</span>
        {info?.description && <span className="line-clamp-2 text-[13px] text-muted">{info.description}</span>}
      </span>
      {image && <img src={image} alt="" loading="lazy" className="h-16 w-24 shrink-0 rounded-md object-cover" />}
    </button>
  );
});
