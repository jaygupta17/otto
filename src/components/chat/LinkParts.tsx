/**
 * GitHub-style affordances for what a message points at: URLs get a compact
 * preview card (title, domain, favicon, Open Graph when the page offers it and
 * the user has turned on link previews — it fetches from their machine, so it
 * is opt-in), and local file paths get an inline chip that opens the file. A
 * path is only chipped once it resolves to a file; otherwise it stays plain
 * text. A paragraph that is just one URL grows into a card; a path never does —
 * the chip is the one treatment, alone on a line or mid-sentence.
 */
import { Globe } from "lucide-react";
import { Children, createContext, isValidElement, memo, useContext, useEffect, useState, type ReactNode } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { absolutePath, codeSpanFile, pathFromHref } from "../../lib/mdLinks";
import { faviconGuess, isPreviewable, linkMeta, type LinkMeta } from "../../lib/linkPreview";
import { openLink } from "../../lib/preview";
import { FileIcon, PathLabel, useOpenFile, useSessionRoot } from "./ToolParts";

/** Resolve an href (or code span content) to a file target, and whether that file exists. */
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
    if (!client || !root) return;
    let live = true;
    const timer = setTimeout(() => {
      codeSpanFile(client, root, href).then((v) => live && setExists(v));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, root, href]);
  return { target, path, line, abs, exists, open };
}

/**
 * The one treatment for a resolved file path, wherever it appears: the file's
 * icon and its path on the line highlight inline code wears, sitting in the
 * sentence like inline code does — no row of its own, no extra line height.
 * The line suffix (`x.md:12`) stays visible; it is where the tap goes. The tap
 * target is grown by a hit-area extender (44pt on a coarse pointer), never by
 * padding. Long paths truncate the way `PathLabel` does everywhere: the name
 * always shows, the directory gives way.
 */
function PathChip({ path, line, abs, open }: { path: string; line?: number; abs: string | null; open: (p: string, line?: number) => void }) {
  const go = () => open(path, line);
  return (
    <a
      role="button"
      tabIndex={0}
      className="relative cursor-pointer no-underline after:absolute after:-inset-1 after:content-[''] [@media(pointer:coarse)]:after:-inset-x-2 [@media(pointer:coarse)]:after:-inset-y-3.5"
      title={`${abs ?? path}${line ? `:${line}` : ""}`}
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
      <code className="inline-flex max-w-full items-baseline gap-1 rounded-md leading-[normal] hover:shadow-[inset_0_0_0_1px_var(--info)]">
        <FileIcon path={path} size={12} />
        <span className="inline-flex min-w-0 items-baseline">
          <PathLabel path={abs ?? path} />
          {line != null && <span className="shrink-0 text-faint">{`:${line}`}</span>}
        </span>
      </code>
    </a>
  );
}

/**
 * Inside a link. A code span there is part of the link's label, so it stays
 * code: a chip is an anchor of its own, and anchors don't nest.
 */
export const InLink = createContext(false);

/** The plain text of a link's label, however it was marked up. */
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : ""))
    .join("");
}

/**
 * A path in message text: plain until it resolves, then something that opens
 * the file. A bare path (or a link whose label is just that path) is the chip;
 * a link the agent gave its own words (`[the config](src/x.ts)`) keeps them,
 * as a link that opens the file.
 */
export function FileLink({ href, children }: { href: string; children?: ReactNode }) {
  const { path, line, abs, exists, open } = useFileTarget(href);
  if (!path || !exists) return <InLink.Provider value>{children}</InLink.Provider>;
  const label = textOf(children).trim().replace(/^`|`$/g, "");
  const labelled = label && label !== href.trim() && pathFromHref(label)?.path !== path;
  if (!labelled) return <PathChip path={path} line={line} abs={abs} open={open} />;
  return (
    <a
      href={href}
      title={`${abs ?? path}${line ? `:${line}` : ""}`}
      onClick={(e) => {
        e.preventDefault();
        open(path, line);
      }}
    >
      <InLink.Provider value>{children}</InLink.Provider>
    </a>
  );
}

/**
 * Inline code. Backticks name things, so when the whole span is a path to a
 * real file in the workspace it becomes the same chip — still code, still on
 * the line — and everything else (`e.g.`, commands, partial paths mid-stream)
 * stays literal code.
 */
export function InlineCode({ text, children }: { text: string; children?: ReactNode }) {
  const inLink = useContext(InLink);
  if (inLink) return <code>{children}</code>;
  return <CodeChip text={text}>{children}</CodeChip>;
}

function CodeChip({ text, children }: { text: string; children?: ReactNode }) {
  const { path, line, abs, exists, open } = useFileTarget(text);
  if (!path || !exists) return <code>{children}</code>;
  return <PathChip path={path} line={line} abs={abs} open={open} />;
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
