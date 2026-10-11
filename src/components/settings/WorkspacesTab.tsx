import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Moon, MoreHorizontal, Plus, Power, Trash2 } from "lucide-react";
import { useUI, toast } from "../../state/ui";
import { useWorkspaces, secretKeys, type CloudId, type Workspace } from "../../state/workspaces";
import { useConnection } from "../../state/connection";
import { secrets } from "../../lib/secrets";
import { openExternal } from "../../lib/platform";
import { Button, IconButton } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { WorkspaceAvatar, statusText } from "../shell/Sidebar";
import { Section } from "./common";
import { Popover, MenuItem } from "../ui/Popover";
import { CLOUD_OPS } from "../../lib/providers/ops";

export function WorkspacesTab() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const setActive = useWorkspaces((s) => s.setActive);
  const addWs = useUI((s) => s.setAddWorkspace);
  const close = useUI((s) => s.closeSettings);
  const keys = useWorkspaces((s) => s.keys);
  /** Machine state per sandbox id, read from each provider. */
  const [states, setStates] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const out: Record<string, string> = {};
      await Promise.all(
        workspaces.map(async (w) => {
          if (w.provider === "custom" || !w.sandboxId) return;
          const key = await secrets.get(secretKeys[w.provider]);
          if (!key) return;
          await CLOUD_OPS[w.provider]
            .status(key, w.sandboxId)
            .then((st) => (out[w.sandboxId!] = st))
            .catch(() => {});
        }),
      );
      setStates(out);
    })();
  }, [workspaces]);

  const clouds = (Object.keys(CLOUD_OPS) as CloudId[]).filter((c) => keys[c] || workspaces.some((w) => w.provider === c));

  return (
    <>
      <Section
        page
        title="Workspaces"
        action={
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => {
              close();
              addWs(true);
            }}
          >
            Add
          </Button>
        }
      >
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl bg-raised hairline">
          {workspaces.map((w) => (
            <WorkspaceCard
              key={w.id}
              w={w}
              active={w.id === activeId}
              machine={w.sandboxId ? states[w.sandboxId] : undefined}
              onSelect={() => void setActive(w.id)}
              onMachine={(id, st) => setStates((p) => ({ ...p, [id]: st }))}
            />
          ))}
        </div>
      </Section>
      {clouds.map((c) => (
        <Section key={c} title={`${CLOUD_OPS[c].name} API key`} desc={keys[c] ? "Saved in your keychain." : undefined}>
          <ProviderKeyForm provider={c} />
        </Section>
      ))}
    </>
  );
}

function WorkspaceCard({ w, active, machine, onSelect, onMachine }: { w: Workspace; active: boolean; machine?: string; onSelect: () => void; onMachine: (id: string, status: string) => void }) {
  const status = useConnection((s) => (s.workspaceId === w.id ? s.status : "idle"));
  const remove = useWorkspaces((s) => s.remove);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);

  const ops = w.provider === "custom" ? null : CLOUD_OPS[w.provider];

  async function cloudAction(kind: "stop" | "resume") {
    if (!ops || w.provider === "custom" || !w.sandboxId) return;
    const key = await secrets.get(secretKeys[w.provider]);
    if (!key) return toast({ tone: "error", title: `Add your ${ops.name} API key below first` });
    setBusy(kind);
    try {
      if (kind === "stop") {
        if (active) useConnection.getState().disconnect();
        await ops.sleep(key, w.sandboxId);
        toast({ tone: "ok", title: "Going to sleep", body: ops.sleptNote });
      } else {
        await ops.wake(key, w.sandboxId);
      }
      onMachine(w.sandboxId, await ops.status(key, w.sandboxId).catch(() => (kind === "stop" ? "stopped" : "running")));
      if (kind === "resume" && active) useConnection.getState().retry();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", body: ops.errorText ? ops.errorText(e) : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const sbState = machine;
  const asleep = !!(ops && machine && ops.isAsleep(machine));

  const host = w.provider === "boat" ? (w.sandboxId ?? "Boat") : new URL(w.baseUrl).host;
  const state = active ? statusText(status) : asleep ? "Asleep" : sbState ? cap(sbState) : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <WorkspaceAvatar provider={w.provider} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium">{w.name}</span>
          {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" title="Current workspace" />}
        </div>
        <div className="truncate text-[12.5px] text-muted">
          {host}
          {state && ` · ${state}`}
          {w.version && ` · v${w.version.replace(/^v/, "")}`}
        </div>
      </div>
      {confirm ? (
        <>
          <span className="text-[12.5px] text-muted">{ops ? `Remove from Otto? It stays in your ${ops.name} account.` : "Remove from Otto?"}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove(w.id)}>
            Remove
          </Button>
        </>
      ) : (
        <>
          {ops &&
            (asleep ? (
              <Button size="sm" variant="ghost" icon={busy === "resume" ? <Spinner size={12} /> : <Power size={13} />} disabled={!!busy} onClick={() => cloudAction("resume")}>
                Wake
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={busy === "stop" ? <Spinner size={12} /> : <Moon size={13} />} disabled={!!busy || !machine} onClick={() => cloudAction("stop")}>
                Sleep
              </Button>
            ))}
          {!active && (
            <Button size="sm" onClick={onSelect}>
              Switch
            </Button>
          )}
          <IconButton ref={more} label="More" size={28} active={menu} onClick={() => setMenu((v) => !v)}>
            <MoreHorizontal size={15} />
          </IconButton>
          <Popover open={menu} onClose={() => setMenu(false)} anchor={more.current} placement="bottom-end" width={200}>
            <div className="p-1">
              {ops && <MenuItem icon={<ExternalLink size={14} />} label={`Open ${ops.name} dashboard`} onClick={() => (setMenu(false), openExternal(ops.dashboard))} />}
              <MenuItem icon={<Trash2 size={14} />} label="Remove" danger onClick={() => (setMenu(false), setConfirm(true))} />
            </div>
          </Popover>
        </>
      )}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ProviderKeyForm({ provider }: { provider: CloudId }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ops = CLOUD_OPS[provider];
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!key.trim()) return;
        setSaving(true);
        setError(null);
        try {
          await ops.verify(key.trim());
          await useWorkspaces.getState().setProviderKey(provider, key.trim());
          setKey("");
          toast({ tone: "ok", title: `${ops.name} key updated` });
        } catch (err) {
          setError(ops.errorText ? ops.errorText(err) : (err as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="flex-1">
        <TextField type="password" placeholder="Paste a new key" value={key} onChange={(e) => setKey(e.target.value)} error={error} trailing={<KeyRound size={15} className="text-faint" />} />
      </div>
      <Button type="submit" className="h-9" disabled={saving || !key.trim()}>
        {saving ? <Spinner /> : "Save"}
      </Button>
    </form>
  );
}
