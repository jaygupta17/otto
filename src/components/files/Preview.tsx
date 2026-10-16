/**
 * Previews for files that aren't (just) text: images with fit / zoom / pan,
 * PDFs, audio and video, fonts, and a peek into anything else that's binary.
 */
import { Minus, Plus, Scan } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { bytes as fmtBytes } from "../../lib/format";

export type PreviewKind = "image" | "svg" | "pdf" | "audio" | "video" | "font" | "binary" | "text";

const IMAGE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  icns: "image/icns",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
};
const AUDIO: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", opus: "audio/ogg" };
const VIDEO: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" };
const FONT: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
const BINARY = new Set(
  "zip gz tgz bz2 xz zst 7z rar tar jar war apk ipa dmg iso exe dll so dylib o a lib obj class pyc pyo wasm bin dat db sqlite sqlite3 mdb psd ai sketch fig xd blend fbx glb gltf3 doc docx xls xlsx ppt pptx odt ods odp pages numbers key node lockb pdb mo".split(" "),
);

export const extOf = (path: string) => {
  const name = path.split("/").pop() ?? "";
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
};

/** Best guess from the name alone (before any bytes arrive). */
export function kindFromPath(path: string): PreviewKind {
  const e = extOf(path);
  if (e === "svg") return "svg";
  if (IMAGE[e]) return "image";
  if (e === "pdf") return "pdf";
  if (AUDIO[e]) return "audio";
  if (VIDEO[e]) return "video";
  if (FONT[e]) return "font";
  if (BINARY.has(e)) return "binary";
  return "text";
}

export function mimeFor(path: string, kind: PreviewKind, served = ""): string {
  const e = extOf(path);
  if (served && served !== "application/octet-stream" && !served.startsWith("text/")) return served;
  if (kind === "svg") return "image/svg+xml";
  if (kind === "pdf") return "application/pdf";
  return IMAGE[e] ?? AUDIO[e] ?? VIDEO[e] ?? FONT[e] ?? "application/octet-stream";
}

/** Sniff the first 8 KB: NULs, known magic numbers, or lots of control / invalid characters. */
export function looksBinary(b: Uint8Array): boolean {
  const n = Math.min(b.length, 8192);
  if (!n) return false;
  // %PDF, PK\x03\x04 (zip family), \x7fELF, Mach-O, PNG, GIF, JPEG
  const magic = [[0x25, 0x50, 0x44, 0x46], [0x50, 0x4b, 0x03, 0x04], [0x7f, 0x45, 0x4c, 0x46], [0xcf, 0xfa, 0xed, 0xfe], [0x89, 0x50, 0x4e, 0x47], [0x47, 0x49, 0x46, 0x38], [0xff, 0xd8, 0xff]];
  if (magic.some((m) => m.every((x, i) => b[i] === x))) return true;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return true;
    if (c < 7 || (c > 13 && c < 32 && c !== 27)) odd++;
  }
  if (odd / n > 0.1) return true;
  // Invalid UTF-8 → U+FFFD replacements.
  const s = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, n));
  let bad = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) bad++;
  return bad / Math.max(1, s.length) > 0.1;
}

/** Object URL for some bytes, revoked when they change or the view goes away. */
export function useObjectUrl(bytes: Uint8Array | null, mime: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) return setUrl(null);
    const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime]);
  return url;
}

