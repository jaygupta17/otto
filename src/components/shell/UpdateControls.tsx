import { ArrowDownToLine, RotateCw, X } from "lucide-react";
import { installsInPlace, RELEASES_URL, updatesSupported, useUpdates } from "../../state/updates";
import { openExternal } from "../../lib/platform";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { Row, Rows, Section, Toggle } from "../settings/common";

/** Sidebar pill: shows up only when there's something to do. */
export function UpdatePill({ className = "mx-2 mb-1" }: { className?: string }) {
  const { status, version, progress, dismissed, install, restart, dismiss } = useUpdates();
  if (!updatesSupported()) return null;
  const inPlace = installsInPlace();
  if (status === "available" && dismissed === version) return null;
  if (status !== "available" && status !== "downloading" && status !== "ready") return null;

  const label =
    status === "ready" ? "Restart to update" : status === "downloading" ? (progress !== undefined ? `Updating… ${Math.round(progress * 100)}%` : "Updating…") : inPlace
          ? `Update to ${version}`
          : `Otto ${version} is out`;
  return (
    <div className={`flex items-center gap-1 rounded-lg bg-accent-soft pr-1 text-[12px] text-ink ${className}`}>
      <button
        disabled={status === "downloading"}
        onClick={() => void (status === "ready" ? restart() : install())}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left font-medium transition-colors hover:bg-hover disabled:hover:bg-transparent"
        title={status === "available" ? (inPlace ? "Download and install. You'll restart when it's ready." : "Download the new version. Android installs it over this one.") : undefined}
      >
        {status === "downloading" ? <Spinner size={13} /> : status === "ready" ? <RotateCw size={14} /> : <ArrowDownToLine size={14} />}
        <span className="truncate tabular-nums">{label}</span>
      </button>
      {status === "available" && (
        <button onClick={dismiss} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink" aria-label="Not now">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** Settings → General → Updates. */
export function UpdatesSection() {
  const u = useUpdates();
  if (!updatesSupported()) return null;
  const inPlace = installsInPlace();

  const hint =
    u.status === "checking"
      ? "Checking…"
      : u.status === "current"
        ? "You're up to date."
        : u.status === "available"
          ? inPlace
            ? `Version ${u.version} is available.`
            : `Version ${u.version} is out. Download it and Android installs it over this one.`
          : u.status === "downloading"
            ? `Downloading ${u.version}${u.progress !== undefined ? ` · ${Math.round(u.progress * 100)}%` : ""}`
            : u.status === "ready"
              ? `${u.version} is installed. Restart Otto to use it.`
              : u.status === "error"
                ? u.installFailed
                  ? `Couldn't install: ${u.error}. Download it from GitHub instead.`
                  : u.error
                : undefined;

  const action =
    u.status === "available" ? (
      <Button size="sm" variant="primary" onClick={() => void u.install()}>
        {inPlace ? "Update" : "Download"}
      </Button>
    ) : u.status === "ready" ? (
      <Button size="sm" variant="primary" onClick={() => void u.restart()}>
        Restart
      </Button>
    ) : u.status === "downloading" || u.status === "checking" ? (
      <Spinner size={15} />
    ) : u.status === "error" && u.installFailed ? (
      <Button size="sm" onClick={() => void openExternal(RELEASES_URL)}>
        Download
      </Button>
    ) : (
      <Button size="sm" onClick={() => void u.check()}>
        Check now
      </Button>
    );

  return (
    <Section title="Updates">
      <Rows>
        <Row label={`Otto ${__APP_VERSION__}`} hint={hint}>
          {action}
        </Row>
        {u.status === "available" && u.notes && (
          <div className="max-h-48 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed whitespace-pre-wrap text-muted">{u.notes}</div>
        )}
        <Row label="Check automatically" hint="Otto asks before downloading anything">
          <Toggle on={u.auto} onChange={u.setAuto} label="Check for updates automatically" />
        </Row>
      </Rows>
    </Section>
  );
}
