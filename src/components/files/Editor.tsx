import { ChevronRight, Copy, FileCode2, File as FileIcon, FolderTree, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useUI, toast } from "../../state/ui";
import { IconButton } from "../ui/Button";
import { FileBody } from "./FilesPanel";
import { langFromPath } from "../chat/highlight";

/**
 * Editor panel: tabs of open files, a breadcrumb for the active one, and the
 * file body. Read-only for now; the agent does the editing.
 */
export function Editor({ root, onToggleTree, treeOpen }: { root: string; onToggleTree?: () => void; treeOpen?: boolean }) {
  const active = useUI((s) => s.activeFile);
  if (!active) return null;
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag flex h-[52px] shrink-0 items-center gap-0.5 border-b border-line pr-2 pl-2" data-tauri-drag-region>
        <EditorTabs />
        {onToggleTree && (
          <IconButton label={treeOpen ? "Hide file tree" : "Show file tree"} active={treeOpen} className="no-drag" onClick={onToggleTree}>
            <FolderTree size={15} />
          </IconButton>
        )}
      </div>
      <EditorBody root={root} />
    </div>
  );
}

/** Tabs for the open files. */
export function EditorTabs() {
  const files = useUI((s) => s.editorFiles);
  const active = useUI((s) => s.activeFile);
  const open = useUI((s) => s.openInEditor);
  const close = useUI((s) => s.closeEditorFile);
  return (
    <div className="no-drag scroll-quiet flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="Open files">
      {files.map((f) => {
        const name = f.split("/").pop() ?? f;
        const on = f === active;
        return (
          <div
            key={f}
            role="tab"
            aria-selected={on}
            tabIndex={0}
            title={f}
            onClick={() => open(f)}
            onAuxClick={(e) => e.button === 1 && close(f)}
            onKeyDown={(e) => {
              if (e.key === "Enter") open(f);
              if (e.key === "Delete" || e.key === "Backspace") close(f);
            }}
            className={`group relative flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-lg pr-1 pl-2.5 text-[13px] transition-colors ${on ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
          >
            {langFromPath(name) !== "text" ? <FileCode2 size={13} className="shrink-0 text-muted" /> : <FileIcon size={13} className="shrink-0 text-faint" />}
            <span className="truncate">{name}</span>
            <button
              aria-label={`Close ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                close(f);
              }}
              className={`grid h-5 w-5 shrink-0 place-items-center rounded text-faint hover:bg-active hover:text-ink ${on ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Breadcrumb and body of the active file. */
export function EditorBody({ root }: { root: string }) {
  const active = useUI((s) => s.activeFile);
  const textRef = useRef<string | null>(null);
  const onText = useCallback((t: string | null) => {
    textRef.current = t;
  }, []);
  const [, force] = useState(0);

  if (!active) return null;
  const rel = active.startsWith(root.replace(/\/$/, "") + "/") ? active.slice(root.replace(/\/$/, "").length + 1) : active;
  const crumbs = rel.split("/").filter(Boolean);

  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-1 px-3 text-[12px] text-muted">
        <nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight size={11} className="shrink-0 text-faint" />}
              <span className={`truncate ${i === crumbs.length - 1 ? "text-ink" : ""}`}>{c}</span>
            </span>
          ))}
        </nav>
        <IconButton
          label="Copy file contents"
          size={24}
          onClick={() => {
            if (textRef.current == null) return;
            void navigator.clipboard.writeText(textRef.current);
            toast({ tone: "ok", title: "Copied" });
            force((n) => n + 1);
          }}
        >
          <Copy size={12} />
        </IconButton>
      </div>
      <FileBody key={active} path={active} root={root} onText={onText} />
    </>
  );
}
