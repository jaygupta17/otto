import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { openLink } from "../../lib/preview";
import { CONNECT_LINK } from "../../lib/composio";
import { ConnectChip } from "./ConnectChip";
import { isPathHref, pathFromHref, rehypeFileLinks, soleLink } from "../../lib/mdLinks";
import { FileLink, InLink, InlineCode, LinkCard } from "./LinkParts";

const plugins = [remarkGfm];
const rehypePlugins = [rehypeFileLinks];

/** File paths stay as hrefs; anything else is sanitised as before. */
const urlTransform = (url: string) => (isPathHref(url) ? url : defaultUrlTransform(url));

function makeComponents(streaming: boolean): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const text = String(children ?? "");
      const m = /language-([\w+-]+)/.exec(className ?? "");
      // Inline code names things, so when the whole span is a real file it
      // becomes a link (still styled as code). Fenced and indented blocks —
      // which always carry a newline in their text — stay exactly as written.
      if (!m && !text.includes("\n")) return <InlineCode text={text}>{children}</InlineCode>;
      return <CodeBlock code={text.replace(/\n$/, "")} lang={m?.[1] ?? ""} streaming={streaming} />;
    },
    p: ({ node, children }) => {
      // A paragraph that is just one URL grows into a preview card. While the
      // message streams the target is still growing, so cards wait for it to settle.
      // File paths get no special case: they render as inline chips wherever
      // they appear, alone on a line or mid-sentence, so a paragraph of one
      // path is just that paragraph.
      const link = streaming ? null : soleLink(node);
      if (link && !CONNECT_LINK.test(link.href) && !pathFromHref(link.href)) {
        return <LinkCard href={link.href} label={link.text} />;
      }
      return <p>{children}</p>;
    },
    // A table scrolls sideways at its natural column widths instead of
    // reflowing to fit (`.table-wrap` in styles.css).
    table: ({ children }) => (
      <div className="table-wrap scroll-quiet">
        <table>{children}</table>
      </div>
    ),
    a: ({ href, children }) =>
      // An app's connect link (Composio) reads as a button that follows the sign-in.
      href && CONNECT_LINK.test(href) ? (
        <ConnectChip href={href}>
          <InLink.Provider value>{children}</InLink.Provider>
        </ConnectChip>
      ) : href && pathFromHref(href) ? (
        <FileLink href={href}>{children}</FileLink>
      ) : (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) openLink(href);
          }}
        >
          <InLink.Provider value>{children}</InLink.Provider>
        </a>
      ),
  };
}

const settled = makeComponents(false);
const live = makeComponents(true);

/**
 * Split at blank lines that start a new top-level block (not inside a code
 * fence, not an indented continuation). While a reply streams only the last
 * block changes, so only it gets re-parsed.
 */
export function splitBlocks(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0].repeat(f[1].length);
      else if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, "") === "") fence = null;
    }
    cur.push(line);
    const next = lines[i + 1];
    if (!fence && line.trim() === "" && next !== undefined && /^\S/.test(next) && cur.some((l) => l.trim())) {
      out.push(cur.join("\n"));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

const Block = memo(function Block({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={plugins} rehypePlugins={rehypePlugins} urlTransform={urlTransform} components={streaming ? live : settled}>
      {text}
    </ReactMarkdown>
  );
});

export const Markdown = memo(function Markdown({ text, streaming = false, className = "" }: { text: string; streaming?: boolean; className?: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className={`prose-chat selectable ${className}`}>
      {blocks.map((b, i) => (
        <Block key={i} text={b} streaming={streaming && i === blocks.length - 1} />
      ))}
    </div>
  );
});
