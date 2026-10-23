import { AlarmClock, ChevronRight, Cloud, MessageCircle, Server, Settings, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useUI } from "../../state/ui";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { AgentsTab } from "../settings/AgentsTab";
import { SETTINGS_GROUPS } from "../settings/Settings";
import { Empty } from "../settings/common";
import { statusText } from "../shell/Sidebar";

/**
 * The phone's top level: four tabs along the bottom, each its own place.
 * Tabs only navigate; what you do in a place lives in its header. A pushed
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
    <nav aria-label="Sections" className="safe-bottom relative z-10 shrink-0 border-t border-line bg-bg">
      <div className="flex h-[52px] px-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = tab === id;
          const badge = id === "sessions" ? waiting : 0;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-current={on ? "page" : undefined}
              aria-label={badge ? `${label}, ${badge} waiting for you` : label}
              className={`flex flex-1 flex-col items-center justify-center gap-1 pt-0.5 transition-colors ${on ? "text-ink" : "text-muted active:text-ink"}`}
            >
              <span className="relative">
                {/* The current tab's symbol is filled in, as on iOS; a tint keeps the strokes legible. */}
                <Icon size={24} strokeWidth={on ? 2 : 1.75} fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.16 : 0} />
                {badge > 0 && <span className="absolute -top-1 left-[17px] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-info px-1 text-[11px] leading-none font-semibold text-bg tabular-nums ring-2 ring-bg">{badge}</span>}
              </span>
              <span className={`text-[11px] leading-none ${on ? "font-semibold" : "font-medium"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** A tab's header: its name, then what you can do there. */
export function RootHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="safe-top shrink-0 px-2">
      <div className="flex h-[52px] items-center">
        <h1 className="flex min-w-0 flex-1 items-center gap-1.5 truncate pl-2 text-[17px] font-semibold">{title}</h1>
        {children}
      </div>
    </header>
  );
}

/** Teammates and the other agents; each opens as a page to edit, or to start a session with. */
export function TeamScreen({ onMessage }: { onMessage: (id: string) => void }) {
  const connected = useConnection((s) => s.status === "ready");
  return (
    <>
      <RootHeader title="Team" />
      <div data-scroll-root className="scroll-quiet min-h-0 flex-1 overflow-y-auto pt-1 pb-8">
        {connected ? (
          <AgentsTab compact onMessage={onMessage} />
        ) : (
          <div className="px-4 pt-4">
            <Empty icon={<Server size={20} />} title="Workspace offline" body="Your team is on the workspace. Reconnect to see them." />
          </div>
        )}
      </div>
    </>
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
  const info = useConnection((s) => s.info);
  const ready = status === "ready";
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((t) => t.id !== "workspaces" && t.id !== "agents") })).filter((g) => g.items.length);
  return (
    <>
      <RootHeader title="Settings" />
      <div data-scroll-root className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-8">
        <Card>
          <button onClick={() => open("workspaces")} className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors active:bg-hover">
            <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-active text-ink">
              <Cloud size={22} />
              <span className={`absolute right-0 bottom-0 h-3 w-3 rounded-full ring-2 ring-panel ${ready ? "bg-ok" : status === "error" ? "bg-danger" : "animate-pulse bg-warn"}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-semibold text-ink">{ws?.name ?? "No workspace"}</span>
              <span className="mt-0.5 block truncate text-[14px] text-muted">
                {statusText(status)}
                {count > 1 ? ` · ${count} workspaces` : ""}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-faint" />
          </button>
        </Card>
        {groups.map((g, i) => (
          <section key={i} className="mt-6">
            {g.label && <h2 className="px-4 pb-1.5 text-[13px] font-medium text-muted">{g.label}</h2>}
            <Card>
              {g.items.map((t, j) => (
                <button key={t.id} onClick={() => open(t.id)} className="flex min-h-12 w-full items-center gap-3.5 pl-4 text-left transition-colors active:bg-hover">
                  <t.icon size={20} className="shrink-0 text-ink-2" />
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
        {info && <p className="mt-6 text-center text-[13px] text-faint">OpenCode {info.version}</p>}
      </div>
    </>
  );
}

const Card = ({ children }: { children: ReactNode }) => <div className="overflow-hidden rounded-[14px] bg-panel">{children}</div>;
