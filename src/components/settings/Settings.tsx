import { motion } from "motion/react";
import { Blocks, Bot, Cloud, Info, Plug, Puzzle, Server, Slash, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";
import { useUI, type SettingsTab } from "../../state/ui";
import { useConnection } from "../../state/connection";
import { Sheet } from "../ui/Sheet";
import { IconButton } from "../ui/Button";
import { AppGlyph } from "../ui/Mark";
import { GeneralTab } from "./GeneralTab";
import { WorkspacesTab } from "./WorkspacesTab";
import { ProvidersTab } from "./ProvidersTab";
import { AgentsTab } from "./AgentsTab";
import { McpTab } from "./McpTab";
import { SkillsTab } from "./SkillsTab";
import { CommandsTab } from "./CommandsTab";
import { AppsTab } from "./AppsTab";
import { Empty } from "./common";

const GROUPS: { label: string; items: { id: SettingsTab; label: string; icon: ReactNode; server?: boolean }[] }[] = [
  {
    label: "App",
    items: [
      { id: "general", label: "General", icon: <SlidersHorizontal size={15} /> },
      { id: "workspaces", label: "Workspaces", icon: <Cloud size={15} /> },
      { id: "apps", label: "Apps", icon: <Blocks size={15} /> },
    ],
  },
  {
    label: "Agent server",
    items: [
      { id: "agents", label: "Agents", icon: <Bot size={15} />, server: true },
      { id: "providers", label: "Providers", icon: <Sparkles size={15} />, server: true },
      { id: "mcp", label: "MCP servers", icon: <Plug size={15} />, server: true },
      { id: "skills", label: "Skills", icon: <Puzzle size={15} />, server: true },
      { id: "commands", label: "Commands", icon: <Slash size={15} />, server: true },
    ],
  },
  { label: "", items: [{ id: "about", label: "About", icon: <Info size={15} /> }] },
];

const ALL = GROUPS.flatMap((g) => g.items);

export function Settings({ compact }: { compact: boolean }) {
  const open = useUI((s) => s.settingsOpen);
  const close = useUI((s) => s.closeSettings);
  const tab = useUI((s) => s.settingsTab);
  const openSettings = useUI((s) => s.openSettings);
  const connected = useConnection((s) => s.status === "ready");
  const current = ALL.find((t) => t.id === tab) ?? ALL[0];

  const body =
    current.server && !connected ? (
      <Empty icon={<Server size={20} />} title="Workspace offline" body="Reconnect to manage agents and tools." />
    ) : (
      <>
        {tab === "general" && <GeneralTab />}
        {tab === "workspaces" && <WorkspacesTab />}
        {tab === "apps" && <AppsTab />}
        {tab === "agents" && <AgentsTab compact={compact} />}
        {tab === "providers" && <ProvidersTab />}
        {tab === "mcp" && <McpTab />}
        {tab === "skills" && <SkillsTab compact={compact} />}
        {tab === "commands" && <CommandsTab />}
        {tab === "about" && <About />}
      </>
    );

  return (
    <Sheet open={open} onClose={close} compact={compact} wide title={compact ? "Settings" : undefined}>
      <div className={`flex ${compact ? "h-sheet flex-col" : "h-[min(760px,86vh)]"}`}>
        <nav className={compact ? "scroll-quiet flex shrink-0 gap-1 overflow-x-auto px-3 py-2" : "scroll-quiet w-[208px] shrink-0 overflow-y-auto border-r border-line p-3"}>
          {!compact && (
            <div className="flex items-center justify-between pt-0.5 pb-3 pl-2.5">
              <span className="text-[15px] font-semibold">Settings</span>
              <IconButton label="Close (Esc)" size={28} onClick={close}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {GROUPS.map((g, gi) => (
            <div key={gi} className={compact ? "contents" : "mb-3"}>
              {!compact && g.label && <div className="px-2.5 pt-1 pb-1 text-[12px] font-semibold text-faint ">{g.label}</div>}
              {g.items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openSettings(t.id)}
                  className={`relative flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-[13.5px] transition-colors ${compact ? "" : "w-full"} ${tab === t.id ? "text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
                >
                  {tab === t.id && <motion.span layoutId="settings-tab" className="absolute inset-0 rounded-xl bg-active" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <span className="relative">{t.icon}</span>
                  <span className="relative whitespace-nowrap">{t.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="relative min-h-0 min-w-0 flex-1">
          <div className={`scroll-quiet h-full overflow-y-auto ${compact ? "px-4 pt-2 pb-6" : "px-8 pt-7 pb-8"}`}>{body}</div>
        </div>
      </div>
    </Sheet>
  );
}

function About() {
  const info = useConnection((s) => s.info);
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <AppGlyph size={64} />
      <h3 className="mt-5 text-[20px] font-semibold">Otto</h3>
      <p className="mt-1 text-[13px] text-muted">Version {__APP_VERSION__}</p>
      <p className="mt-3 max-w-[360px] text-[13.5px] text-muted">Cloud coding agents, powered by OpenCode.</p>
      {info && (
        <div className="mt-6 rounded-xl bg-sunken px-4 py-2 font-mono text-[12px] text-muted">
          <Server size={12} className="mr-1.5 inline" />
          OpenCode {info.version}
        </div>
      )}
    </div>
  );
}
