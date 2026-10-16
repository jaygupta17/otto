import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { useWorkspaces } from "./state/workspaces";
import { useConnection } from "./state/connection";
import { useUI, initUI } from "./state/ui";
import { initNotificationCenter } from "./state/notifications";
import { initUpdates } from "./state/updates";
import { initViewport } from "./lib/viewport";
import { useCompact } from "./hooks/useMedia";
import { Onboarding } from "./components/onboarding/Onboarding";
import { AppShell } from "./components/shell/AppShell";
import { MobileApp } from "./components/mobile/MobileApp";
import { Settings } from "./components/settings/Settings";
import { Sheet } from "./components/ui/Sheet";
import { Toasts } from "./components/ui/Toasts";
import { DialogHost } from "./components/ui/Dialogs";
import { SubagentHost } from "./components/chat/Subagent";
import { CommandPalette, ShortcutsSheet } from "./components/shell/CommandPalette";
import { ScreenFocus } from "./components/panel/ScreenFocus";
import { AppGlyph } from "./components/ui/Mark";

export default function App() {
  const hydrated = useWorkspaces((s) => s.hydrated);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const compact = useCompact();
  const addOpen = useUI((s) => s.addWorkspaceOpen);
  const setAdd = useUI((s) => s.setAddWorkspace);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    initViewport();
    void initUpdates();
    void Promise.all([initUI(), useWorkspaces.getState().hydrate(), initNotificationCenter()]).then(() => setBooted(true));
  }, []);

  // (Re)connect whenever the active workspace changes.
  useEffect(() => {
    if (!hydrated) return;
    const ws = useWorkspaces.getState().workspaces.find((w) => w.id === activeId);
    if (ws) void useConnection.getState().connect(ws);
    else useConnection.getState().disconnect();
  }, [hydrated, activeId]);

  // Coming back to the app: reconnect immediately instead of waiting for backoff.
  useEffect(() => {
    // After a while away the socket may be dead without knowing it: start a fresh
    // one (which resyncs sessions, runs and approvals) rather than trust it.
    let away = 0;
    const wake = () => useConnection.getState().wake();
    const visibility = () => {
      if (document.visibilityState === "hidden") away = Date.now();
      else {
        useConnection.getState().wake(!!away && Date.now() - away > 5000);
        away = 0;
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", wake);
    };
  }, []);

  if (!booted || !hydrated) return <Splash />;

  return (
    <MotionConfig reducedMotion="user">
      {workspaces.length === 0 ? <Onboarding /> : compact ? <MobileApp /> : <AppShell compact={compact} />}
      {workspaces.length > 0 && <Settings compact={compact} />}
      {workspaces.length > 0 && <CommandPalette />}
      {workspaces.length > 0 && <ShortcutsSheet compact={compact} />}
      <Sheet open={addOpen} onClose={() => setAdd(false)} compact={compact}>
        <Onboarding embedded onDone={() => setAdd(false)} onCancel={() => setAdd(false)} />
      </Sheet>
      {workspaces.length > 0 && <SubagentHost compact={compact} />}
      {workspaces.length > 0 && <ScreenFocus />}
      <DialogHost />
      <Toasts />
    </MotionConfig>
  );
}

function Splash() {
  return (
    <div className="grid h-full place-items-center bg-bg">
      <div className="animate-pulse">
        <AppGlyph size={44} />
      </div>
    </div>
  );
}
