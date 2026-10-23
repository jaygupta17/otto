import { AnimatePresence, motion } from "motion/react";
import { Globe, Plug, Plus, RefreshCw, Terminal, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useChat } from "../../state/chat";
import { useExtensions } from "../../state/extensions";
import { toast } from "../../state/ui";
import type { McpServerConfig } from "../../lib/opencode/config";
import type { McpServer } from "../../lib/opencode/client";
import { Button, IconButton } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { Card, Empty, Label, Section, Segmented, StatusDot, Toggle } from "./common";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  connected: { label: "Connected", tone: "ok" },
  pending: { label: "Connecting…", tone: "warn" },
  disabled: { label: "Off", tone: "muted" },
  failed: { label: "Failed", tone: "danger" },
  needs_auth: { label: "Needs sign-in", tone: "warn" },
};

/** Quick-add catalog of popular MCP servers. */
const POPULAR: { name: string; label: string; desc: string; config: McpServerConfig }[] = [
  { name: "context7", label: "Context7", desc: "Up-to-date library docs", config: { type: "remote", url: "https://mcp.context7.com/mcp" } },
  { name: "playwright", label: "Playwright", desc: "Drive a real browser", config: { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"] } },
  { name: "github", label: "GitHub", desc: "Issues, PRs and repos", config: { type: "remote", url: "https://api.githubcopilot.com/mcp/" } },
  { name: "sequential-thinking", label: "Sequential thinking", desc: "Structured step-by-step reasoning", config: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"] } },
];

export function McpTab() {
  const mcp = useExtensions((s) => s.mcp);
  const config = useExtensions((s) => s.config);
  const load = useExtensions((s) => s.load);
  const loadMcp = useExtensions((s) => s.loadMcp);
  const update = useExtensions((s) => s.update);
  const client = useChat((s) => s.client);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void load();
    void loadMcp();
    const t = setInterval(() => void loadMcp(), 5000);
    return () => clearInterval(t);
  }, [load, loadMcp]);

  const servers = config?.mcp?.servers ?? {};
  const names = [...new Set([...Object.keys(servers), ...(mcp ?? []).map((m) => m.name)])].sort();

  async function toggle(name: string, on: boolean) {
    if (!client) return;
    setBusy(name);
    try {
      if (servers[name]) await update((c) => ({ ...c, mcp: { ...(c.mcp ?? {}), servers: { ...(c.mcp?.servers ?? {}), [name]: { ...c.mcp!.servers![name], disabled: !on } } } }));
      if (on) await client.mcpConnect(name).catch(() => {});
      else await client.mcpDisconnect(name).catch(() => {});
      await loadMcp();
    } finally {
      setBusy(null);
    }
  }

  async function remove(name: string) {
    if (!client) return;
    setBusy(name);
    await client.mcpRemove(name).catch(() => {});
    await update(
      (c) => {
        const s = { ...(c.mcp?.servers ?? {}) };
        delete s[name];
        return { ...c, mcp: { ...(c.mcp ?? {}), servers: s } };
      },
      { success: `Removed ${name}` },
    );
    await loadMcp();
    setBusy(null);
  }

  async function add(name: string, cfg: McpServerConfig) {
    if (!client) return false;
    setBusy(name);
    try {
      const ok = await update((c) => ({ ...c, mcp: { ...(c.mcp ?? {}), servers: { ...(c.mcp?.servers ?? {}), [name]: cfg } } }), { success: `Added ${name}` });
      if (ok) {
        // Connect now instead of waiting for the file watcher. A local server
        // may install itself first (npx), so this can take a while.
        await client.mcpPut(name, cfg as never).catch(() => {});
        await loadMcp();
      }
      return ok;
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Section
        page
        title="MCP servers"
        desc="Tools your agents can call."
        action={
          <div className="flex gap-1.5">
            <IconButton label="Refresh" onClick={() => void loadMcp()}>
              <RefreshCw size={15} />
            </IconButton>
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding((v) => !v)}>
              Add server
            </Button>
          </div>
        }
      >
        <AnimatePresence initial={false}>
          {adding && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <AddServer onClose={() => setAdding(false)} onAdd={add} existing={names} />
            </motion.div>
          )}
        </AnimatePresence>
        {mcp === null || !config ? (
          <div className="flex justify-center py-10 text-muted">
            <Spinner />
          </div>
        ) : names.length === 0 ? (
          <Empty icon={<Plug size={20} />} title="No servers yet" />
        ) : (
          <Card className="divide-y divide-[var(--border)]">
            {names.map((n) => (
              <ServerRow key={n} name={n} cfg={servers[n]} live={mcp.find((m) => m.name === n)} busy={busy === n} onToggle={(v) => void toggle(n, v)} onRemove={() => void remove(n)} />
            ))}
          </Card>
        )}
      </Section>
      <Section title="Popular">
        <div className="group-card divide-y divide-[var(--border)] overflow-hidden">
          {POPULAR.map((p) => {
            const installed = names.includes(p.name);
            return (
              <div key={p.name} className="flex items-center gap-3 px-4 py-2.5">
                <span className="grid w-5 shrink-0 place-items-center text-muted">{p.config.type === "remote" ? <Globe size={16} /> : <Terminal size={16} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{p.label}</span>
                  <span className="block truncate text-[13px] text-muted">{p.desc}</span>
                </span>
                <Button size="sm" className="max-sm:h-9 max-sm:px-3.5 max-sm:text-[14px]" variant={installed && busy !== p.name ? "ghost" : "secondary"} disabled={installed || !!busy} onClick={() => void add(p.name, p.config)}>
                  {busy === p.name ? (
                    <span className="flex items-center gap-1.5">
                      <Spinner size={12} /> Adding
                    </span>
                  ) : installed ? (
                    "Added"
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function ServerRow({ name, cfg, live, busy, onToggle, onRemove }: { name: string; cfg?: McpServerConfig; live?: McpServer; busy: boolean; onToggle: (v: boolean) => void; onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const st = STATUS[live?.status.status ?? (cfg?.disabled ? "disabled" : "pending")] ?? STATUS.pending;
  const on = live ? live.status.status !== "disabled" : !cfg?.disabled;
  const detail = cfg?.type === "remote" ? cfg.url : cfg?.command?.join(" ");
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid w-5 shrink-0 place-items-center text-muted">{cfg?.type === "remote" ? <Globe size={16} /> : <Terminal size={16} />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold">{name}</span>
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <StatusDot tone={st.tone} /> {st.label}
            </span>
            {!cfg && <span className="rounded-md bg-sunken px-1.5 text-[12px] text-faint">runtime only</span>}
          </div>
          {detail && <div className="truncate font-mono text-[12px] text-faint">{detail}</div>}
        </div>
        {busy ? <Spinner size={14} className="text-muted" /> : <Toggle on={on} onChange={onToggle} label={`Enable ${name}`} />}
        {confirm ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button size="sm" variant="danger" onClick={onRemove}>
              Remove
            </Button>
          </div>
        ) : (
          <IconButton label="Remove server" size={28} onClick={() => setConfirm(true)}>
            <Trash2 size={14} />
          </IconButton>
        )}
      </div>
      {live?.status.error && <div className="selectable mt-2 rounded-lg bg-danger-soft px-3 py-1.5 font-mono text-[12px] break-words text-danger">{live.status.error}</div>}
    </div>
  );
}

function AddServer({ onClose, onAdd, existing }: { onClose: () => void; onAdd: (name: string, cfg: McpServerConfig) => Promise<boolean>; existing: string[] }) {
  const [type, setType] = useState<"remote" | "local">("remote");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [kv, setKv] = useState<{ k: string; v: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const nameErr = name && (!/^[A-Za-z0-9][\w-]*$/.test(name) ? "Letters, numbers, - and _ only." : existing.includes(name) ? "Already exists." : null);

  async function submit() {
    if (!name || nameErr) return;
    const pairs = Object.fromEntries(kv.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v]));
    let cfg: McpServerConfig;
    if (type === "remote") {
      try {
        new URL(url);
      } catch {
        toast({ tone: "error", title: "Enter a valid URL" });
        return;
      }
      cfg = { type: "remote", url: url.trim(), ...(Object.keys(pairs).length ? { headers: pairs } : {}) };
    } else {
      const argv = splitCommand(command);
      if (!argv.length) return;
      cfg = { type: "local", command: argv, ...(Object.keys(pairs).length ? { environment: pairs } : {}) };
    }
    setSaving(true);
    const ok = await onAdd(name, cfg);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <div className="mb-4 group-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <Segmented
          id="mcp-type"
          value={type}
          onChange={setType}
          options={[
            { id: "remote", label: "Remote (URL)" },
            { id: "local", label: "Local (command)" },
          ]}
        />
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" placeholder="my-server" value={name} onChange={(e) => setName(e.target.value)} error={nameErr} />
        {type === "remote" ? (
          <TextField label="URL" placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
        ) : (
          <TextField label="Command" placeholder="npx -y @scope/mcp-server" value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono" />
        )}
      </div>
      <div className="mt-4">
        <Label hint="optional">{type === "remote" ? "Headers" : "Environment variables"}</Label>
        <div className="space-y-1.5">
          {kv.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input value={row.k} onChange={(e) => setKv(kv.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder={type === "remote" ? "Authorization" : "API_KEY"} className="field h-9 w-2/5 rounded-lg px-2.5 font-mono text-[12px] outline-none" />
              <input value={row.v} onChange={(e) => setKv(kv.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder="value" type="password" className="field h-9 min-w-0 flex-1 rounded-lg px-2.5 font-mono text-[12px] outline-none" />
              <IconButton label="Remove" size={36} onClick={() => setKv(kv.filter((_, j) => j !== i))}>
                <X size={14} />
              </IconButton>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setKv([...kv, { k: "", v: "" }])}>
            Add {type === "remote" ? "header" : "variable"}
          </Button>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" size="sm" disabled={saving || !name || !!nameErr || (type === "remote" ? !url : !command.trim())} onClick={() => void submit()}>
          {saving ? <Spinner size={13} /> : "Add server"}
        </Button>
      </div>
    </div>
  );
}

/** Split a command line respecting simple quotes. */
function splitCommand(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const c of s.trim()) {
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") q = c;
    else if (/\s/.test(c)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
