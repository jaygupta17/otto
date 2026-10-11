/**
 * System notifications: the Tauri plugin on desktop and phones, the Web
 * Notification API in a browser. Tapping one opens its session (phones and
 * browsers report the tap; desktop just brings the window forward).
 */
import { isTauri, osName } from "./platform";

const CHANNEL = "agent";

export type Permission = "granted" | "denied" | "default";

export async function notifyPermission(): Promise<Permission> {
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      return (await n.isPermissionGranted()) ? "granted" : "default";
    }
    if (!("Notification" in window)) return "denied";
    return Notification.permission;
  } catch {
    return "denied";
  }
}

export async function requestNotifyPermission(): Promise<boolean> {
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      if (await n.isPermissionGranted()) return true;
      return (await n.requestPermission()) === "granted";
    }
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function appInBackground() {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

let tapHandler: ((sessionId: string) => void) | null = null;
let setup: Promise<void> | null = null;

/**
 * One-time setup: an Android channel with high importance (so alerts show as
 * heads-up banners), and a listener for taps.
 */
export function initNotifications(onTap: (sessionId: string) => void) {
  tapHandler = onTap;
  if (setup || !isTauri) return;
  setup = (async () => {
    try {
      const n = await import("@tauri-apps/plugin-notification");
      if (osName() === "android") {
        await n.createChannel({ id: CHANNEL, name: "Agent updates", description: "When an agent finishes or needs you", importance: n.Importance.High, vibration: true, lights: true }).catch(() => {});
      }
      if (osName() === "android" || osName() === "ios") {
        await n.onAction((note) => {
          const id = note.extra?.sessionId;
          if (typeof id === "string") tapHandler?.(id);
        });
      }
    } catch {
      /* best effort */
    }
  })();
}

let nextId = 1;

export async function notify(title: string, body?: string, sessionId?: string) {
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      if (!(await n.isPermissionGranted())) return;
      await setup;
      n.sendNotification({
        id: nextId++,
        title,
        body,
        channelId: osName() === "android" ? CHANNEL : undefined,
        // One stack per session in the shade.
        group: sessionId,
        autoCancel: true,
        extra: sessionId ? { sessionId } : undefined,
      });
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") {
      // `tag` replaces an older alert for the same session instead of piling up.
      const note = new Notification(title, { body, tag: sessionId });
      note.onclick = () => {
        window.focus();
        if (sessionId) tapHandler?.(sessionId);
        note.close();
      };
    }
  } catch {
    /* notifications are best effort */
  }
}
