/**
 * What another app shared with Otto (Android's share sheet): text, a link,
 * files. It waits here until you pick where it goes: a new session with an
 * agent, or a session you already have. There it fills the reply box, and the
 * files upload like any attachment, so you can add to it before sending.
 */
import { create } from "zustand";
import { MAX_UPLOAD, mimeOf } from "../lib/attachments";
import { bytes } from "../lib/format";
import { isTauri, osName } from "../lib/platform";
import { useAttachments } from "./attachments";
import { useChat } from "./chat";
import { toast, useUI } from "./ui";

interface Payload {
  text?: string;
  subject?: string;
  files?: { name: string; mime?: string; size: number; path?: string }[];
}

export interface Incoming {
  text: string;
  files: File[];
  /** Files left behind: too big, or unreadable. */
  skipped: string[];
}

export type ShareTarget = { agent: string } | { session: string };

interface ShareState {
  incoming: Incoming | null;
  dismiss(): void;
  deliver(to: ShareTarget): void;
}

export const useShare = create<ShareState>((set, get) => ({
  incoming: null,

  dismiss() {
    set({ incoming: null });
  },

  deliver(to) {
    const inc = get().incoming;
    if (!inc) return;
    set({ incoming: null });
    const chat = useChat.getState();
    const key = "session" in to ? to.session : "new";
    const root = ("session" in to ? chat.sessions[to.session]?.location.directory : null) ?? chat.projectDir ?? chat.homeDir ?? "";
    if (inc.text) {
      const had = (chat.drafts[key] ?? "").trimEnd();
      chat.setDraft(key, had ? `${had}\n\n${inc.text}` : inc.text);
    }
    if (inc.files.length) useAttachments.getState().add(key, inc.files, root);
    if ("session" in to) chat.open(to.session);
    else {
      chat.open(null);
      void chat.setAgent(to.agent, null);
      useUI.getState().setDraftOpen(true);
    }
    if (inc.skipped.length) toast({ tone: "error", title: inc.skipped.length === 1 ? `${inc.skipped[0]} wasn't attached` : `${inc.skipped.length} files weren't attached`, body: `Files over ${bytes(MAX_UPLOAD)} can't be attached.` });
  },
}));

/** A link with its page title reads as one: the title, then the link. */
function compose(text = "", subject = ""): string {
  const t = text.trim();
  const s = subject.trim();
  if (s && t && !t.includes(s)) return `${s}\n${t}`;
  return t || s;
}

let taking: Promise<void> | null = null;

async function take() {
  const { invoke } = await import("@tauri-apps/api/core");
  const p = await invoke<Payload>("plugin:share|take");
  const text = compose(p.text, p.subject);
  const files: File[] = [];
  const skipped: string[] = [];
  for (const f of p.files ?? []) {
    if (!f.path) {
      skipped.push(f.name);
      continue;
    }
    try {
      const buf = await invoke<ArrayBuffer>("plugin:share|read", { path: f.path });
      files.push(new File([buf], f.name, { type: mimeOf(f.name, f.mime) }));
    } catch {
      skipped.push(f.name);
    }
  }
  if (!text && !files.length && !skipped.length) return;
  // A newer share replaces one you haven't placed yet.
  useShare.setState({ incoming: { text, files, skipped } });
}

/** Android only: pick up a share the app was opened with, and any that arrive while it's open. */
export function initShare() {
  if (!isTauri || osName() !== "android") return;
  const check = () => {
    taking ??= take()
      .catch((e) => console.warn("share: take failed", e))
      .finally(() => (taking = null));
  };
  check();
  void import("@tauri-apps/api/core").then(({ addPluginListener }) => addPluginListener("share", "shared", check)).catch(() => {});
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
}
