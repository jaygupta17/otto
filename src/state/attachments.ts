/**
 * Files waiting in a reply box, keyed like drafts ("new" or a session id).
 * Each uploads as soon as it's picked, so send only waits on the slow ones.
 */
import { create } from "zustand";
import { MAX_UPLOAD, UPLOADS, mimeOf, uniqueName, uploadFolder, viewable, type Attachment } from "../lib/attachments";
import { bytes } from "../lib/format";
import { useChat } from "./chat";

export interface Pending {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: "uploading" | "ready" | "failed";
  /** Absolute path once uploaded. */
  path?: string;
  /** A local URL to show an image before (and while) it's sent. */
  preview?: string;
  error?: string;
}

interface AttachmentsState {
  byKey: Record<string, Pending[]>;
  add(key: string, files: File[], root: string): void;
  remove(key: string, id: string): void;
  /** Forget a box's files once they're sent (their uploads stay). */
  clear(key: string): void;
  /** Put sent files back in a box (edit and resend, fork), with their images by name. */
  restore(key: string, atts: Attachment[], previews?: Record<string, string>): void;
}

let seq = 0;
/** Upload folders already given their `.gitignore` this run. */
const ignored = new Set<string>();

const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

const patch = (key: string, id: string, p: Partial<Pending>) =>
  useAttachments.setState((s) => ({ byKey: { ...s.byKey, [key]: (s.byKey[key] ?? []).map((a) => (a.id === id ? { ...a, ...p } : a)) } }));

export const useAttachments = create<AttachmentsState>((set, get) => ({
  byKey: {},

  add(key, files, root) {
    const client = useChat.getState().client;
    if (!client || !root || !files.length) return;
    const folder = uploadFolder(root);
    const items = files.map((file) => {
      const mime = mimeOf(file.name, file.type);
      const p: Pending = { id: `att_${++seq}`, name: file.name, mime, size: file.size, status: "uploading", preview: viewable(mime) ? URL.createObjectURL(file) : undefined };
      return { p, file };
    });
    set((s) => ({ byKey: { ...s.byKey, [key]: [...(s.byKey[key] ?? []), ...items.map((i) => i.p)] } }));
    void (async () => {
      const uploads = `${root.replace(/\/$/, "")}/${UPLOADS}`;
      // Uploads stay out of git without touching the project's own .gitignore.
      if (!ignored.has(uploads)) {
        ignored.add(uploads);
        void client.writeFile(`${uploads}/.gitignore`, "*\n", root).catch(() => ignored.delete(uploads));
      }
      const listed = await client.listDir(folder, root).catch(() => []);
      const taken = new Set(listed.map((e) => e.path.replace(/\/$/, "").split("/").pop()!));
      // Names other boxes have claimed in the same folder.
      for (const list of Object.values(get().byKey)) for (const a of list) if (a.path?.startsWith(`${folder}/`)) taken.add(a.path.slice(folder.length + 1));
      for (const { p, file } of items) {
        if (p.size > MAX_UPLOAD) {
          patch(key, p.id, { status: "failed", error: `Over ${bytes(MAX_UPLOAD)}` });
          continue;
        }
        const name = uniqueName(p.name, taken);
        taken.add(name);
        const path = `${folder}/${name}`;
        try {
          await client.writeFile(path, new Uint8Array(await file.arrayBuffer()), root);
          // Removed while it uploaded: take it back off the machine.
          if (!get().byKey[key]?.some((a) => a.id === p.id)) void client.exec(`rm -f -- ${quote(path)}`, { directory: root }).catch(() => {});
          else patch(key, p.id, { status: "ready", path, name });
        } catch (e) {
          patch(key, p.id, { status: "failed", error: (e as Error).message || "Upload failed" });
        }
      }
    })();
  },

  remove(key, id) {
    const a = get().byKey[key]?.find((x) => x.id === id);
    if (!a) return;
    set((s) => ({ byKey: { ...s.byKey, [key]: (s.byKey[key] ?? []).filter((x) => x.id !== id) } }));
    if (a.preview?.startsWith("blob:")) URL.revokeObjectURL(a.preview);
    const client = useChat.getState().client;
    if (a.status === "ready" && a.path && client) void client.exec(`rm -f -- ${quote(a.path)}`).catch(() => {});
  },

  clear(key) {
    // Previews stay alive: the sent message shows them until the server's copy arrives.
    set((s) => {
      const { [key]: _, ...rest } = s.byKey;
      return { byKey: rest };
    });
  },

  restore(key, atts, previews = {}) {
    if (!atts.length) return;
    const items: Pending[] = atts.map((a) => ({ id: `att_${++seq}`, name: a.name, mime: a.mime, size: a.size, status: "ready", path: a.path, preview: previews[a.name] }));
    set((s) => ({ byKey: { ...s.byKey, [key]: items } }));
  },
}));

/** The files in a box that are ready to send. */
export const readyAttachments = (list: Pending[]): Attachment[] => list.filter((a) => a.status === "ready" && a.path).map((a) => ({ path: a.path!, name: a.name, mime: a.mime, size: a.size }));
