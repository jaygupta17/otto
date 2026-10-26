/**
 * What an agent showed you, as it sits in the thread: a chip per `present`
 * call. The artifact itself lives in the panel, which has the room; the chip
 * says what it is and opens it there, full size, on a click.
 */
import { AlertTriangle, ArrowUpRight, CodeXml, Download, FileText, Globe, Image as ImageIcon } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { classify, kindOfPath, parsePresent, titleFor, type ArtifactKind } from "../../lib/artifacts";
import { basename } from "../../lib/format";
import { inputOf, toolFailed, type ToolBlock } from "../../lib/opencode/tools";
import { useChat } from "../../state/chat";
import { showPresented } from "../../state/artifacts";
import { ThreadSession, useSessionRoot } from "./ToolParts";

const ICON: Record<ArtifactKind, ReactNode> = {
  image: <ImageIcon size={14} />,
  html: <CodeXml size={14} />,
  url: <Globe size={14} />,
  text: <FileText size={14} />,
  download: <Download size={14} />,
};

/** What a call shows, read from its input alone, so the chip draws before the recorder gets to it. */
function describe(input: Record<string, unknown>): { kind: ArtifactKind; title: string; where: string | null } | null {
  const p = parsePresent(input);
  if ("problem" in p) return null;
  const c = classify(p.source, p.as);
  if ("problem" in c) return null;
  const kind: ArtifactKind = c.kind === "url" ? "url" : c.kind === "markup" ? "html" : (p.as ?? kindOfPath(c.path));
  const title = p.title ?? titleFor(p.source, p.as);
  const where = c.kind === "markup" ? null : c.kind === "url" ? titleFor(c.url) : basename(c.path);
  return { kind, title, where: where && where !== title ? where : null };
}

/** A run of consecutive presentations, side by side, wrapping when there are many. */
export function PresentChips({ blocks }: { blocks: ToolBlock[] }) {
  return (
    <div className="my-1.5 flex flex-wrap gap-1.5">
      {blocks.map((b) => (
        <PresentChip key={b.key} b={b} />
      ))}
    </div>
  );
}

function PresentChip({ b }: { b: ToolBlock }) {
  const root = useSessionRoot();
  const thread = useContext(ThreadSession);
  const active = useChat((s) => s.activeId);
  const sid = thread ?? active;
  const input = inputOf(b);
  const d = describe(input);
  const preparing = b.status === "running" || b.status === "streaming";
  const failed = toolFailed(b) || !d;
  const label = d?.title ?? (preparing ? "Something to show" : "Couldn't show this");
  return (
    <button
      type="button"
      disabled={preparing || !sid}
      onClick={() => sid && void showPresented(b.id, input, sid, root, b.started)}
      data-tip={b.error ?? (d ? "Open in the panel" : undefined)}
      className="group inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full bg-raised pr-3 pl-1 text-left transition-colors hairline hover:bg-hover disabled:cursor-default disabled:hover:bg-raised [@media(pointer:coarse)]:h-11"
    >
      <span className={`well grid h-7 w-7 shrink-0 place-items-center rounded-full ${failed && !preparing ? "text-danger" : "text-accent-ink"}`}>
        {failed && !preparing ? <AlertTriangle size={13} /> : ICON[d?.kind ?? "html"]}
      </span>
      <span className={`min-w-0 truncate text-[13px] ${preparing ? "shimmer" : "text-ink-2 group-hover:text-ink"}`}>{label}</span>
      {preparing ? (
        <span className="shrink-0 text-[11px] text-faint">Preparing…</span>
      ) : (
        <>
          {d?.where && <span className="hidden min-w-0 max-w-[16ch] shrink truncate font-mono text-[11px] text-faint sm:inline">{d.where}</span>}
          {d && <ArrowUpRight size={13} className="shrink-0 text-faint transition-transform group-hover:translate-x-px group-hover:-translate-y-px group-hover:text-muted" />}
        </>
      )}
    </button>
  );
}
