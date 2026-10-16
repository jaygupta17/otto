/**
 * Handoffs: the agent stops and asks the person to do something on its
 * machine's screen (sign in, a code, a CAPTCHA), then carries on.
 *
 * The agent asks with its built-in `question` tool, one question whose header
 * is HANDOFF_HEADER and options Done / Cancel (the browser skill says so).
 * OpenCode turns that into a form whose single field has that title; the tool
 * call blocks until the form is answered, so the agent resumes exactly where
 * it stopped.
 */
import { HANDOFF_HEADER } from "./providers/boatBrowser";
import type { FormLite } from "../state/chat";

export interface Handoff {
  form: FormLite;
  /** What the agent wants the person to do. */
  reason: string;
  /** The answers that mean "done" and "stop", as the form spells them. */
  done: string;
  cancel: string;
}

export function asHandoff(form: FormLite): Handoff | null {
  const f = form.fields.length === 1 ? form.fields[0] : undefined;
  if (!f || f.title?.trim().toLowerCase() !== HANDOFF_HEADER.toLowerCase()) return null;
  const opts = f.options ?? [];
  const pick = (re: RegExp, fallback: string) => opts.find((o) => re.test(o.label ?? o.value))?.value ?? fallback;
  return {
    form,
    reason: (f.description ?? "").trim() || "The agent needs you to take over the screen for a moment.",
    done: pick(/^done/i, "Done"),
    cancel: pick(/^cancel/i, "Cancel"),
  };
}

/** The value to send back for an answer (a multiselect field takes a list). */
export function handoffAnswer(h: Handoff, done: boolean): Record<string, unknown> {
  const f = h.form.fields[0];
  const v = done ? h.done : h.cancel;
  return { [f.key]: f.type === "multiselect" ? [v] : v };
}
