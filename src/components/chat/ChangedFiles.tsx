import { ChevronRight, SquareArrowOutUpRight } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { changedFiles } from "../../lib/opencode/tools";
import type { Block } from "../../lib/opencode/projection";
import { FileIcon, PathLabel, useOpenFile } from "./ToolParts";

const SHOWN = 5;

/**
 * What the turn left behind, at its end: the files it changed, each one
 * click from opening. The run above says how; this says what.
 */
export const ChangedFiles = memo(function ChangedFiles({ blocks }: { blocks: Block[] }) {
  const files = useMemo(() => changedFiles(blocks), [blocks]);
  const [all, setAll] = useState(false);
  const openFile = useOpenFile();
  if (!files.length) return null;
  const counted = files.every((f) => f.add !== undefined);
  const add = files.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.del ?? 0), 0);
  const shown = all ? files : files.slice(0, SHOWN);

  return (
    <div className="my-3 w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-raised">
      <div className="flex h-8 items-center gap-2 border-b border-line px-3 text-[12.5px] text-muted">
        <span className="text-ink-2">
          {files.length === 1 ? "1 file changed" : `${files.length} files changed`}
        </span>
        {files.length > 1 && counted && (add > 0 || del > 0) && (
          <span className="font-mono text-[12px] tabular-nums">
            {add > 0 && <span className="text-ok">+{add}</span>}
            {add > 0 && del > 0 && " "}
            {del > 0 && <span className="text-danger">−{del}</span>}
          </span>
        )}
      </div>
      <ul className="py-1">
        {shown.map((f) => (
          <li key={f.path}>
            <button
              disabled={f.deleted}
              onClick={() => openFile(f.path, f.line)}
              title={f.deleted ? `${f.path} (deleted)` : `Open ${f.path}`}
              className="group/file flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-[13px] enabled:hover:bg-hover disabled:cursor-default"
            >
              <FileIcon path={f.path} />
              <span className={`flex min-w-0 flex-1 ${f.deleted ? "text-faint line-through" : ""}`}>
                <PathLabel path={f.path} className="text-[13px]" />
              </span>
              {f.deleted ? (
                <span className="shrink-0 text-[12px] text-faint">deleted</span>
              ) : (
                !!(f.add || f.del) && (
                  <span className="shrink-0 font-mono text-[12px] tabular-nums">
                    {f.add ? <span className="text-ok">+{f.add}</span> : null}
                    {f.add && f.del ? " " : null}
                    {f.del ? <span className="text-danger">−{f.del}</span> : null}
                  </span>
                )
              )}
              {!f.deleted && <SquareArrowOutUpRight size={12} className="shrink-0 text-faint opacity-0 transition-opacity group-hover/file:opacity-100 group-focus-visible/file:opacity-100" />}
            </button>
          </li>
        ))}
      </ul>
      {files.length > SHOWN && (
        <button onClick={() => setAll(!all)} className="flex h-8 w-full items-center gap-1.5 border-t border-line px-3 text-[12.5px] text-muted hover:bg-hover hover:text-ink">
          <ChevronRight size={12} className={`transition-transform ${all ? "-rotate-90" : "rotate-90"}`} />
          {all ? "Show fewer" : `Show ${files.length - SHOWN} more`}
        </button>
      )}
    </div>
  );
});
