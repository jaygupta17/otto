import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUI, toast } from "../../state/ui";
import { useChat } from "../../state/chat";
import { useExtensions } from "../../state/extensions";
import { modelRefToString, modelStringToRef } from "../../lib/opencode/config";
import { parseRules, serializeRules, type PermissionModel } from "../../lib/permissions";
import { requestNotifyPermission } from "../../lib/notify";
import { Button, IconButton } from "../ui/Button";
import { Select } from "../ui/Select";
import { AgentDot } from "../shell/CommandPalette";
import { agentColor } from "../../lib/agentColor";
import { Spinner } from "../ui/AgentClock";
import { Row, Rows, Section, Segmented, Slider, Toggle } from "./common";
import { ModelSelect } from "./ModelSelect";
import { PermissionsEditor } from "./AgentsTab";

export function GeneralTab() {
  return (
    <>
      <h2 className="mb-6 text-[20px] font-semibold tracking-[-0.01em]">General</h2>
      <AppearanceSection />
      <NotificationsSection />
      <DefaultsSection />
    </>
  );
}

function NotificationsSection() {
  const notify = useUI((s) => s.notify);
  const setNotify = useUI((s) => s.setNotify);
  return (
    <Section title="Notifications">
      <Rows>
        <Row label="When an agent finishes or needs you" hint="Only while Otto is in the background">
          <Toggle
            on={notify}
            onChange={async (v) => {
              if (v && !(await requestNotifyPermission())) {
                toast({ tone: "error", title: "Notifications are blocked", body: "Allow them for Otto in your system settings." });
                return;
              }
              setNotify(v);
            }}
            label="Notifications"
          />
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
                  { value: "", label: "Build", hint: "OpenCode default", icon: <AgentDot color={agentColor("build")} /> },
                  ...agents
                    .filter((a) => a.mode !== "subagent" && !a.hidden && a.id !== "build")
                    .map((a) => ({ value: a.id, label: a.name, icon: <AgentDot color={agentColor(a.id, a.color)} /> })),
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

function AppearanceSection() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const backdrop = useUI((s) => s.backdrop);
  const setBackdrop = useUI((s) => s.setBackdrop);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onPick(file: File) {
    try {
      const url = await downscale(file, 2400);
      setBackdrop({ kind: "image", image: url });
    } catch {
      toast({ tone: "error", title: "Couldn't use that image" });
    }
  }

  const img = backdrop.kind === "image" && backdrop.image;
  return (
    <Section title="Appearance">
      <Rows>
        <Row label="Theme">
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
        <Row label="Background">
          <BackdropTile active={backdrop.kind === "none"} label="None" onClick={() => setBackdrop({ kind: "none" })}>
            <div className="h-full w-full bg-bg" />
          </BackdropTile>
          <BackdropTile active={backdrop.kind === "image"} label={backdrop.image ? "Photo" : "Add photo"} onClick={() => (backdrop.image ? setBackdrop({ kind: "image" }) : fileInput.current?.click())}>
            {backdrop.image ? (
              <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${backdrop.image})` }} />
            ) : (
              <div className="grid h-full w-full place-items-center bg-sunken text-muted">
                <ImagePlus size={15} />
              </div>
            )}
          </BackdropTile>
          {backdrop.image && (
            <IconButton label="Choose another photo" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={15} />
            </IconButton>
          )}
          <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void onPick(e.target.files[0])} />
        </Row>
        {img && (
          <>
            <Row label="Photo visibility">
              <Slider label="Photo visibility" value={backdrop.intensity} min={0.1} max={1} format={pct} onChange={(v) => setBackdrop({ intensity: v })} />
            </Row>
            <Row label="Fade at the bottom">
              <Slider label="Fade at the bottom" value={backdrop.fade ?? 0.35} min={0} max={1} format={pct} onChange={(v) => setBackdrop({ fade: v })} />
            </Row>
            <Row label="Blur">
              <Slider label="Blur" value={backdrop.blur ?? 0} min={0} max={30} step={1} format={(v) => `${v}px`} onChange={(v) => setBackdrop({ blur: v })} />
            </Row>
            <Row label="See-through panels">
              <Slider label="See-through panels" value={backdrop.glass ?? 0.3} min={0} max={0.85} format={pct} onChange={(v) => setBackdrop({ glass: v })} />
            </Row>
          </>
        )}
      </Rows>
    </Section>
  );
}

function BackdropTile({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={active} className={`h-9 w-14 overflow-hidden rounded-lg transition-shadow ${active ? "shadow-[0_0_0_2px_var(--text)]" : "hairline hover:shadow-[0_0_0_1px_var(--border-strong)]"}`}>
      {children}
    </button>
  );
}

async function downscale(file: File, max: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
