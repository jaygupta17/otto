/** The Context surface: the window this session has used, and the files it changed. */
import { Gauge } from "lucide-react";
import { Changes, UsageCard } from "../chat/SessionExtras";
import { PanelEmpty, PanelHeader, PanelTitle } from "./SidePanel";

export function ContextSurface({ sessionId }: { sessionId: string | null }) {
  return (
    <>
      <PanelHeader>
        <PanelTitle label="Context" />
      </PanelHeader>
      {!sessionId ? (
        <PanelEmpty icon={<Gauge size={18} />} title="No session open" body="Open a session to see its usage and changes." />
      ) : (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
          <UsageCard sessionId={sessionId} />
          <Changes sessionId={sessionId} fill />
          <div className="px-4 pt-2 pb-5 text-[12px] text-faint">Click a file to see it in Artifact.</div>
        </div>
      )}
    </>
  );
}
