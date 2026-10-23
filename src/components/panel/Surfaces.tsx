/** The Files and Context surfaces of the right panel. */
import { FileCode2, FolderTree, Gauge } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useUI } from "../../state/ui";
import { basename } from "../../lib/format";
import { FilesPanel } from "../files/FilesPanel";
import { EditorBody, EditorTabs } from "../files/Editor";
import { Changes, UsageCard } from "../chat/SessionExtras";
import { IconButton } from "../ui/Button";
import { PanelEmpty, PanelHeader, PanelTitle, useDocked } from "./SidePanel";

const TREE_W = 260;

/** Open files on the left, the project tree in a column on the right. */
export function FilesSurface({ root }: { root: string | null }) {
  const active = useUI((s) => s.activeFile);
  const wideTree = useUI((s) => s.treeOpen);
  const toggleWideTree = useUI((s) => s.toggleTree);
  const docked = useDocked();
  const [ref, width] = useWidth();
  // Too narrow for both: the tree takes over until a file is picked.
  const narrow = width > 0 && width < 560;
  const [narrowTree, setNarrowTree] = useState(false);
  useEffect(() => setNarrowTree(false), [active]);
  const treeOpen = narrow ? narrowTree : wideTree;
  const toggleTree = () => (narrow ? setNarrowTree((v) => !v) : toggleWideTree());
  if (!root) return <PanelEmpty icon={<FolderTree size={18} />} title="No project yet" body="Connect a workspace to browse its files." />;

  // Without an open file, the tree is the whole surface.
  if (!active || !docked) {
    return (
      <>
        <PanelHeader>
          <PanelTitle surface="files" detail={basename(root)} />
        </PanelHeader>
        <div className="min-h-0 flex-1">
          <FilesPanel root={root} bare />
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        actions={
          <IconButton label={treeOpen ? "Hide file tree" : "Show file tree"} size={28} active={treeOpen} onClick={() => toggleTree()}>
            <FolderTree size={14} />
          </IconButton>
        }
      >
        <EditorTabs />
      </PanelHeader>
      <div ref={ref} className="flex min-h-0 flex-1">
        <div className={`min-w-0 flex-1 flex-col ${narrow && treeOpen ? "hidden" : "flex"}`}>
          <EditorBody root={root} />
        </div>
        {treeOpen && (
          <div className={`h-full shrink-0 ${narrow ? "flex-1" : "border-l border-line"}`} style={narrow ? undefined : { width: TREE_W }}>
            <FilesPanel root={root} bare />
          </div>
        )}
      </div>
    </>
  );
}

/** Context window, usage and the files this session changed. */
export function ContextSurface({ sessionId }: { sessionId: string | null }) {
  return (
    <>
      <PanelHeader>
        <PanelTitle surface="context" />
      </PanelHeader>
      {!sessionId ? (
        <PanelEmpty icon={<Gauge size={18} />} title="No session open" body="Open a session to see its usage and changes." />
      ) : (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
          <UsageCard sessionId={sessionId} />
          <Changes sessionId={sessionId} fill />
          <div className="flex items-center gap-1.5 px-4 pt-2 pb-5 text-[12px] text-faint">
            <FileCode2 size={12} /> Click a file to open it in Files.
          </div>
        </div>
      )}
    </>
  );
}

/** Width of an element, kept current. */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [w, setW] = useState(0);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [useCallback((n: HTMLElement | null) => setEl(n), []), w];
}
