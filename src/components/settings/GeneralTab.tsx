import { useContext, useEffect, useState } from "react";
import { useUI, toast } from "../../state/ui";
import { useChat } from "../../state/chat";
import { useExtensions } from "../../state/extensions";
import { modelRefToString, modelStringToRef } from "../../lib/opencode/config";
import { parseRules, serializeRules, type PermissionModel } from "../../lib/permissions";
import { notifyPermission, requestNotifyPermission, type Permission } from "../../lib/notify";
import { dispatchAlerts, useNotifications, type AlertKind } from "../../state/notifications";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { AgentMark } from "../ui/Bird";
import { useSchedules } from "../../state/schedules";
import { useTeammates } from "../../state/teammates";
import { isOfferedAgent } from "../../lib/teammates";
import { Spinner } from "../ui/AgentClock";
import { PhonePage, Row, Rows, Section, Segmented, Toggle } from "./common";
import { ThemePicker } from "./ThemePicker";
import { ModelSelect } from "./ModelSelect";
import { PermissionsEditor } from "./AgentsTab";
import { UpdatesSection } from "../shell/UpdateControls";

export function GeneralTab() {
  const phone = useContext(PhonePage);
  return (
    <>
      {!phone && <h2 className="mb-6 text-[20px] font-semibold tracking-[-0.01em]">General</h2>}
      <AppearanceSection />
      <NotificationsSection />
      <DefaultsSection />
      <AutomationSection />
      <UpdatesSection />
    </>
  );
}

function NotificationsSection() {
  const prefs = useNotifications((s) => s.prefs);
  const setPrefs = useNotifications((s) => s.setPrefs);
  const [perm, setPerm] = useState<Permission | null>(null);
  useEffect(() => {
    void notifyPermission().then(setPerm);
  }, []);
  const kind = (k: AlertKind, label: string, hint?: string) => (
    <Row label={label} hint={hint}>
      <Toggle on={prefs.kinds[k]} onChange={(v) => setPrefs({ kinds: { ...prefs.kinds, [k]: v } })} label={label} />
    </Row>
  );
  return (
    <Section
      title="Notifications"
      desc="A banner while you're in Otto, a system notification when it's in the background."
    >
      <Rows>
        <Row
          label="System notifications"
          hint={perm === "denied" ? <span className="text-danger">Blocked. Allow Otto in System Settings.</span> : "When Otto is in the background"}
        >
          <Toggle
            on={prefs.system && perm !== "denied"}
            onChange={async (v) => {
              if (v && !(await requestNotifyPermission())) {
                setPerm("denied");
                toast({ tone: "error", title: "Notifications are blocked", body: "Allow them for Otto in your system settings." });
                return;
              }
              if (v) setPerm("granted");
              setPrefs({ system: v });
            }}
            label="System notifications"
          />
        </Row>
        {kind("finished", "Agent finished")}
        {kind("failed", "Agent hit a problem")}
        {kind("permission", "Needs your approval")}
        {kind("question", "Has a question")}
        <Row label="Test" hint="Sends one in 4 seconds, so you can switch away">
          <Button
            size="sm"
            onClick={() => setTimeout(() => dispatchAlerts([{ kind: "finished", title: "Agent finished", body: "This is a test notification" }]), 4000)}
          >
            Send test
          </Button>
        </Row>
      </Rows>
    </Section>
  );
}

