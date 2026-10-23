/**
 * What a session's bird wears, from what the session is doing. Every list,
 * chip and row asks here, so a teammate looks the same wherever you see it.
 */
import type { FaceState } from "../components/ui/Bird";
import type { Mood } from "../lib/flock/build";
import { asksFor, useChat } from "./chat";

type ChatState = ReturnType<typeof useChat.getState>;

/** True while the reply itself is streaming in (rather than tools running or the model thinking). */
function writing(st: ChatState, id: string) {
  const msgs = st.timelines[id]?.messages;
  const last = msgs?.at(-1);
  if (last?.kind !== "assistant") return false;
  const b = last.blocks.at(-1);
  return b?.kind === "text" && b.streaming;
}

export function faceOf(st: ChatState, id: string): FaceState {
  if (Object.values(st.permissions).some((p) => asksFor(st.parents, p.sessionID, id)) || Object.values(st.forms).some((f) => asksFor(st.parents, f.sessionID, id))) return "needs";
  if (st.retrying[id]) return "retrying";
  if (st.busy[id]) return writing(st, id) ? "writing" : "working";
  if (st.sessions[id]?.outcome === "failed") return "failed";
  if (st.unread[id]) return "done";
  return "idle";
}

export const useFace = (id: string | null | undefined) => useChat((st) => (id ? faceOf(st, id) : "idle"));

/** How strongly a state asks for a look, so a teammate with several sessions shows the loudest. */
const RANK: Record<FaceState, number> = { needs: 7, failed: 6, retrying: 5, writing: 4, working: 3, done: 2, stopped: 1, idle: 0 };
export const loudest = (a: FaceState, b: FaceState) => (RANK[b] > RANK[a] ? b : a);

/**
 * A teammate across its sessions (all of them unless given) and the parts of a
 * lead's job it's doing: the loudest. A failure you've already seen doesn't
 * keep it upset, and a part finishing is the lead's to report.
 */
export function mateFace(st: ChatState, agent: string, sessions?: string[]): FaceState {
  let f: FaceState = "idle";
  const own = sessions ?? Object.values(st.sessions).filter((x) => x.agent === agent).map((x) => x.id);
  for (const x of own) {
    const sf = faceOf(st, x);
    f = loudest(f, sf === "failed" && !st.unread[x] ? "idle" : sf);
  }
  for (const c of Object.keys(st.delegated)) {
    if (st.delegated[c] !== agent) continue;
    const cf = faceOf(st, c);
    if (cf !== "done" && cf !== "failed") f = loudest(f, cf);
  }
  return f;
}

const BUSY = new Set<FaceState>(["working", "writing", "retrying"]);

/** The moment a bird has between two states before it settles, if there is one. */
export function reaction(was: FaceState, now: FaceState): { mood: Mood; ms: number } | null {
  if (BUSY.has(was) && now === "done") return { mood: "party", ms: 2000 };
  if (BUSY.has(was) && now === "idle") return { mood: "happy", ms: 1300 };
  if (BUSY.has(was) && now === "failed") return { mood: "wow", ms: 800 };
  if (was === "needs" && BUSY.has(now)) return { mood: "love", ms: 1500 };
  if (was === "retrying" && (now === "working" || now === "writing")) return { mood: "cool", ms: 1400 };
  if (was === "working" && now === "writing") return { mood: "idea", ms: 1100 };
  return null;
}
