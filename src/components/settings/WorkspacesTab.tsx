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

export function WorkspacesTab() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const setActive = useWorkspaces((s) => s.setActive);
  const addWs = useUI((s) => s.setAddWorkspace);
  const close = useUI((s) => s.closeSettings);
  const hasBoatKey = useWorkspaces((s) => s.hasBoatKey);
  const [sandboxes, setSandboxes] = useState<Record<string, BoatSandbox>>({});

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
            <WorkspaceCard key={w.id} w={w} active={w.id === activeId} sandbox={w.sandboxId ? sandboxes[w.sandboxId] : undefined} onSelect={() => void setActive(w.id)} onSandbox={(sb) => setSandboxes((p) => ({ ...p, [sb.id]: sb }))} />
          ))}
        </div>
      </Section>
      <Section title="Boat API key" desc={hasBoatKey ? "Saved in your keychain." : undefined}>
        <BoatKeyForm />
      </Section>
    </>
  );
}

function WorkspaceCard({ w, active, sandbox, onSelect, onSandbox }: { w: Workspace; active: boolean; sandbox?: BoatSandbox; onSelect: () => void; onSandbox: (s: BoatSandbox) => void }) {
  const status = useConnection((s) => (s.workspaceId === w.id ? s.status : "idle"));
  const remove = useWorkspaces((s) => s.remove);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);

  async function boatAction(kind: "stop" | "resume") {
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

  const sbState = sandbox?.state;
  const asleep = sbState === "archived" || sbState === "archiving";

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
          <span className="text-[12.5px] text-muted">{w.provider === "boat" ? "Remove from Otto? The sandbox is kept." : "Remove from Otto?"}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove(w.id)}>
            Remove
          </Button>
        </>
      ) : (
        <>
          {w.provider === "boat" &&
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
