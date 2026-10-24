import { motion } from "motion/react";
import { Blocks, Bot, Cloud, Info, Plug, Puzzle, Server, SquareSlash, SlidersHorizontal, Sparkles, X, type LucideIcon } from "lucide-react";
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
import { Empty, PhonePage } from "./common";

/** Every settings section, grouped. The phone's Settings tab lists the same ones. */
export const SETTINGS_GROUPS: { label: string; items: { id: SettingsTab; label: string; icon: LucideIcon; server?: boolean }[] }[] = [
  {
    label: "App",
    items: [
      { id: "general", label: "General", icon: SlidersHorizontal },
      { id: "workspaces", label: "Workspaces", icon: Cloud },
      { id: "apps", label: "Apps", icon: Blocks },
    ],
  },
  {
    label: "Agent server",
    items: [
      { id: "agents", label: "Agents", icon: Bot, server: true },
      { id: "providers", label: "Providers", icon: Sparkles, server: true },
      { id: "mcp", label: "MCP servers", icon: Plug, server: true },
      { id: "skills", label: "Skills", icon: Puzzle, server: true },
      { id: "commands", label: "Commands", icon: SquareSlash, server: true },
    ],
  },
  { label: "", items: [{ id: "about", label: "About", icon: Info }] },
];

const ALL = SETTINGS_GROUPS.flatMap((g) => g.items);

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

  // Phones list the sections on the Settings tab; each opens here as its own page.
  if (compact)
    return (
      <Sheet open={open} onClose={close} compact grouped title={current.label}>
        <PhonePage.Provider value>
          <div data-phone-page className="px-4 pt-5 pb-8">{body}</div>
        </PhonePage.Provider>
      </Sheet>
    );

  return (
    <Sheet open={open} onClose={close} compact={false} wide label="Settings">
      <div className="flex h-[min(760px,86vh)]">
        <nav className="scroll-quiet w-[208px] shrink-0 overflow-y-auto border-r border-line p-3">
          <div className="flex items-center justify-between pt-0.5 pb-3 pl-2.5">
            <span className="text-[15px] font-semibold">Settings</span>
            <IconButton label="Close (Esc)" size={28} onClick={close}>
              <X size={16} />
            </IconButton>
          </div>
          {SETTINGS_GROUPS.map((g, gi) => (
            <div key={gi} className="mb-3">
              {g.label && <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-accent-ink uppercase">{g.label}</div>}
              {g.items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openSettings(t.id)}
                  className={`relative flex w-full shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-[13px] transition-colors ${tab === t.id ? "font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
                >
                  {tab === t.id && <motion.span layoutId="settings-tab" className="chip absolute inset-0 z-0 rounded-xl" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <t.icon size={15} className="relative z-[1] text-accent-ink" />
                  <span className="relative z-[1] whitespace-nowrap">{t.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="relative min-h-0 min-w-0 flex-1">
          <div className="scroll-quiet h-full overflow-y-auto px-8 pt-7 pb-8">{body}</div>
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
      <p className="mt-3 max-w-[360px] text-[13px] text-muted">Cloud coding agents, powered by OpenCode.</p>
      {info && (
        <div className="mt-6 rounded-xl bg-sunken px-4 py-2 font-mono text-[12px] text-muted">
          <Server size={12} className="mr-1.5 inline" />
          OpenCode {info.version}
        </div>
      )}
    </div>
  );
}
