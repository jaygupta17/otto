import { Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { Popover, MenuItem } from "../ui/Popover";
import { providerName } from "../chat/Pickers";
import { SearchBox } from "./common";
import { fieldTrigger } from "../ui/Select";

export interface ModelValue {
  providerID: string;
  id: string;
  variant?: string;
}

/** Model chooser for settings forms; `null` means "inherit". */
export function ModelSelect({ value, onChange, inheritLabel = "Use default model" }: { value: ModelValue | null; onChange: (v: ModelValue | null) => void; inheritLabel?: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const models = useChat((s) => s.models);
  const broken = useChat((s) => s.brokenModels);
  const info = value ? models.find((m) => m.providerID === value.providerID && m.id === value.id) : null;

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return models
      .filter((m) => m.status !== "deprecated" && !broken.includes(`${m.providerID}/${m.id}`) && (!t || `${m.name} ${m.id} ${m.providerID}`.toLowerCase().includes(t)))
      .sort((a, b) => a.providerID.localeCompare(b.providerID) || b.time.released - a.time.released)
      .slice(0, t ? 80 : 40);
  }, [models, q, broken]);

  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} aria-expanded={open} className={fieldTrigger}>
        <span className="min-w-0 flex-1 truncate text-ink">
          {value ? `${info?.name ?? value.id}` : inheritLabel}
          {value && <span className="ml-1.5 text-faint">{providerName(value.providerID)}</span>}
          {value?.variant && value.variant !== "default" && <span className="ml-1.5 text-muted">· {value.variant}</span>}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} width={Math.max(300, anchor.current?.offsetWidth ?? 300)}>
        <div className="border-b border-line p-2">
          <SearchBox autoFocus value={q} onChange={setQ} placeholder="Search models" />
        </div>
        <div className="scroll-quiet max-h-[320px] overflow-y-auto p-1.5">
          <MenuItem label={inheritLabel} active={!value} right={!value ? <Check size={15} className="text-muted" /> : undefined} onClick={() => (onChange(null), setOpen(false))} />
          {list.map((m) => {
            const on = value?.providerID === m.providerID && value?.id === m.id;
            return (
              <MenuItem
                key={`${m.providerID}/${m.id}`}
                label={m.name}
                hint={providerName(m.providerID)}
                active={on}
                right={on ? <Check size={15} className="text-muted" /> : undefined}
                onClick={() => {
                  onChange({ providerID: m.providerID, id: m.id });
                  setOpen(false);
                }}
              />
            );
          })}
        </div>
        {info && info.variants?.length > 0 && value && (
          <div className="flex flex-wrap items-center gap-1 border-t border-line p-2">
            <span className="px-1.5 text-[12px] text-muted">Effort</span>
            {info.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => onChange({ ...value, variant: v.id })}
                className={`rounded-lg px-2 py-1 text-[12.5px] capitalize ${(value.variant ?? "default") === v.id ? "bg-active font-medium text-ink" : "text-muted hover:bg-hover"}`}
              >
                {v.id}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </>
  );
}
