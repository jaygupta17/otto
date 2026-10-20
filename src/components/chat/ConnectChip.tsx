/**
 * The link an agent hands you to connect an app, as a button with the app's
 * face. It follows the sign-in: waiting while you're in the browser, then
 * connected, with one tap to let the agent carry on.
 */
import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { APPS, appLogo, appName } from "../../lib/composio";
import { useChat } from "../../state/chat";
import { useConnectors } from "../../state/connectors";

/** "Connect googlecalendar", "Connect Google Calendar" → the app. */
function appFrom(label: string): string | null {
  const t = label.toLowerCase().replace(/^connect\s+/, "").replace(/[^a-z0-9]/g, "");
  if (!t) return null;
  return APPS.find((a) => a.slug === t || a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === t)?.slug ?? (/^[a-z0-9]+$/.test(t) ? t : null);
}

const text = (n: ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(text).join("") : "");

export function ConnectChip({ href, children }: { href: string; children: ReactNode }) {
  const slug = appFrom(text(children));
  const state = useConnectors((s) => s.links[href]);
  const follow = useConnectors((s) => s.follow);
  const [told, setTold] = useState(false);
  const name = slug ? appName(slug) : "the app";

  const carryOn = () => {
    const chat = useChat.getState();
    if (!chat.activeId) return;
    setTold(true);
    void chat.send(`I've connected ${name}. Carry on.`, { sessionId: chat.activeId });
  };

  return (
    <span className="not-prose my-0.5 inline-flex max-w-full items-center gap-1 align-middle">
      <button
        onClick={() => void follow(slug, href)}
        disabled={state === "connected"}
        className="inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-raised py-0 pl-1 pr-3 text-[13px] font-medium text-ink no-underline hairline transition-colors hover:bg-hover disabled:hover:bg-raised"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white">{slug ? <img src={appLogo(slug)} alt="" width={14} height={14} draggable={false} /> : null}</span>
        <span className="truncate">{state === "connected" ? `${name} connected` : state === "waiting" ? "Waiting for you in the browser…" : `Connect ${name}`}</span>
        {state === "connected" ? <Check size={14} className="text-ok" /> : state === "waiting" ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-info" aria-hidden /> : null}
      </button>
      {state === "connected" && !told && (
        <button onClick={carryOn} className="inline-flex h-8 items-center rounded-full bg-ink px-3 text-[13px] font-medium text-bg no-underline hover:opacity-90">
          Carry on
        </button>
      )}
    </span>
  );
}
