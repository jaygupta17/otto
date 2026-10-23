import { AlarmClock, ChevronRight, Cloud, MessageCircle, Server, Settings, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useUI } from "../../state/ui";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { AgentsTab } from "../settings/AgentsTab";
import { SETTINGS_GROUPS } from "../settings/Settings";
import { Empty } from "../settings/common";
import { statusText } from "../shell/Sidebar";
import { RootPage } from "../ui/Hero";
import { Pip, connectionTone } from "../ui/Pip";

/**
 * The phone's top level: four tabs in a capsule along the bottom, each its
 * own place. Tabs only navigate; what you do in a place lives in its bar. A pushed
 * session covers the bar, as in Messages, so the composer owns the bottom.
 */
export type Tab = "sessions" | "team" | "schedules" | "settings";

export const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "sessions", label: "Sessions", icon: MessageCircle },
  { id: "team", label: "Team", icon: Users },
  { id: "schedules", label: "Schedules", icon: AlarmClock },
  { id: "settings", label: "Settings", icon: Settings },
];

export function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  // Sessions waiting on an answer, counted once however many questions each has.
  const waiting = useChat((s) => new Set([...Object.values(s.permissions), ...Object.values(s.forms)].map((a) => a.sessionID)).size);
  return (
    // A capsule floating over the page's own colour: a recessed track with the current tab raised in it, like a segmented control.
    <nav aria-label="Sections" className="relative z-10 shrink-0 px-3 pt-1" style={{ paddingBottom: "max(10px, calc(var(--safe-b) - 6px))" }}>
      <div className="well mx-auto flex h-[60px] max-w-[440px] gap-1 rounded-[22px] p-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = tab === id;
          const badge = id === "sessions" ? waiting : 0;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-current={on ? "page" : undefined}
              aria-label={badge ? `${label}, ${badge} waiting for you` : label}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[18px] transition-colors ${on ? "text-accent-ink" : "text-muted active:text-ink"}`}
            >
              {on && <motion.span layoutId="tab-chip" aria-hidden className="chip absolute inset-0 z-0 rounded-[18px]" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
              {/* Above every tab's chip, so the chip sliding past doesn't cover a neighbour's label. */}
              <span className="relative z-[1]">
                <Icon size={21} strokeWidth={on ? 2 : 1.75} />
                {badge > 0 && <span className="absolute -top-1.5 left-[15px] grid h-[17px] min-w-[17px] place-items-center rounded-[5px] bg-accent px-1 font-mono text-[10.5px] leading-none font-semibold text-bg tabular-nums">{badge}</span>}
              </span>
              <span className={`relative z-[1] text-[10.5px] leading-none tracking-[0.01em] ${on ? "font-semibold" : "font-medium"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Teammates and the other agents; each opens as a page to edit, or to start a session with. */
export function TeamScreen({ onMessage }: { onMessage: (id: string) => void }) {
  const connected = useConnection((s) => s.status === "ready");
  // No count line: the list is right there, and each bird shows when it's working.
  return (
    <RootPage title="Team">
      {connected ? (
        <AgentsTab compact onMessage={onMessage} />
      ) : (
        <div className="px-4 pt-4">
          <Empty icon={<Server size={20} />} title="Workspace offline" body="Your team is on the workspace. Reconnect to see them." />
        </div>
      )}
    </RootPage>
  );
}

/**
 * Settings as a grouped list, like the iOS Settings app: where you're
 * connected first, then each section, which opens as its own page. Agents
 * aren't here; they're the Team tab.
 */
export function SettingsScreen() {
  const open = useUI((s) => s.openSettings);
  const ws = useActiveWorkspace();
  const count = useWorkspaces((s) => s.workspaces.length);
  const status = useConnection((s) => s.status);
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((t) => t.id !== "workspaces" && t.id !== "agents") })).filter((g) => g.items.length);
  return (
    <RootPage title="Settings" bodyClassName="px-4">
        <Card>
          <button onClick={() => open("workspaces")} className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors active:bg-hover">
            <span className="well grid h-12 w-12 shrink-0 place-items-center rounded-full text-ink">
              <Cloud size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-semibold text-ink">{ws?.name ?? "No workspace"}</span>
              <span className="mt-0.5 flex items-center gap-1.5 truncate text-[14px] text-muted">
                <Pip tone={connectionTone(status)} />
                {statusText(status)}
                {count > 1 ? ` · ${count} workspaces` : ""}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-faint" />
          </button>
        </Card>
        {groups.map((g, i) => (
          <section key={i} className="mt-6">
            {g.label && <h2 className="pb-2 text-[11px] font-medium tracking-[0.06em] text-accent-ink uppercase">{g.label}</h2>}
            <Card>
              {g.items.map((t, j) => (
                <button key={t.id} onClick={() => open(t.id)} className="flex min-h-12 w-full items-center gap-3.5 pl-4 text-left transition-colors active:bg-hover">
                  <t.icon size={20} className="shrink-0 text-accent-ink" />
                  {/* Separators start at the label, as in iOS lists. */}
                  <span className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 self-stretch pr-3 ${j ? "border-t border-line" : ""}`}>
                    <span className="min-w-0 flex-1 truncate text-[16px] text-ink">{t.label}</span>
                    {t.id === "about" && <span className="shrink-0 text-[15px] text-muted">{__APP_VERSION__}</span>}
                    <ChevronRight size={18} className="shrink-0 text-faint" />
                  </span>
                </button>
              ))}
            </Card>
          </section>
        ))}
    </RootPage>
  );
}

const Card = ({ children }: { children: ReactNode }) => <div className="bezel overflow-hidden rounded-[14px]">{children}</div>;
