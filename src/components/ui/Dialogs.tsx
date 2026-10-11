/**
 * Promise-based confirm and prompt dialogs, so an action can ask
 * `if (await confirmDialog({...}))` without owning any UI state.
 * A bottom sheet on phones, a small centered dialog elsewhere.
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useCompact } from "../../hooks/useMedia";
import { Sheet } from "./Sheet";
import { Button } from "./Button";

interface Request {
  title: string;
  body?: string;
  confirm?: string;
  danger?: boolean;
  /** Present for a prompt: the field's starting value. */
  value?: string;
  placeholder?: string;
  resolve: (v: string | boolean | null) => void;
}

const useDialogs = create<{ req: Request | null }>(() => ({ req: null }));

function open(req: Omit<Request, "resolve">) {
  return new Promise<string | boolean | null>((resolve) => {
    // A new dialog cancels whatever was still open.
    useDialogs.getState().req?.resolve(null);
    useDialogs.setState({ req: { ...req, resolve } });
  });
}

export async function confirmDialog(opts: { title: string; body?: string; confirm?: string; danger?: boolean }): Promise<boolean> {
  return (await open(opts)) === true;
}

export async function promptDialog(opts: { title: string; value?: string; placeholder?: string; confirm?: string }): Promise<string | null> {
  const v = await open({ ...opts, value: opts.value ?? "" });
  return typeof v === "string" ? v : null;
}

export function DialogHost() {
  const req = useDialogs((s) => s.req);
  const compact = useCompact();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const isPrompt = req?.value !== undefined;

  useEffect(() => {
    if (!req) return;
    setText(req.value ?? "");
    if (req.value !== undefined) setTimeout(() => input.current?.select(), 60);
  }, [req]);

  const done = (v: string | boolean | null) => {
    req?.resolve(v);
    useDialogs.setState({ req: null });
  };
  const submit = () => {
    if (!isPrompt) return done(true);
    if (text.trim()) done(text.trim());
  };

  return (
    <Sheet open={!!req} onClose={() => done(null)} compact={compact} narrow>
      {req && (
        <form
          className={compact ? "px-5 pt-2 pb-5" : "p-6"}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="text-[16px] font-semibold">{req.title}</div>
          {req.body && <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{req.body}</p>}
          {isPrompt && (
            <input
              ref={input}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={req.placeholder}
              className="field mt-4 h-11 w-full rounded-xl px-3.5 text-[16px] outline-none sm:h-9 sm:text-[14px]"
            />
          )}
          <div className={`mt-5 flex gap-2 ${compact ? "flex-col-reverse" : "justify-end"}`}>
            <Button type="button" variant="ghost" size={compact ? "lg" : "md"} onClick={() => done(null)}>
              Cancel
            </Button>
            <Button autoFocus={!isPrompt} type="submit" variant={req.danger ? "danger" : "primary"} size={compact ? "lg" : "md"} disabled={isPrompt && !text.trim()}>
              {req.confirm ?? (isPrompt ? "Save" : "OK")}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
