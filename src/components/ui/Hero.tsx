/**
 * A page's top, after DitherUI's heroes: a big title and a line of what's
 * going on in pixel type. Once the big title has scrolled away, the bar
 * frosts over and shows it small.
 */
import { useCallback, useState, type ReactNode, type UIEvent } from "react";
import { DitherField } from "./Dither";

/** Scroll state for a page with a big title: `past` once the title has gone under the bar. */
export function useBigTitle() {
  const [past, setPast] = useState(false);
  const onScroll = useCallback((e: UIEvent<HTMLElement>) => setPast(e.currentTarget.scrollTop > 44), []);
  return { onScroll, past };
}

/**
 * The field itself, for a page without a big title (a new session, Home):
 * put it first inside a positioned page. It starts under the bar (`top`,
 * past the safe area), so a bar's buttons never sit on dots, and it stays
 * faint: atmosphere, not a picture.
 */
export function Sky({ side = "both", height = 220, top = 52, className = "" }: { side?: "both" | "right"; height?: number; top?: number; className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 overflow-hidden text-accent opacity-45 ${className}`} style={{ top: `calc(var(--safe-t) + ${top}px)`, height }}>
      <DitherField side={side} />
    </div>
  );
}

/** Space above a tab's title row and its bar, so neither touches the top edge. */
const BAR_PAD = "pt-4";

/**
 * The big title and, only when it says something you can act on, a pixel
 * status line. The title row is the bar's row, so a tab's actions sit level
 * with it. Content starts 24px under the header, the same on every tab.
 */
export function PageTitle({ title, status, after, className = "" }: { title: ReactNode; status?: ReactNode; after?: ReactNode; className?: string }) {
  return (
    <div className={`px-4 pb-6 ${BAR_PAD} ${className}`}>
      <div className="flex min-h-[52px] items-center gap-2 pr-12">
        <h1 className="min-w-0 truncate text-[32px] leading-[1.1] font-semibold tracking-[-0.025em] text-ink">{title}</h1>
        {after}
      </div>
      {status && <p className="font-pixel text-[13px] tracking-wide text-muted uppercase">{status}</p>}
    </div>
  );
}

/** The bar's small title, there only once the big one has gone. */
export function BarTitle({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <span aria-hidden={!show} className={`pointer-events-none absolute inset-x-16 truncate text-center text-[17px] font-semibold transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`}>
      {children}
    </span>
  );
}

/**
 * A tab's bar, laid over the top of its page. At rest it's clear and holds
 * only the actions, level with the big title (no empty strip above it); once
 * the title has scrolled away it frosts over and shows the title small.
 */
export function TopBar({ title, show, children }: { title: ReactNode; show: boolean; children?: ReactNode }) {
  return (
    <header className={`topbar safe-top absolute inset-x-0 top-0 z-10 px-2 ${show ? "topbar-on" : "pointer-events-none"}`}>
      <div className={`relative flex h-[52px] items-center justify-end box-content pb-2 ${BAR_PAD} [&_button]:pointer-events-auto`}>
        <BarTitle show={show}>{title}</BarTitle>
        {children}
      </div>
    </header>
  );
}

/** A phone tab's page: the bar over a scroll that starts with the hero. */
export function RootPage({ title, status, after, actions, children, bodyClassName = "" }: { title: string; status?: ReactNode; after?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClassName?: string }) {
  const { onScroll, past } = useBigTitle();
  return (
    <>
      <TopBar title={title} show={past}>{actions}</TopBar>
      <div data-scroll-root onScroll={onScroll} className="scroll-quiet safe-top relative min-h-0 flex-1 overflow-y-auto pb-8">
        <PageTitle title={title} status={status} after={after} />
        <div className={bodyClassName}>{children}</div>
      </div>
    </>
  );
}
