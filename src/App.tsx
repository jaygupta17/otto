import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { useWorkspaces } from "./state/workspaces";
import { useConnection } from "./state/connection";
import { useUI, initUI } from "./state/ui";
import { useCompact } from "./hooks/useMedia";
import { Onboarding } from "./components/onboarding/Onboarding";
import { AppShell } from "./components/shell/AppShell";
import { MobileApp } from "./components/mobile/MobileApp";
import { Settings } from "./components/settings/Settings";
import { Sheet } from "./components/ui/Sheet";
import { Toasts } from "./components/ui/Toasts";
import { CommandPalette, ShortcutsSheet } from "./components/shell/CommandPalette";
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
    void Promise.all([initUI(), useWorkspaces.getState().hydrate()]).then(() => setBooted(true));
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
    const wake = () => document.visibilityState === "visible" && useConnection.getState().wake();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);

  if (!booted || !hydrated) return <Splash />;

  return (
    <MotionConfig reducedMotion="user">
      {workspaces.length === 0 ? <Onboarding /> : compact ? <MobileApp /> : <AppShell />}
      {workspaces.length > 0 && <Settings compact={compact} />}
      {workspaces.length > 0 && <CommandPalette />}
      {workspaces.length > 0 && <ShortcutsSheet compact={compact} />}
      <Sheet open={addOpen} onClose={() => setAdd(false)} compact={compact}>
        <Onboarding embedded onDone={() => setAdd(false)} onCancel={() => setAdd(false)} />
      </Sheet>
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
