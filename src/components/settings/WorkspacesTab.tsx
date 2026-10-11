import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Moon, MoreHorizontal, Plus, Power, Trash2 } from "lucide-react";
import { useUI, toast } from "../../state/ui";
import { useWorkspaces, secretKeys, type Workspace } from "../../state/workspaces";
import { useConnection } from "../../state/connection";
import { BoatClient, type BoatSandbox } from "../../lib/providers/boat";
import { secrets } from "../../lib/secrets";
import { openExternal } from "../../lib/platform";
import { Button, IconButton } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { WorkspaceAvatar, statusText } from "../shell/Sidebar";
import { Section } from "./common";
import { Popover, MenuItem } from "../ui/Popover";
import { boxdHibernate, boxdMachine, boxdWake, humanizeBoxd, verifyBoxdKey } from "../../lib/providers/boxd";

export function WorkspacesTab() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const setActive = useWorkspaces((s) => s.setActive);
  const addWs = useUI((s) => s.setAddWorkspace);
  const close = useUI((s) => s.closeSettings);
  const hasBoatKey = useWorkspaces((s) => s.hasBoatKey);
  const hasBoxdKey = useWorkspaces((s) => s.hasBoxdKey);
  const [sandboxes, setSandboxes] = useState<Record<string, BoatSandbox>>({});
  const [machines, setMachines] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const key = await secrets.get(secretKeys.boxd);
      const ids = workspaces.filter((w) => w.provider === "boxd" && w.sandboxId).map((w) => w.sandboxId!);
      if (!key || !ids.length) return;
      const out: Record<string, string> = {};
      await Promise.all(ids.map((id) => boxdMachine(key, id).then((m) => (out[id] = m.status)).catch(() => {})));
      setMachines(out);
    })();
  }, [workspaces]);

  useEffect(() => {
    void (async () => {
      const key = await secrets.get(secretKeys.boat);
      if (!key) return;
      const list = await new BoatClient(key).list().catch(() => []);
      setSandboxes(Object.fromEntries(list.map((s) => [s.id, s])));
    })();
  }, [workspaces.length]);

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
              sandbox={w.sandboxId ? sandboxes[w.sandboxId] : undefined}
              machine={w.sandboxId ? machines[w.sandboxId] : undefined}
              onSelect={() => void setActive(w.id)}
              onSandbox={(sb) => setSandboxes((p) => ({ ...p, [sb.id]: sb }))}
              onMachine={(id, st) => setMachines((p) => ({ ...p, [id]: st }))}
            />
          ))}
        </div>
      </Section>
      {(hasBoatKey || workspaces.some((w) => w.provider === "boat")) && (
        <Section title="Boat API key" desc={hasBoatKey ? "Saved in your keychain." : undefined}>
          <BoatKeyForm />
        </Section>
      )}
      {(hasBoxdKey || workspaces.some((w) => w.provider === "boxd")) && (
        <Section title="boxd API key" desc={hasBoxdKey ? "Saved in your keychain." : undefined}>
          <BoxdKeyForm />
        </Section>
      )}
    </>
  );
}

function WorkspaceCard({
  w,
  active,
  sandbox,
  machine,
  onSelect,
  onSandbox,
  onMachine,
}: {
  w: Workspace;
  active: boolean;
  sandbox?: BoatSandbox;
  machine?: string;
  onSelect: () => void;
  onSandbox: (s: BoatSandbox) => void;
  onMachine: (id: string, status: string) => void;
}) {
  const status = useConnection((s) => (s.workspaceId === w.id ? s.status : "idle"));
  const remove = useWorkspaces((s) => s.remove);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);

  async function boatAction(kind: "stop" | "resume") {
    if (w.provider === "boxd") return boxdAction(kind);
    const key = await secrets.get(secretKeys.boat);
    if (!key || !w.sandboxId) return;
    setBusy(kind);
    try {
      const c = new BoatClient(key);
      if (kind === "stop") {
        if (active) useConnection.getState().disconnect();
        await c.stop(w.sandboxId);
        toast({ tone: "ok", title: "Sandbox is going to sleep", body: "It costs nothing while asleep." });
      } else {
        await c.resume(w.sandboxId);
      }
      onSandbox(await c.get(w.sandboxId));
      if (kind === "resume" && active) useConnection.getState().retry();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function boxdAction(kind: "stop" | "resume") {
    const key = await secrets.get(secretKeys.boxd);
    if (!key || !w.sandboxId) return;
    setBusy(kind);
    try {
      if (kind === "stop") {
        if (active) useConnection.getState().disconnect();
        await boxdHibernate(key, w.sandboxId);
        toast({ tone: "ok", title: "Machine is hibernating", body: "You only pay for its disk while it sleeps." });
      } else {
        await boxdWake(key, w.sandboxId);
      }
      onMachine(w.sandboxId, (await boxdMachine(key, w.sandboxId)).status);
      if (kind === "resume" && active) useConnection.getState().retry();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", body: humanizeBoxd(e).message });
    } finally {
      setBusy(null);
    }
  }

  const sbState = w.provider === "boxd" ? machine : sandbox?.state;
  const asleep = w.provider === "boxd" ? machine === "hibernated" || machine === "suspended" || machine === "stopped" : sbState === "archived" || sbState === "archiving";

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
          <span className="text-[12.5px] text-muted">{w.provider === "boat" ? "Remove from Otto? The sandbox is kept." : w.provider === "boxd" ? "Remove from Otto? The machine is kept." : "Remove from Otto?"}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove(w.id)}>
            Remove
          </Button>
        </>
      ) : (
        <>
          {(w.provider === "boat" || w.provider === "boxd") &&
            (asleep ? (
              <Button size="sm" variant="ghost" icon={busy === "resume" ? <Spinner size={12} /> : <Power size={13} />} disabled={!!busy} onClick={() => boatAction("resume")}>
                Wake
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={busy === "stop" ? <Spinner size={12} /> : <Moon size={13} />} disabled={!!busy || !sandbox} onClick={() => boatAction("stop")}>
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
              {w.provider === "boat" && <MenuItem icon={<ExternalLink size={14} />} label="Open Boat dashboard" onClick={() => (setMenu(false), openExternal("https://boat.dev/dashboard"))} />}
              {w.provider === "boxd" && <MenuItem icon={<ExternalLink size={14} />} label="Open boxd console" onClick={() => (setMenu(false), openExternal("https://app.boxd.sh"))} />}
              <MenuItem icon={<Trash2 size={14} />} label="Remove" danger onClick={() => (setMenu(false), setConfirm(true))} />
            </div>
          </Popover>
        </>
      )}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function BoatKeyForm() {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!key.trim()) return;
        setSaving(true);
        setError(null);
        try {
          await new BoatClient(key.trim()).me();
          await useWorkspaces.getState().setBoatKey(key.trim());
          setKey("");
          toast({ tone: "ok", title: "Boat key updated" });
        } catch (err) {
          setError((err as Error).message);
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

function BoxdKeyForm() {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!key.trim()) return;
        setSaving(true);
        setError(null);
        try {
          await verifyBoxdKey(key.trim());
          await useWorkspaces.getState().setBoxdKey(key.trim());
          setKey("");
          toast({ tone: "ok", title: "boxd key updated" });
        } catch (err) {
          setError((err as Error).message);
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
