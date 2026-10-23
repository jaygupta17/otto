import type { ReactNode } from "react";
import { DitherGround } from "./Dither";

/**
 * A screen or list with nothing in it yet. Flat on the page, no box: a mark
 * (a bird, or an icon) standing on a patch of dotted ground, a headline in
 * Geist Pixel, a line saying what fills it, and at most one action.
 */
export function EmptyState({ mark, title, body, action, small = false, className = "" }: { mark?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; small?: boolean; className?: string }) {
  return (
    <div className={`flex flex-col items-center text-center ${small ? "px-4 py-6" : "px-6 py-12"} ${className}`}>
      {mark && (
        <div className="flex flex-col items-center text-muted">
          {mark}
          <DitherGround width={small ? 56 : 88} className="mt-1.5 text-faint" />
        </div>
      )}
      <h2 className={`font-pixel leading-tight text-ink ${mark ? (small ? "mt-3" : "mt-5") : ""} ${small ? "text-[16px]" : "text-[20px]"}`}>{title}</h2>
      {body && <p className={`mt-1.5 max-w-[360px] leading-snug text-muted ${small ? "text-[13px]" : "text-[14px]"}`}>{body}</p>}
      {action && <div className={small ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}
