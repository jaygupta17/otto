/**
 * The agent's screen, as the Browser panel shows it: which view is up, and
 * whether the person or the agent is driving.
 *
 * Watching is the default; the live view ignores input until the person
 * takes control. Taking control while the agent is mid-run pauses it (an
 * interrupt), and handing back tells it to look again and carry on. During a
 * handoff the agent is already waiting, so handing back just answers it.
 */
import { create } from "zustand";
import { asksFor, useChat, type FormLite } from "./chat";
import { useUI } from "./ui";
import { asHandoff, handoffAnswer, type Handoff } from "../lib/handoff";

export type BrowserView = "preview" | "screen";

const RESUME =
  "I took over the screen for a moment and I'm done. Things may have changed, so look again first (`otto-browser read` or `otto-browser tabs` for the browser) and then carry on with the task.";

interface ComputerState {
  view: BrowserView;
  setView(v: BrowserView): void;
  /** The person is driving the live view. */
  control: boolean;
  /** The session paused when the person took control mid-run. */
  paused: string | null;
  /** Bumped when asked to show the screen, so the phone can open its Browser page. */
  opened: number;
  /** The panel is streaming the screen; the chat's inline view shows a note instead of a second stream. */
  panelScreen: boolean;
  setPanelScreen(on: boolean): void;
  /** The screen fills the window. It holds the stream while it's up; the panel and the chat step aside. */
  focus: boolean;
  setFocus(on: boolean): void;
  /** Open the panel on the agent's screen, to watch. */
  showScreen(): void;
  /** Open the live view and take control. `sessionId`: the chat it's for (pauses it if it's running). */
  takeControl(sessionId?: string | null): Promise<void>;
  /** Give the screen back: answer the handoff, or resume the paused run. */
  handBack(sessionId?: string | null): Promise<void>;
  /** Stop driving without telling the agent anything. */
  release(): void;
  /** Turn a handoff down. */
  cancelHandoff(h: Handoff): Promise<void>;
}

/** The newest handoff waiting in `sessionId` or its subagents (any session when null). */
export function findHandoff(forms: Record<string, FormLite>, parents: Record<string, string>, sessionId: string | null | undefined): Handoff | null {
  const list = Object.values(forms).filter((f) => !sessionId || asksFor(parents, f.sessionID, sessionId));
  for (let i = list.length - 1; i >= 0; i--) {
    const h = asHandoff(list[i]);
    if (h) return h;
  }
  return null;
}

export function useHandoff(sessionId: string | null | undefined): Handoff | null {
  const forms = useChat((s) => s.forms);
  const parents = useChat((s) => s.parents);
  return findHandoff(forms, parents, sessionId);
}

export const useComputer = create<ComputerState>((set, get) => ({
  view: "preview",
  setView(view) {
    set({ view });
  },
  control: false,
  paused: null,
  opened: 0,
  panelScreen: false,
  setPanelScreen(panelScreen) {
    set({ panelScreen });
  },
  focus: false,
  setFocus(focus) {
    set({ focus });
  },

  showScreen() {
    set({ view: "screen", opened: get().opened + 1 });
    useUI.getState().openPanel("browser");
  },

  async takeControl(sessionId) {
    const ui = useUI.getState();
    // Driving gets the whole window. On a computer the panel opens behind it, so leaving full screen keeps the screen
    // in view; the phone goes back to the chat, where the screen card picks the stream up.
    set({ view: "screen", control: true, focus: true });
    ui.openPanel("browser");
    const chat = useChat.getState();
    const sid = sessionId ?? chat.activeId;
    if (!sid || findHandoff(chat.forms, chat.parents, sid)) return;
    if (chat.busy[sid]) {
      set({ paused: sid });
      await chat.interrupt(sid);
    }
  },

  async handBack(sessionId) {
    const chat = useChat.getState();
    const { paused } = get();
    set({ control: false, paused: null, focus: false });
    const h = findHandoff(chat.forms, chat.parents, sessionId ?? chat.activeId) ?? findHandoff(chat.forms, chat.parents, null);
    if (h) {
      await chat.replyForm(h.form, handoffAnswer(h, true));
      return;
    }
    if (paused) await chat.send(RESUME, { sessionId: paused }).catch(() => {});
  },

  release() {
    set({ control: false, paused: null, focus: false });
  },

  async cancelHandoff(h) {
    set({ control: false, paused: null, focus: false });
    await useChat.getState().replyForm(h.form, handoffAnswer(h, false));
  },
}));
