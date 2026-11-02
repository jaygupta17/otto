import { Check, Plug } from "lucide-react";
import { useContext, useEffect, useMemo, useState } from "react";
import type { IntegrationInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { connectionSummary, connectMethods, isRemoteUrl } from "../../lib/integrations";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { providerName } from "../chat/Pickers";
import { Empty, LoadMore, PhonePage, SearchBox, Section } from "./common";
import { ProviderConnect } from "./ProviderConnect";

const POPULAR = ["anthropic", "openai", "openrouter", "google", "opencode", "deepseek", "xai", "groq", "mistral"];
const PAGE = 30;

export function ProvidersTab() {
  const phone = useContext(PhonePage);
  const client = useChat((s) => s.client);
  const [list, setList] = useState<IntegrationInfo[] | null>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Read the list again and hand back one row, so a connect can check what the server recorded. */
  const reload = async (id?: string) => {
    if (!client) return undefined;
    const fresh = await client.integrations();
    setList(fresh);
    return id ? fresh.find((i) => i.id === id) : undefined;
  };
  const load = () => {
    if (!client) return;
    reload().catch((e) => setError((e as Error).message));
  };
  useEffect(load, [client]);
  useEffect(() => setShown(PAGE), [q]);

  // A browser sign-in is decided on the machine the server runs on: if that
  // isn't this device, browser flows can't finish here.
  const remote = client ? isRemoteUrl(client.endpoint.baseUrl) : false;

  const filtered = useMemo(() => {
    if (!list) return [];
    const term = q.trim().toLowerCase();
    // Anything with a way in: a key, a sign-in, a credential on the machine or
    // the provider's own login command. Env-only rows are advice, not a method.
    const connectable = list.filter((i) => connectMethods(i).length > 0);
    const rank = (i: IntegrationInfo) => (i.connections.length ? 0 : POPULAR.includes(i.id) ? 1 : 2);
    return connectable.filter((i) => !term || `${i.name} ${i.id}`.toLowerCase().includes(term)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [list, q]);

  if (!client) return <Empty icon={<Plug size={20} />} title="Not connected" body="Connect to a workspace to manage providers." />;
  const visible = filtered.slice(0, shown);

  return (
    <Section page title="Providers" desc="Keys and sign-ins stay on your agent server. Free models need none.">
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
        {visible.map((i) => {
          const state = connectionSummary(i);
          return (
            <div key={i.id} className={phone ? "px-4 py-2" : "px-4 py-2.5"}>
              <div className="flex min-h-9 items-center gap-3">
                <div className={`min-w-0 flex-1 truncate ${phone ? "text-[15px]" : "text-[13px]"}`}>{providerName(i.id) === i.id ? i.name : providerName(i.id)}</div>
                {state.needsAuth ? (
                  <span className="text-[12px] text-warn">Needs sign-in</span>
                ) : state.connected ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-ok">
                    <Check size={14} /> Connected
                  </span>
                ) : null}
                {state.connected ? (
                  <Button size="sm" variant="ghost" className={phone ? "h-9 px-3 text-[14px]" : undefined} onClick={() => setOpen(open === i.id ? null : i.id)}>
                    Manage
                  </Button>
                ) : (
                  <Button size="sm" className={phone ? "h-9 px-3.5 text-[14px]" : undefined} onClick={() => setOpen(open === i.id ? null : i.id)}>
                    Connect
                  </Button>
                )}
              </div>
              {open === i.id && (
                <ProviderConnect
                  info={i}
                  remote={remote}
                  refresh={() => reload(i.id)}
                  onDone={() => {
                    setOpen(null);
                    load();
                    // A user just changed providers: one failure toast is useful here.
                    void useChat.getState().refreshCatalog({ silent: false });
                  }}
                />
              )}
            </div>
          );
        })}
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