export function MetaBar({ items, right }: { items: ReactNode[]; right?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] text-muted">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
        {items.filter(Boolean).map((x, i) => (
          <span key={i} className="flex items-center gap-1.5 truncate">
            {i > 0 && <span className="text-faint">·</span>}
            {x}
          </span>
        ))}
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

const PAD = 16;
const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MAX = 16;
type Size = { w: number; h: number };

const fitScale = (n: Size, v: Size) => (n.w <= 0 || n.h <= 0 || v.w <= PAD * 2 ? 1 : Math.min(1, (v.w - PAD * 2) / n.w, (v.h - PAD * 2) / n.h));
const clamp = (s: number, fit: number) => Math.min(MAX, Math.max(Math.min(0.1, fit), s));
const step = (s: number, dir: 1 | -1) => (dir === 1 ? STEPS.find((x) => x > s * 1.001) ?? MAX : [...STEPS].reverse().find((x) => x < s * 0.999) ?? 0.1);

/**
 * Whole image first (fit never upscales: a 16px icon stays 16px), then closer.
 * ⌘/Ctrl + wheel or a trackpad pinch zooms around the pointer, two-finger
 * pinch on touch, − / + / 0 keys and buttons, double-click toggles fit ↔ 1:1,
 * drag pans when zoomed past the viewer.
 */
export function ImageView({ src, name, size }: { src: string; name: string; size: number }) {
  const [scale, setScale] = useState<number | null>(null); // null = fit
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const anchor = useRef<{ ix: number; iy: number; cx: number; cy: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; l: number; t: number } | null>(null);

  useEffect(() => {
    setScale(null);
    setNatural(null);
    setFailed(false);
  }, [src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = natural && view ? fitScale(natural, view) : 1;
  const shown = scale ?? fit;
  const canPan = scale !== null && !!natural && !!view && (natural.w * scale + PAD * 2 > view.w || natural.h * scale + PAD * 2 > view.h);

  // Keep the image point under (cx, cy) where it is across the zoom.
  const zoomTo = (next: number, cx: number, cy: number) => {
    const el = img.current;
    if (!el || !natural) return;
    const r = el.getBoundingClientRect();
    const k = el.clientWidth / natural.w;
    if (k <= 0) return;
    anchor.current = { ix: (cx - r.left) / k, iy: (cy - r.top) / k, cx, cy };
    flushSync(() => setScale(clamp(next, fit)));
  };
  const zoomCenter = (next: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) zoomTo(next, r.left + r.width / 2, r.top + r.height / 2);
  };

  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const el = box.current;
    const im = img.current;
    if (!a || !el || !im || !im.naturalWidth) return;
    const r = im.getBoundingClientRect();
    const k = im.clientWidth / im.naturalWidth;
    el.scrollLeft += r.left + a.ix * k - a.cx;
    el.scrollTop += r.top + a.iy * k - a.cy;
  }, [scale]);

  // Native, non-passive listeners so a pinch zooms the image, not the app.
  const live = useRef({ zoomTo, shown });
  live.current = { zoomTo, shown };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let pinch: { d: number; s: number } | null = null;
    let gesture: number | null = null;
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      live.current.zoomTo(live.current.shown * Math.exp(-Math.max(-30, Math.min(30, px)) / 100), e.clientX, e.clientY);
    };
    const onTouchStart = (e: TouchEvent) => {
      pinch = e.touches.length === 2 ? { d: dist(e.touches[0], e.touches[1]), s: live.current.shown } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2 || pinch.d <= 0) return;
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      live.current.zoomTo(pinch.s * (dist(a, b) / pinch.d), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    // WebKit (the macOS webview) sends trackpad pinches as gesture events.
    type GE = Event & { scale: number; clientX: number; clientY: number };
    const onGStart = (e: Event) => {
      e.preventDefault();
      gesture = pinch ? null : live.current.shown;
    };
    const onGChange = (e: Event) => {
      e.preventDefault();
      const g = e as GE;
      if (gesture !== null) live.current.zoomTo(gesture * g.scale, g.clientX, g.clientY);
    };
    const onGEnd = (e: Event) => {
      e.preventDefault();
      gesture = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("gesturestart", onGStart);
    el.addEventListener("gesturechange", onGChange);
    el.addEventListener("gestureend", onGEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", onGStart);
      el.removeEventListener("gesturechange", onGChange);
      el.removeEventListener("gestureend", onGEnd);
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") (e.preventDefault(), zoomCenter(step(shown, 1)));
    else if (e.key === "-" || e.key === "_") (e.preventDefault(), zoomCenter(step(shown, -1)));
    else if (e.key === "0") (e.preventDefault(), setScale(null));
    else if (e.key === "1") (e.preventDefault(), zoomCenter(1));
  };

  const w = natural ? Math.max(1, Math.round(natural.w * shown)) : undefined;
  const h = natural ? Math.max(1, Math.round(natural.h * shown)) : undefined;
  const btn = "grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-40";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaBar
        items={[natural && `${natural.w} × ${natural.h}`, fmtBytes(size), <span className="tabular-nums">{Math.round(shown * 100)}%</span>]}
        right={
          <div className="flex items-center gap-0.5">
            <button className={btn} aria-label="Zoom out" title="Zoom out (−)" disabled={!natural} onClick={() => zoomCenter(step(shown, -1))}>
              <Minus size={13} />
            </button>
            <button className={btn} aria-label="Zoom in" title="Zoom in (+)" disabled={!natural} onClick={() => zoomCenter(step(shown, 1))}>
              <Plus size={13} />
            </button>
            <button className={`${btn} ${scale === null ? "text-ink" : ""}`} aria-label="Fit" title="Fit (0)" disabled={!natural} onClick={() => setScale(null)}>
              <Scan size={13} />
            </button>
          </div>
        }
      />
      <div
        ref={box}
        tabIndex={0}
        role="img"
        aria-label={`${name}${natural ? `, ${natural.w} by ${natural.h} pixels` : ""}. Plus and minus zoom, 0 fits.`}
        onKeyDown={onKey}
        onDoubleClick={(e) => (scale === null && fit < 1 ? zoomTo(1, e.clientX, e.clientY) : scale === null ? zoomTo(2, e.clientX, e.clientY) : setScale(null))}
        onPointerDown={(e) => {
          if (!canPan || e.pointerType !== "mouse" || e.button !== 0) return;
          const el = e.currentTarget;
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          e.currentTarget.scrollLeft = d.l - (e.clientX - d.x);
          e.currentTarget.scrollTop = d.t - (e.clientY - d.y);
        }}
        onPointerUp={() => ((drag.current = null), setDragging(false))}
        onPointerCancel={() => ((drag.current = null), setDragging(false))}
        className={`checker scroll-quiet relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-[var(--active)] focus-visible:ring-inset ${canPan ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"}`}
      >
        {failed ? (
          <div className="grid h-full place-items-center p-6 text-center text-[13px] text-muted">This image format can't be shown here.</div>
        ) : (
          <div className="grid min-h-full min-w-full place-items-center" style={{ padding: PAD, width: w ? w + PAD * 2 : undefined, height: h ? h + PAD * 2 : undefined }}>
            <img
              ref={img}
              src={src}
              alt={name}
              draggable={false}
              decoding="async"
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
              onError={() => setFailed(true)}
              className="max-w-none select-none"
              style={{ width: w, height: h, imageRendering: shown >= 4 ? "pixelated" : undefined, visibility: natural ? "visible" : "hidden" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media, PDF, font, binary
// ---------------------------------------------------------------------------

export function MediaView({ src, kind, name, size }: { src: string; kind: "audio" | "video"; name: string; size: number }) {
  const [err, setErr] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaBar items={[kind === "audio" ? "Audio" : "Video", fmtBytes(size)]} />
      <div className="grid min-h-0 flex-1 place-items-center p-4">
        {err ? (
          <div className="text-[13px] text-muted">This {kind} format can't be played here.</div>
        ) : kind === "audio" ? (
          <audio src={src} controls aria-label={name} onError={() => setErr(true)} className="w-full max-w-[480px]" />
        ) : (
          <video src={src} controls aria-label={name} onError={() => setErr(true)} className="max-h-full max-w-full rounded-lg" />
        )}
      </div>
    </div>
  );
}

export function PdfView({ src, name, size }: { src: string; name: string; size: number }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaBar items={["PDF", fmtBytes(size)]} />
      <iframe src={src} title={name} className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}

let fontN = 0;
export function FontView({ bytes, name, size }: { bytes: Uint8Array; name: string; size: number }) {
  const [family] = useState(() => `otto-font-preview-${++fontN}`);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let off = false;
    setStatus("loading");
    const face = new FontFace(family, bytes.slice().buffer);
    face
      .load()
      .then(() => {
        if (off) return;
        document.fonts.add(face);
        setStatus("ready");
      })
      .catch(() => !off && setStatus("failed"));
    return () => {
      off = true;
      document.fonts.delete(face);
    };
  }, [bytes, family]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaBar items={["Font", fmtBytes(size)]} />
      {status === "failed" ? (
        <div className="grid flex-1 place-items-center text-[13px] text-muted">Couldn't load this font.</div>
      ) : (
        <div className="selectable scroll-quiet min-h-0 flex-1 space-y-4 overflow-auto p-5 text-ink" style={{ fontFamily: `"${family}", var(--font-sans)`, opacity: status === "ready" ? 1 : 0.4 }} aria-label={`${name} specimen`}>
          {[48, 32, 22, 16, 13].map((s) => (
            <div key={s} className="flex items-baseline gap-3">
              <span className="w-7 shrink-0 text-right font-sans text-[11px] text-faint">{s}</span>
              <span className="min-w-0 leading-tight break-words" style={{ fontSize: s }}>
                The quick brown fox jumps over the lazy dog
              </span>
            </div>
          ))}
          <div className="space-y-1 border-t border-line pt-4 text-[20px] break-all">
            <div>ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>
            <div>abcdefghijklmnopqrstuvwxyz</div>
            <div>0123456789 .,;:!?&@#%()[]{"{}"}&lt;&gt;+-=/*</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Not something we can draw: what it is, how big, and its first bytes. */
export function BinaryView({ bytes, path, size, mime, tooLarge }: { bytes: Uint8Array | null; path: string; size: number; mime: string; tooLarge?: boolean }) {
  const e = extOf(path);
  const head = bytes ? hexDump(bytes.subarray(0, 512)) : "";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaBar items={[e ? `.${e}` : "Binary", fmtBytes(size), mime && mime !== "application/octet-stream" ? mime : null]} />
      <div className="scroll-quiet min-h-0 flex-1 overflow-auto p-5">
        <div className="text-[14px] font-medium text-ink">{tooLarge ? "Too large to preview" : "Binary file"}</div>
        <div className="mt-1 text-[13px] text-muted">{tooLarge ? `It's ${fmtBytes(size)}; Otto previews files up to ${fmtBytes(PREVIEW_MAX)}.` : "It isn't text, so there's nothing to edit here."}</div>
        {head && (
          <>
            <div className="mt-5 mb-1.5 text-[12px] font-medium text-muted">First {Math.min(512, bytes!.length)} bytes</div>
            <pre className="selectable rounded-lg bg-sunken px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-ink-2">{head}</pre>
          </>
        )}
      </div>
    </div>
  );
}

/** Biggest file we pull into memory for a preview. */
export const PREVIEW_MAX = 50 * 1024 * 1024;

function hexDump(b: Uint8Array): string {
  const rows: string[] = [];
  for (let i = 0; i < b.length; i += 16) {
    const chunk = b.subarray(i, i + 16);
    const hex = [...chunk].map((x) => x.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : "·")).join("");
    rows.push(`${i.toString(16).padStart(6, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return rows.join("\n");
}
