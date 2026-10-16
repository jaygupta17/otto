import { ChevronDown, Monitor, PanelRight } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { browserSteps, shortUrl } from "../../lib/browserSteps";
import type { Block } from "../../lib/opencode/projection";
import { useComputer } from "../../state/computer";
import { AgentClock } from "../ui/AgentClock";
import { Button, IconButton } from "../ui/Button";
import { FocusButton, OnScreenNote, ScreenFrame, useLiveTarget, useScreenStream } from "../panel/LiveScreen";

/**
 * The agent's screen, in the chat. It sits at the end of the latest turn in
 * which the agent worked on the screen (the browser or desktop tools), plays
 * live, and says where the browser is and what it just did. It gives way to
 * full screen or the panel when they show the same screen (one stream at a time).
 */
export const ScreenCard = memo(function ScreenCard({ blocks, live, sessionId }: { blocks: Block[]; live: boolean; sessionId: string }) {
  const target = useLiveTarget();
  const panelScreen = useComputer((s) => s.panelScreen);
  const focus = useComputer((s) => s.focus);
  const control = useComputer((s) => s.control);
  const [open, setOpen] = useState(true);
  const stream = useScreenStream(!!target && open && !panelScreen && !focus);

  const steps = useMemo(() => browserSteps(blocks), [blocks]);
  if (!target) return null;
  const last = steps[steps.length - 1]?.step;
  const page = [...steps].reverse().find((s) => s.step.page)?.step.page;

  return (
    <div className="my-3 w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-raised">
      <div className="flex min-w-0 items-center gap-2.5 py-1.5 pr-1.5 pl-3">
        <span className="grid h-4 w-4 shrink-0 place-items-center text-muted">{live ? <AgentClock size={12} /> : <Monitor size={14} />}</span>
        <div className="min-w-0 flex-1 truncate text-[12.5px]" title={page?.url}>
          <span className="text-ink-2">{page ? page.title || shortUrl(page.url) : "Agent's screen"}</span>
          {page?.title && <span className="ml-1.5 text-faint">{shortUrl(page.url)}</span>}
          {last && (
            <span className={last.failed ? "text-danger" : "text-muted"}>
              {" · "}
              {last.verb} {last.target}
            </span>
          )}
        </div>
        <IconButton label={open ? "Hide the screen" : "Show the screen"} size={26} onClick={() => setOpen(!open)}>
          <ChevronDown size={14} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        </IconButton>
        <IconButton label="Open in the panel" size={26} onClick={() => useComputer.getState().showScreen()}>
          <PanelRight size={13} />
        </IconButton>
        <FocusButton size={26} />
      </div>
      {open &&
        (focus ? (
          <OnScreenNote />
        ) : panelScreen ? (
          <div className="grid aspect-video w-full place-items-center bg-black/90">
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-[12.5px] text-white/60">
                <PanelRight size={13} /> Showing in the panel
              </div>
              <Button size="sm" variant="glass" onClick={() => useComputer.getState().setView("preview")}>
                Watch here
              </Button>
            </div>
          </div>
        ) : (
          <ScreenFrame stream={stream} control={control} sessionId={sessionId} />
        ))}
    </div>
  );
});
