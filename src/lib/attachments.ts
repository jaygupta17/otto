/**
 * Files the user attaches to a message. Every file is uploaded into the
 * session's folder (`.otto/uploads/<day>/`) and listed in a note at the end of
 * the message, so the agent knows where it is. Images also ride along as
 * attachments the model sees, when it takes images; anything else it opens
 * with its own tools. The note is for the agent; the thread shows the files instead.
 */
import { bytes } from "./format";

export interface Attachment {
  /** Absolute, on the machine the session runs on. */
  path: string;
  name: string;
  mime: string;
  size: number;
}

export const UPLOADS = ".otto/uploads";
/** Per file: bigger uploads are refused before they start. */
export const MAX_UPLOAD = 25 * 1024 * 1024;

/** What models take as image input; other image formats (HEIC, SVG) go by path. */
const VIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const viewable = (mime: string) => VIEWABLE.has(mime);

const EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
};
const extOf = (name: string) => (/\.([^./]+)$/.exec(name)?.[1] ?? "").toLowerCase();

/** The browser's type, or one from the extension when it gave none. */
export function mimeOf(name: string, type?: string): string {
  return type || EXT[extOf(name)] || "application/octet-stream";
}

/** "Image", "PDF", "CSV": what the file is, in a word. */
export function kindOf(mime: string, name: string): string {
  if (mime.startsWith("image/")) return "Image";
  if (mime === "application/pdf") return "PDF";
  const ext = extOf(name);
  if (ext) return ext.length <= 4 ? ext.toUpperCase() : ext;
  return mime.startsWith("text/") ? "Text" : "File";
}

/** Today's upload folder under `root`, by local date. */
export function uploadFolder(root: string, now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${root.replace(/\/$/, "")}/${UPLOADS}/${d}`;
}

/** `name`, or `name (2).ext` and so on when it's taken. */
export function uniqueName(name: string, taken: Set<string>): string {
  const clean = name.replace(/[/\\\0]/g, "_").trim() || "file";
  if (!taken.has(clean)) return clean;
  const dot = clean.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
  for (let i = 2; ; i++) if (!taken.has(`${stem} (${i})${ext}`)) return `${stem} (${i})${ext}`;
}

const rel = (root: string, p: string) => {
  const r = root.replace(/\/$/, "");
  return r && p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
};

/** The note the agent gets: one line per file, where it is and what to do with it. */
export function attachmentNote(atts: Attachment[], root: string, vision: boolean): string {
  const lines = atts.map((a) => {
    const how = viewable(a.mime) ? (vision ? "also attached to this message" : "you can't view images, so open it with a tool if you need it") : "open it with your tools";
    return `- ${rel(root, a.path)} (${kindOf(a.mime, a.name)}, ${bytes(a.size)}; ${how})`;
  });
  return [`[The user attached ${atts.length === 1 ? "a file" : `${atts.length} files`}, saved in the project]`, ...lines].join("\n");
}

/** What goes to the server for a message with attachments. */
export function composeMessage(text: string, atts: Attachment[], root: string, vision: boolean) {
  if (!atts.length) return { text, files: undefined, metadata: undefined };
  const note = attachmentNote(atts, root, vision);
  return {
    text: text.trim() ? `${text}\n\n${note}` : note,
    files: vision ? atts.filter((a) => viewable(a.mime)).map((a) => ({ uri: `file://${a.path}`, name: a.name })) : undefined,
    metadata: { otto: { attachments: atts, note } },
  };
}

/** A stored message split back into what the user typed and the note it carried. */
export function splitNote(text: string, metadata: unknown): { text: string; note?: string; attachments?: Attachment[] } {
  const otto = (metadata as { otto?: { attachments?: Attachment[]; note?: string } } | undefined)?.otto;
  const note = otto?.note;
  if (!note || !Array.isArray(otto.attachments)) return { text };
  if (text === note) return { text: "", note, attachments: otto.attachments };
  if (text.endsWith(`\n\n${note}`)) return { text: text.slice(0, -note.length - 2), note, attachments: otto.attachments };
  return { text, attachments: otto.attachments };
}
