import { ImagePlus, Palette, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUI, toast, backdropSettings, BACKDROP_DEFAULTS, BUILTIN_BACKDROPS } from "../../state/ui";
import { asImage } from "../ui/Backdrop";
import { uid } from "../../lib/id";
import { useChat } from "../../state/chat";
import { useExtensions } from "../../state/extensions";
import { modelRefToString, modelStringToRef } from "../../lib/opencode/config";
import { parseRules, serializeRules, type PermissionModel } from "../../lib/permissions";
import { notifyPermission, requestNotifyPermission, type Permission } from "../../lib/notify";
import { dispatchAlerts, useNotifications, type AlertKind } from "../../state/notifications";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { AgentMark } from "../ui/TeammateFace";
import { useSchedules } from "../../state/schedules";
import { useTeammates } from "../../state/teammates";
import { isOfferedAgent } from "../../lib/teammates";
import { Spinner } from "../ui/AgentClock";
import { Row, Rows, Section, Segmented, Slider, Toggle } from "./common";
import { ModelSelect } from "./ModelSelect";
import { PermissionsEditor } from "./AgentsTab";
import { UpdatesSection } from "../shell/UpdateControls";

export function GeneralTab() {
  return (
    <>
      <h2 className="mb-6 text-[20px] font-semibold tracking-[-0.01em]">General</h2>
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
      desc="While Otto is open on another session you get a banner; in the background, a system notification. Phones get them while Otto is running or recently closed."
    >
      <Rows>
        <Row
          label="System notifications"
          hint={perm === "denied" ? "Blocked. Allow notifications for Otto in your system settings." : "When Otto is in the background"}
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
        <Row label="Banners inside Otto" hint="For sessions you aren't looking at">
          <Toggle on={prefs.toasts} onChange={(v) => setPrefs({ toasts: v })} label="Banners inside Otto" />
        </Row>
        {kind("finished", "Agent finished")}
        {kind("failed", "Agent hit a problem")}
        {kind("permission", "Needs your approval")}
        {kind("question", "Has a question")}
        <Row label="Test" hint="Sends one in 4 seconds, so you can switch away">
          <Button
            size="sm"
            onClick={() => {
              toast({ tone: "info", title: "Switch to another app to see a system notification" });
              setTimeout(() => dispatchAlerts([{ kind: "finished", title: "Agent finished", body: "This is a test notification" }]), 4000);
            }}
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
        <Row label="Agents can manage schedules" hint="They can create and run schedules; creating, changing or deleting one asks you first">
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
  const backdrop = useUI((s) => s.backdrop);
  const setBackdrop = useUI((s) => s.setBackdrop);
  const homeCompact = useUI((s) => s.homeCompact);
  const setHomeCompact = useUI((s) => s.setHomeCompact);
  const img = backdropSettings(backdrop).on;
  const isPhoto = backdrop.kind === "image";
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
        <div className="px-4 py-3">
          <div className="mb-2.5 text-[13.5px] text-ink">Background</div>
          <BackgroundPicker />
        </div>
        {img && (
          <>
            <Row label={isPhoto ? "Photo visibility" : "Visibility"}>
              <Slider label="Visibility" value={backdrop.intensity ?? BACKDROP_DEFAULTS.intensity} min={0.1} max={1} format={pct} onChange={(v) => setBackdrop({ intensity: v })} />
            </Row>
            <Row label="Chat fade" hint="Toward the composer">
              <Slider label="Chat fade" value={backdrop.chatFade ?? BACKDROP_DEFAULTS.chatFade} min={0} max={1} format={pct} onChange={(v) => setBackdrop({ chatFade: v })} />
            </Row>
            <Row label="Fade at the bottom">
              <Slider label="Fade at the bottom" value={backdrop.fade ?? BACKDROP_DEFAULTS.fade} min={0} max={1} format={pct} onChange={(v) => setBackdrop({ fade: v })} />
            </Row>
            {isPhoto && (
              <Row label="Blur">
                <Slider label="Blur" value={backdrop.blur ?? BACKDROP_DEFAULTS.blur} min={0} max={30} step={1} format={(v) => `${v}px`} onChange={(v) => setBackdrop({ blur: v })} />
              </Row>
            )}
            <Row label="See-through panels">
              <Slider label="See-through panels" value={backdrop.glass ?? BACKDROP_DEFAULTS.glass} min={0} max={0.85} format={pct} onChange={(v) => setBackdrop({ glass: v })} />
            </Row>
          </>
        )}
        <Row label="Compact home" hint="Prompt centred on an empty screen, without the recent list">
          <Toggle on={homeCompact} onChange={setHomeCompact} label="Compact home" />
        </Row>
      </Rows>
    </Section>
  );
}

