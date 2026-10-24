import { useEffect, useRef, useState } from "react";

/** Where the run is, coarse enough to say out loud. */
export type TurnPhase = "idle" | "working" | "retrying";

/** An inline failure from the latest turn: the text the error card shows. */
export interface RunError {
  /** The message it belongs to, not the words: the same failure in a later run has to be said again. */
  key: string;
  text: string;
}

/** A snapshot of the turn, compared between commits. Nothing in it moves while tokens stream. */
export interface TurnSignal {
  phase: TurnPhase;
  /** The attempt it's backing off on; 0 while it isn't retrying. */
  attempt: number;
  error: RunError | null;
}

export interface TurnAnnouncement {
  /** For the polite region: said once, when the state changes. */
  status?: string;
  /** For the alert region: a failure that just arrived. */
  alert?: RunError;
}

/** An error can be a whole log; nobody wants every word of it read to them. */
function speakable(text: string) {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
}

/**
 * What to say now that the turn moved from `prev` to `next`.
 *
 * `prev === null` is the first look at a session: what's already on screen isn't
 * news, so a history of failures stays quiet. Between two commits of a running
 * turn nothing changes, which is why no token is ever read out.
 */
export function turnAnnouncement(prev: TurnSignal | null, next: TurnSignal): TurnAnnouncement {
  if (!prev) return {};
  const out: TurnAnnouncement = {};
  if (next.error && next.error.key !== prev.error?.key) out.alert = { key: next.error.key, text: speakable(next.error.text) };

  const moved = next.phase !== prev.phase || (next.phase === "retrying" && next.attempt !== prev.attempt);
  if (!moved) return out;
  if (next.phase === "working") out.status = "Working";
  else if (next.phase === "retrying") out.status = next.attempt > 1 ? `Retrying, attempt ${next.attempt}` : "Retrying";
  // The alert has just said why the run stopped, so the region goes quiet rather than
  // burying it under "Done" — and blank, so the next run's "Working" is a change again.
  else out.status = next.error ? "" : "Done";
  return out;
}

/**
 * The turn's two live regions: polite for where the run is, assertive for a run
 * that failed. Both hold one message, replaced only when something happens, so
 * a screen reader hears each thing once instead of a stream of tokens.
 */
export function TurnStatus({ busy, retry, error }: { busy: boolean; retry?: { attempt: number; message: string; next: number }; error: RunError | null }) {
  const [status, setStatus] = useState("");
  const [alert, setAlert] = useState<RunError | null>(null);
  const seen = useRef<TurnSignal | null>(null);

  // No dependency list on purpose: every commit re-reads the turn, and `seen`
  // keeps each comparison against what was last announced.
  useEffect(() => {
    const next: TurnSignal = { phase: !busy ? "idle" : retry ? "retrying" : "working", attempt: retry?.attempt ?? 0, error };
    const said = turnAnnouncement(seen.current, next);
    seen.current = next;
    if (said.status !== undefined) setStatus(said.status);
    // Keep the alert to the error that's actually on screen: dropping it when the
    // message clears is what lets an identical failure next run be heard again.
    if (said.alert) setAlert(said.alert);
    else if (!next.error && alert) setAlert(null);
  });

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
      {/* The words ride in on their own node: an identical failure in a later run replaces it, and that insertion is what the region announces. */}
      <div role="alert" aria-live="assertive" className="sr-only">
        {alert && <span key={alert.key}>{alert.text}</span>}
      </div>
    </>
  );
}
