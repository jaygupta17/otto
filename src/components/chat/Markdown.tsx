import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { openExternal } from "../../lib/platform";

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
          if (href) void openExternal(href);
        }}
      >
        {children}
      </a>
    ),
  };
}

const settled = makeComponents(false);
const live = makeComponents(true);

export const Markdown = memo(function Markdown({ text, streaming = false, className = "" }: { text: string; streaming?: boolean; className?: string }) {
  return (
    <div className={`prose-chat selectable ${streaming ? "" : ""} ${className}`}>
      <ReactMarkdown remarkPlugins={plugins} components={streaming ? live : settled}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
