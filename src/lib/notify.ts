/**
 * System notifications (Tauri plugin on desktop/mobile, Web Notification in
 * the browser). Only fired while the app is in the background.
 */
import { isTauri } from "./platform";

export async function requestNotifyPermission(): Promise<boolean> {
  if (isTauri) {
    const n = await import("@tauri-apps/plugin-notification");
    if (await n.isPermissionGranted()) return true;
    return (await n.requestPermission()) === "granted";
  }
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
}

export function appInBackground() {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

export async function notify(title: string, body?: string) {
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      if (!(await n.isPermissionGranted())) return;
      n.sendNotification({ title, body });
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
  } catch {
    /* notifications are best effort */
  }
}