/** Server-wide defaults written to opencode.json. */
function DefaultsSection() {
  const config = useExtensions((s) => s.config);
  const load = useExtensions((s) => s.load);
  const update = useExtensions((s) => s.update);
  const agents = useChat((s) => s.agents);
  const roster = useTeammates((s) => s.byId);
  const client = useChat((s) => s.client);
  const [perms, setPerms] = useState<PermissionModel | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client) void load();
    const s = useExtensions.getState();
    if (client && !s.skills) void s.loadSkills();
    if (client && !s.mcp) void s.loadMcp();
  }, [client, load]);
  useEffect(() => {
    if (config) setPerms(parseRules(config.permissions ?? []));
  }, [config]);

  if (!client) return null;
  if (!config || !perms)
    return (
      <Section title="Defaults">
        <div className="flex justify-center py-6 text-muted">
          <Spinner />
        </div>
      </Section>
    );

  const dirty = JSON.stringify(serializeRules(perms)) !== JSON.stringify(serializeRules(parseRules(config.permissions ?? [])));

  return (
    <>
      <Section title="Defaults" desc="Shared by every device on this workspace.">
        <Rows>
          <Row label="Model">
            <div className="w-[260px]">
              <ModelSelect
                value={modelStringToRef(config.model)}
                inheritLabel="Let OpenCode decide"
                onChange={(m) =>
                  void update(
                    (c) => {
                      const next = { ...c };
                      const s = modelRefToString(m);
                      if (s) next.model = s;
                      else delete next.model;
                      return next;
                    },
                    { success: "Default model saved" },
                  ).then(() => useChat.getState().client?.defaultModel().then((d) => d && useChat.setState({ defaultModel: d })))
                }
              />
            </div>
          </Row>
          <Row label="Agent">
            <div className="w-[260px]">
              <Select
                ariaLabel="Default agent"
                value={config.default_agent ?? ""}
                onChange={(v) =>
                  void update(
                    (c) => {
                      const next = { ...c };
                      if (v) next.default_agent = v;
                      else delete next.default_agent;
                      return next;
                    },
                    { success: "Default agent saved" },
                  )
                }
                options={[
                  { value: "", label: "Otto's choice", hint: "Oldest teammate", icon: <AgentMark id={undefined} size={18} /> },
                  ...agents
                    .filter((a) => a.mode !== "subagent" && !a.hidden && isOfferedAgent(a.id))
                    .map((a) => ({ value: a.id, label: roster?.[a.id]?.name ?? a.name, icon: <AgentMark id={a.id} color={a.color} size={18} /> })),
                ]}
              />
            </div>
          </Row>
        </Rows>
      </Section>
      <Section
        title="Permissions"
        desc="For every agent. Each agent can override these."
        action={
          dirty ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPerms(parseRules(config.permissions ?? []))}>
                Discard
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const rules = serializeRules(perms);
                  await update(
                    (c) => {
                      const next = { ...c };
                      if (rules.length) next.permissions = rules;
                      else delete next.permissions;
                      return next;
                    },
                    { success: "Permissions saved" },
                  );
                  setSaving(false);
                }}
              >
                {saving ? <Spinner size={13} /> : "Save"}
              </Button>
            </div>
          ) : undefined
        }
      >
        <PermissionsEditor model={perms} onChange={setPerms} globalRules={[]} />
      </Section>
    </>
  );
}

/** What Otto's agents can do on their own, on this machine. */
function AutomationSection() {
  const client = useChat((s) => s.client);
  const schedulesOff = useTeammates((s) => s.schedulesOff);
  const setAgentTools = useSchedules((s) => s.setAgentTools);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Automation" desc="On the machine your agents run on.">
      <Rows>
        <Row label="Agents can manage schedules" hint="Creating, changing or deleting a schedule still asks you first">
          <Toggle
            on={!schedulesOff}
            disabled={!client || busy}
            onChange={async (v) => {
              setBusy(true);
              await setAgentTools(v);
              setBusy(false);
            }}
            label="Agents can manage schedules"
          />
        </Row>
      </Rows>
    </Section>
  );
}

function AppearanceSection() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const homeCompact = useUI((s) => s.homeCompact);
  const setHomeCompact = useUI((s) => s.setHomeCompact);
  const showThinking = useUI((s) => s.showThinking);
  const setShowThinking = useUI((s) => s.setShowThinking);
  const reduceMotion = useUI((s) => s.reduceMotion);
  const setReduceMotion = useUI((s) => s.setReduceMotion);
  return (
    <Section title="Appearance">
      <Rows>
        <Row label="Mode">
          <Segmented
            id="theme"
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[
              { id: "system", label: "System" },
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ]}
          />
        </Row>
        <ThemePicker />
        <Row label="Compact home" hint="Just the prompt, without recent sessions">
          <Toggle on={homeCompact} onChange={setHomeCompact} label="Compact home" />
        </Row>
        <Row label="Show thinking" hint="The model's reasoning, folded in chat as it works">
          <Toggle on={showThinking} onChange={setShowThinking} label="Show thinking" />
        </Row>
        <Row label="Reduce motion" hint="Transitions are instant; birds, shimmer and loading keep moving">
          <Toggle on={reduceMotion} onChange={setReduceMotion} label="Reduce motion" />
        </Row>
      </Rows>
    </Section>
  );
}
