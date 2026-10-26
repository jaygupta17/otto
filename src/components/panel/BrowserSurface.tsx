/**
 * The Browser surface is the agent's screen, live: its Chrome and the desktop
 * behind it, on a machine that has one (Boat). There is no second product
 * here — a page to preview on your own is an artifact (the Artifact surface
 * frames an `http(s)` source), and the dev server it came from is a URL the
 * agent presents.
 */
import { LiveScreen } from "./LiveScreen";
import { PanelHeader, PanelTitle, useSurfaceVisible } from "./SidePanel";

export function BrowserSurface() {
  const visible = useSurfaceVisible("browser");
  return (
    <>
      <PanelHeader>
        <PanelTitle label="Screen" />
      </PanelHeader>
      <LiveScreen active={visible} />
    </>
  );
}
