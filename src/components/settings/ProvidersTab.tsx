import { Check, Plug } from "lucide-react";
import { useContext, useEffect, useMemo, useState } from "react";
import type { IntegrationInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { toast } from "../../state/ui";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { providerName } from "../chat/Pickers";
import { Empty, LoadMore, PhonePage, SearchBox, Section } from "./common";

const POPULAR = ["anthropic", "openai", "openrouter", "google", "opencode", "deepseek", "xai", "groq", "mistral"];
const PAGE = 30;

export function ProvidersTab() {
  const phone = useContext(PhonePage);
  const client = useChat((s) => s.client);
  const [list, setList] = useState<IntegrationInfo[] | null>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!client) return;
    client
      .integrations()
      .then(setList)
      .catch((e) => setError((e as Error).message));
  };
  useEffect(load, [client]);
  useEffect(() => setShown(PAGE), [q]);

  const filtered = useMemo(() => {
    if (!list) return [];
    const term = q.trim().toLowerCase();
    const keyable = list.filter((i) => i.methods.some((m) => m.type === "key"));
    const rank = (i: IntegrationInfo) => (i.connections.length ? 0 : POPULAR.includes(i.id) ? 1 : 2);
    return keyable.filter((i) => !term || `${i.name} ${i.id}`.toLowerCase().includes(term)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [list, q]);

  if (!client) return <Empty icon={<Plug size={20} />} title="Not connected" body="Connect to a workspace to manage providers." />;
  const visible = filtered.slice(0, shown);

  return (
    <Section page title="Providers" desc="Keys stay on your agent server. Free models need none.">
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${list?.length ?? ""} providers`} />
      </div>
      {error && <div className="text-[13px] text-danger">{error}</div>}
      {!list && !error && (
        <div className="flex justify-center py-8 text-muted">
          <Spinner />
        </div>
      )}
      {list && filtered.length === 0 && <div className="py-8 text-center text-[13px] text-faint">No providers match “{q}”.</div>}
      <div className="divide-y divide-[var(--border)] overflow-hidden group-card">
        {visible.map((i) => (
          <div key={i.id} className={phone ? "px-4 py-2" : "px-4 py-2.5"}>
            <div className="flex min-h-9 items-center gap-3">
              <div className={`min-w-0 flex-1 truncate ${phone ? "text-[15px]" : "text-[13px]"}`}>{providerName(i.id) === i.id ? i.name : providerName(i.id)}</div>
              {i.connections.length ? (
                <span className="flex items-center gap-1.5 text-[12px] text-ok">
                  <Check size={14} /> Connected
                </span>
              ) : (
                <Button size="sm" className={phone ? "h-9 px-3.5 text-[14px]" : undefined} onClick={() => setEditing(editing === i.id ? null : i.id)}>
                  Connect
                </Button>
              )}
            </div>
            {editing === i.id && (
              <ConnectKey
                id={i.id}
                onDone={() => {
                  setEditing(null);
                  load();
                  // A user just changed providers: one failure toast is useful here.
                  void useChat.getState().refreshCatalog({ silent: false });
                }}
              />
            )}
          </div>
        ))}
      </div>
      {visible.length < filtered.length && (
        <>
          <LoadMore active onVisible={() => setShown((n) => Math.min(filtered.length, n + PAGE))} />
          <div className="flex justify-center py-3 text-[12px] text-faint">
            Showing {visible.length} of {filtered.length}
          </div>
        </>
      )}
    </Section>
  );
}

function ConnectKey({ id, onDone }: { id: string; onDone: () => void }) {
  const client = useChat((s) => s.client);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-3 flex items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!client || !key.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await client.connectKey(id, key.trim());
          toast({ tone: "ok", title: `${providerName(id)} connected` });
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex-1">
        <TextField autoFocus type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} error={error} />
      </div>
      <Button type="submit" variant="primary" className="h-11" disabled={busy || !key.trim()}>
        {busy ? <Spinner /> : "Save"}
      </Button>
    </form>
  );
}
