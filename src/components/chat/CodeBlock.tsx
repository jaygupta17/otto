import { Check, Copy } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { highlight } from "./highlight";

export const CodeBlock = memo(function CodeBlock({ code, lang, streaming, maxHeight }: { code: string; lang: string; streaming?: boolean; maxHeight?: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (streaming) return; // highlight once settled; plain text while streaming is cheaper
    let live = true;
    void highlight(code, lang).then((h) => live && setHtml(h));
    return () => {
      live = false;
    };
  }, [code, lang, streaming]);

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-2xl bg-code hairline" style={{ background: "var(--code-bg)" }}>
      <div className="flex h-8 items-center justify-between border-b border-line px-3 [@media(pointer:coarse)]:h-11">
        <span className="font-mono text-[12px] text-faint">{lang || "text"}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="relative flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted opacity-0 transition-opacity after:absolute after:-inset-1.5 after:content-[''] group-hover/code:opacity-100 hover:bg-hover hover:text-ink focus:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:min-h-11"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="code-body selectable scroll-quiet overflow-auto" style={{ maxHeight }}>
        {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="text-ink-2">{code}</pre>}
      </div>
    </div>
  );
});
