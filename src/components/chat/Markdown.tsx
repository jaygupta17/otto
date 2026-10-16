import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { openLink } from "../../lib/preview";

const plugins = [remarkGfm];

function makeComponents(streaming: boolean): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const text = String(children ?? "");
      const m = /language-([\w+-]+)/.exec(className ?? "");
      if (!m && !text.includes("\n")) return <code>{children}</code>;
      return <CodeBlock code={text.replace(/\n$/, "")} lang={m?.[1] ?? ""} streaming={streaming} />;
    },
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) openLink(href);
        }}
      >
        {children}
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
    <ReactMarkdown remarkPlugins={plugins} components={streaming ? live : settled}>
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