/** The built-in skies, saved photos and fills, and buttons to add more. */
function BackgroundPicker() {
  const backdrop = useUI((s) => s.backdrop);
  const saved = useUI((s) => s.backdrops);
  const apply = useUI((s) => s.applyBackdrop);
  const remove = useUI((s) => s.removeBackdrop);
  const setBackdrop = useUI((s) => s.setBackdrop);
  const fileInput = useRef<HTMLInputElement>(null);
  const [making, setMaking] = useState(false);
  const activeId = backdrop.kind === "none" ? "none" : backdrop.activeId;

  async function onPick(files: FileList) {
    for (const file of Array.from(files).slice(0, 6)) {
      try {
        await apply({ id: uid("bg_"), kind: "image", image: await downscale(file, 2400), name: file.name });
      } catch {
        toast({ tone: "error", title: `Couldn't use ${file.name}` });
      }
    }
  }

  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
        <Tile label="None" active={activeId === "none"} onClick={() => setBackdrop({ kind: "none", activeId: null })}>
          <div className="grid h-full w-full place-items-center bg-bg text-[11px] text-faint">None</div>
        </Tile>
        {BUILTIN_BACKDROPS.map((b) => (
          <Tile key={b.id} label={b.name!} active={activeId === b.id} onClick={() => void apply(b)}>
            <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${b.image})` }} />
          </Tile>
        ))}
        {saved.map((b) => (
          <Tile key={b.id} label={b.name ?? (b.kind === "image" ? "Photo" : "Custom")} active={activeId === b.id} onClick={() => void apply(b)} onRemove={() => void remove(b.id)}>
            <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: b.kind === "image" ? `url(${b.image})` : asImage(b.css ?? "") }} />
          </Tile>
        ))}
        <button onClick={() => fileInput.current?.click()} className="flex aspect-[16/10] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink">
          <ImagePlus size={15} /> <span className="whitespace-nowrap">Add photo</span>
        </button>
        <button onClick={() => setMaking((v) => !v)} aria-expanded={making} className={`flex aspect-[16/10] flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] transition-colors hover:bg-hover hover:text-ink ${making ? "border-ink text-ink" : "border-line-strong text-muted"}`}>
          <Palette size={15} /> <span className="whitespace-nowrap">Choose colour</span>
        </button>
      </div>
      <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && void onPick(e.target.files).finally(() => (e.target.value = ""))} />
      {making && (
        <FillMaker
          onSave={(css) => {
            void apply({ id: uid("bg_"), kind: "fill", css });
            setMaking(false);
          }}
        />
      )}
    </div>
  );
}

function Tile({ label, active, onClick, onRemove, children }: { label: string; active: boolean; onClick: () => void; onRemove?: () => void; children: ReactNode }) {
  return (
    <div className="group relative">
      <button onClick={onClick} title={label} aria-label={label} aria-pressed={active} className={`block aspect-[16/10] w-full overflow-hidden rounded-lg transition-shadow ${active ? "shadow-[0_0_0_2px_var(--text)]" : "hairline hover:shadow-[0_0_0_1px_var(--border-strong)]"}`}>
        {children}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          title="Remove"
          className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-raised text-muted opacity-0 shadow-soft transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

type FillKind = "linear" | "radial" | "solid";

/** Two colours, a style and a direction → a CSS background, previewed live. */
function FillMaker({ onSave }: { onSave: (css: string) => void }) {
  const [kind, setKind] = useState<FillKind>("linear");
  const [a, setA] = useState("#2a3a8c");
  const [b, setB] = useState("#e0845e");
  const [angle, setAngle] = useState(160);
  const css = kind === "solid" ? a : kind === "radial" ? `radial-gradient(120% 120% at 30% 20%, ${a} 0%, ${b} 100%)` : `linear-gradient(${angle}deg, ${a} 0%, ${b} 100%)`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
      <div className="aspect-[16/10] w-24 shrink-0 rounded-lg hairline" style={{ background: css }} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <Segmented
          id="fill-kind"
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { id: "linear", label: "Linear" },
            { id: "radial", label: "Radial" },
            { id: "solid", label: "Solid" },
          ]}
        />
        <ColorSwatch label="First colour" value={a} onChange={setA} />
        {kind !== "solid" && <ColorSwatch label="Second colour" value={b} onChange={setB} />}
        {kind === "linear" && <Slider label="Angle" value={angle} min={0} max={360} step={5} format={(v) => `${v}°`} onChange={setAngle} />}
      </div>
      <Button size="sm" variant="primary" onClick={() => onSave(css)}>
        Use
      </Button>
    </div>
  );
}

function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label title={label} className="relative block h-7 w-7 cursor-pointer overflow-hidden rounded-full shadow-[0_0_0_1px_var(--border-strong)] transition-transform hover:scale-105" style={{ background: value }}>
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
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
