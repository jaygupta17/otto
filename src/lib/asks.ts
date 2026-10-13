/** Plain words for what an approval request is asking, shared by the card and the alerts. */
import type { PermissionRequestLite } from "./opencode/client";

// Settings use their own labels for rules (lib/permissions); these read as a request.

export interface PermissionSummary {
  /** "Run a command", "Edit files"… */
  verb: string;
  /** The full shell command, when it's one. */
  command?: string;
  /** Paths, URLs or patterns the request covers. */
  targets: string[];
}

const VERBS: Record<string, string> = {
  bash: "Run a command",
  shell: "Run a command",
  edit: "Edit files",
  write: "Write files",
  patch: "Edit files",
  read: "Read files",
  list: "List files",
  glob: "Search files",
  grep: "Search files",
  webfetch: "Fetch a web page",
  websearch: "Search the web",
  external_directory: "Work outside the project",
  subagent: "Hand off to a subagent",
  task: "Hand off to a subagent",
  skill: "Use a skill",
  todowrite: "Update its to-do list",
  question: "Ask you a question",
};

export function describePermission(req: PermissionRequestLite): PermissionSummary {
  const meta = req.metadata ?? {};
  const command = typeof meta.command === "string" && meta.command.trim() ? meta.command.trim() : undefined;
  const dirs = Array.isArray(meta.directories) ? meta.directories.filter((d): d is string => typeof d === "string") : [];
  const targets = req.action === "external_directory" && dirs.length ? dirs : command ? [] : req.resources;
  return { verb: VERBS[req.action] ?? `Use ${req.action.replace(/_/g, " ")}`, command, targets };
}

/** One line for a notification: the command's first line, or the first target. */
export function permissionLine(req: PermissionRequestLite): string {
  const { verb, command, targets } = describePermission(req);
  const first = command?.split("\n")[0] ?? targets[0];
  if (!first) return verb;
  const clipped = first.length > 90 ? `${first.slice(0, 88)}…` : first;
  return command ? `${verb}: ${clipped}${command.includes("\n") ? " …" : ""}` : `${verb}: ${clipped}${targets.length > 1 ? ` +${targets.length - 1}` : ""}`;
}
