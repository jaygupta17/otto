import { File, FileArchive, FileImage, FileSpreadsheet, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { kindOf, viewable, type Attachment } from "../../lib/attachments";
import { bytes } from "../../lib/format";
import type { UserFile } from "../../lib/opencode/projection";
import { useAttachments, type Pending } from "../../state/attachments";
import { useChat } from "../../state/chat";
import { Spinner } from "../ui/AgentClock";
import { ImageViewer } from "./ImageViewer";
import { useOpenFile, useSessionRoot } from "./ToolParts";

export function FileIcon({ mime, name, size = 16 }: { mime: string; name: string; size?: number }) {
  if (mime.startsWith("image/")) return <FileImage size={size} />;
  if (/zip|tar|gzip|compressed/.test(mime)) return <FileArchive size={size} />;
  if (/csv|spreadsheet|excel/.test(mime) || /\.(csv|xlsx?|tsv)$/i.test(name)) return <FileSpreadsheet size={size} />;
  if (mime.startsWith("text/") || mime === "application/pdf" || mime === "application/json") return <FileText size={size} />;
  return <File size={size} />;
}

/** Files waiting in the reply box: a thumbnail or a chip each, with its upload state and a ×. */
export function AttachmentTray({ boxKey }: { boxKey: string }) {
  const list = useAttachments((s) => s.byKey[boxKey]);
  const remove = useAttachments((s) => s.remove);
  if (!list?.length) return null;
  return (
    // Room at the top for each ×, which sits over its item's corner.
    <div className="scroll-quiet flex gap-2 overflow-x-auto px-3 pt-3 pb-0.5">
      {list.map((a) => (
        <TrayItem key={a.id} a={a} onRemove={() => remove(boxKey, a.id)} />
      ))}
    </div>
  );
}

function TrayItem({ a, onRemove }: { a: Pending; onRemove: () => void }) {
  const failed = a.status === "failed";
  const meta = a.status === "uploading" ? "Uploading…" : failed ? (a.error ?? "Upload failed") : `${kindOf(a.mime, a.name)} · ${bytes(a.size)}`;
  const x = (
    <button
      onClick={onRemove}
      aria-label={`Remove ${a.name}`}
      title="Remove"
      className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-raised opacity-0 transition-opacity group-hover/att:opacity-100 focus-visible:opacity-100 max-[760px]:opacity-100"
    >
      <X size={11} strokeWidth={2.5} />
    </button>
  );
  if (a.preview)
    return (
      <div className="group/att relative shrink-0" title={`${a.name}\n${meta}`}>
        <img src={a.preview} alt={a.name} className={`h-14 w-14 rounded-lg object-cover hairline ${a.status === "uploading" ? "opacity-50" : ""} ${failed ? "opacity-40" : ""}`} />
        {a.status === "uploading" && (
          <span className="absolute inset-0 grid place-items-center text-ink">
            <Spinner size={16} />
          </span>
        )}
        {failed && <span className="absolute inset-x-0 bottom-0 truncate px-1 pb-0.5 text-center text-[10px] text-danger">Failed</span>}
        {x}
      </div>
    );
  return (
    <div className="group/att relative flex h-14 max-w-[220px] shrink-0 items-center gap-2 rounded-lg pr-7 pl-2.5 hairline" title={`${a.name}\n${meta}`}>
      <span className={`grid h-8 w-6 shrink-0 place-items-center ${failed ? "text-danger" : "text-muted"}`}>{a.status === "uploading" ? <Spinner size={15} /> : <FileIcon mime={a.mime} name={a.name} />}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-ink">{a.name}</span>
        <span className={`block truncate text-[11.5px] ${failed ? "text-danger" : "text-muted"}`}>{meta}</span>
      </span>
      {x}
    </div>
  );
}

/** A sent message's files, above its bubble: images as thumbnails, the rest as chips that open the file. */
export function MessageAttachments({ attachments, files, pending }: { attachments?: Attachment[]; files?: UserFile[]; pending?: boolean }) {
  const openFile = useOpenFile();
  const [open, setOpen] = useState<number | null>(null);
  // Images read back from the machine, by position, so the viewer can page through them all.
  const [loaded, setLoaded] = useState<Record<number, string>>({});
  // A message from elsewhere may carry images without our list of uploads.
  const list: Attachment[] = attachments ?? (files ?? []).filter((f) => /^(data|blob):/.test(f.uri)).map((f) => ({ path: "", name: f.name ?? "Image", mime: f.mime ?? "image/png", size: 0 }));
  if (!list.length) return null;
  const srcOf = (a: Attachment) => files?.find((f) => f.name === a.name && /^(data|blob):/.test(f.uri))?.uri;
  const gallery = list.flatMap((a, i) => {
    const src = srcOf(a) ?? loaded[i];
    return src ? [{ i, src, name: a.name }] : [];
  });
  return (
    <div className={`mb-1.5 flex max-w-[min(560px,80%)] flex-wrap justify-end gap-2 ${pending ? "opacity-60" : ""}`}>
      {list.map((a, i) =>
        viewable(a.mime) || srcOf(a) ? (
          <Thumb
            key={`${a.path}:${i}`}
            a={a}
            src={srcOf(a)}
            onLoad={(url) =>
              setLoaded((l) => {
                const next = { ...l };
                if (url) next[i] = url;
                else delete next[i];
                return next;
              })
            }
            onOpen={() => setOpen(gallery.findIndex((g) => g.i === i))}
          />
        ) : (
          <button
            key={`${a.path}:${i}`}
            onClick={() => a.path && openFile(a.path)}
            disabled={!a.path}
            title={a.path || a.name}
            className="flex h-12 max-w-[240px] items-center gap-2.5 rounded-lg pr-3 pl-2.5 text-left hairline transition-colors enabled:hover:bg-hover"
          >
            <span className="shrink-0 text-muted">
              <FileIcon mime={a.mime} name={a.name} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-ink">{a.name}</span>
              <span className="block truncate text-[11.5px] text-muted">{[kindOf(a.mime, a.name), a.size ? bytes(a.size) : ""].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
        ),
      )}
      <ImageViewer images={gallery} index={open !== null && open >= 0 ? open : null} onClose={() => setOpen(null)} />
    </div>
  );
}

/** An image from the message itself, or read back from the machine when the model wasn't sent it. */
function Thumb({ a, src, onLoad, onOpen }: { a: Attachment; src?: string; onLoad: (url: string | null) => void; onOpen: () => void }) {
  const root = useSessionRoot();
  const client = useChat((s) => s.client);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (src || !a.path || !client) return;
    let url: string | null = null;
    let live = true;
    client
      .readFileBytes(a.path, root || undefined, { maxBytes: 8 * 1024 * 1024 })
      .then((r) => {
        if (!live) return;
        if (!r.bytes) return setGone(true);
        url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: a.mime }));
        setLoaded(url);
        onLoad(url);
      })
      .catch(() => live && setGone(true));
    return () => {
      live = false;
      if (url) {
        URL.revokeObjectURL(url);
        onLoad(null);
      }
    };
  }, [src, a.path, a.mime, client, root]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = src ?? loaded;
  if (!shown)
    return (
      <div title={gone ? `${a.name} is no longer on the machine` : a.name} className="grid h-24 w-24 place-items-center rounded-lg text-faint hairline">
        {gone ? <FileImage size={18} /> : <Spinner size={14} />}
      </div>
    );
  return (
    <button onClick={onOpen} title={a.name} aria-label={`View ${a.name}`} className="block overflow-hidden rounded-lg hairline transition-opacity hover:opacity-90">
      <img src={shown} alt={a.name} loading="lazy" decoding="async" className="block max-h-[160px] max-w-[240px] object-contain" />
    </button>
  );
}
