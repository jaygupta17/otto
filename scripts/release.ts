#!/usr/bin/env bun
/**
 * Cut a release: bump the version everywhere, roll the changelog, commit, tag.
 *
 *   bun run release                 next version from the changes (features → minor, fixes → patch)
 *   bun run release minor           patch | minor | major | 1.2.3 | 1.2.3-beta.1
 *   bun run release minor --dry-run show what would change, touch nothing
 *   bun run release minor --push    also push the commit and tag (starts the Release workflow)
 *
 *   bun run release notes v0.2.0    print that version's changelog section (used by CI)
 *   bun run release check [v0.2.0]  fail unless every manifest agrees (and matches the tag)
 *   bun run release manifest v0.2.0 <dir>  print the updater's latest.json from the release's .sig files in <dir> (used by CI)
 *
 * The changelog section comes from `## [Unreleased]` in CHANGELOG.md when you've
 * written one; otherwise it's built from Conventional Commits since the last tag.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REPO = "https://github.com/jaygupta17/otto";
const CHANGELOG = "CHANGELOG.md";

/** Every file that carries the app version, with how to read and write it. */
const MANIFESTS: { file: string; re: RegExp; put: (v: string) => string }[] = [
  { file: "package.json", re: /^(  "version": ")([^"]+)(")/m, put: (v) => `$1${v}$3` },
  { file: "src-tauri/tauri.conf.json", re: /^(  "version": ")([^"]+)(")/m, put: (v) => `$1${v}$3` },
  { file: "src-tauri/Cargo.toml", re: /^(\[package\]\nname = "otto"\nversion = ")([^"]+)(")/m, put: (v) => `$1${v}$3` },
  { file: "src-tauri/Cargo.lock", re: /^(name = "otto"\nversion = ")([^"]+)(")/m, put: (v) => `$1${v}$3` },
];

// Conventional Commit type → Keep a Changelog section. Others are left out.
const SECTIONS: Record<string, string> = { feat: "Added", fix: "Fixed", perf: "Changed", refactor: "Changed", revert: "Removed", security: "Security" };
const ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const write = (f: string, s: string) => writeFileSync(join(ROOT, f), s);

function git(...args: string[]) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}
function gitOk(...args: string[]) {
  return spawnSync("git", args, { cwd: ROOT, stdio: "ignore" }).status === 0;
}
function die(msg: string): never {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
}
const ok = (msg: string) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);

// ── versions ────────────────────────────────────────────────────────────────

function versions() {
  return MANIFESTS.map((m) => {
    const hit = read(m.file).match(m.re);
    if (!hit) die(`Couldn't find the version in ${m.file}`);
    return { file: m.file, version: hit[2] };
  });
}

function currentVersion() {
  const vs = versions();
  const set = new Set(vs.map((v) => v.version));
  if (set.size > 1) die(`Versions disagree:\n${vs.map((v) => `  ${v.file}: ${v.version}`).join("\n")}`);
  return vs[0].version;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function bump(cur: string, kind: string) {
  if (SEMVER.test(kind)) return kind;
  const m = cur.match(SEMVER);
  if (!m) die(`Current version ${cur} isn't semver`);
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // A prerelease bumps to its own release first: 1.0.0-beta.2 + patch = 1.0.0.
  if (m[4] && kind === "patch") return `${maj}.${min}.${pat}`;
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  die(`Unknown bump "${kind}". Use patch, minor, major, or a version like 1.2.3.`);
}

// ── commits ─────────────────────────────────────────────────────────────────

interface Commit {
  hash: string;
  type: string;
  scope?: string;
  subject: string;
  breaking: boolean;
}

function lastTag() {
  return gitOk("describe", "--tags", "--abbrev=0", "--match", "v*") ? git("describe", "--tags", "--abbrev=0", "--match", "v*") : null;
}

function commitsSince(tag: string | null): Commit[] {
  const raw = git("log", "--no-merges", "--format=%h%x1f%s%x1f%b%x1e", tag ? `${tag}..HEAD` : "HEAD");
  return raw
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .flatMap((r) => {
      const [hash, subject, body = ""] = r.split("\x1f");
      const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
      if (!m) return [];
      return [{ hash, type: m[1].toLowerCase(), scope: m[2], subject: m[4], breaking: !!m[3] || /^BREAKING[ -]CHANGE:/m.test(body) }];
    });
}

/** Breaking → major (minor before 1.0), features → minor, else patch. */
function inferBump(cur: string, commits: Commit[], curated: string) {
  if (commits.some((c) => c.breaking) || /\*\*Breaking/.test(curated)) return cur.startsWith("0.") ? "minor" : "major";
  if (commits.some((c) => c.type === "feat") || /^### Added/m.test(curated)) return "minor";
  return "patch";
}

function sectionFromCommits(commits: Commit[]) {
  const groups = new Map<string, string[]>();
  for (const c of commits) {
    if (c.scope === "release") continue;
    const name = c.breaking ? "Changed" : SECTIONS[c.type];
    if (!name) continue;
    const scope = c.scope ? `**${c.scope}:** ` : "";
    const line = `- ${c.breaking ? "**Breaking:** " : ""}${scope}${c.subject[0].toUpperCase()}${c.subject.slice(1)} (${c.hash})`;
    groups.set(name, [...(groups.get(name) ?? []), line]);
  }
  return ORDER.filter((s) => groups.has(s))
    .map((s) => `### ${s}\n\n${groups.get(s)!.join("\n")}`)
    .join("\n\n");
}

// ── changelog ───────────────────────────────────────────────────────────────

const UNRELEASED = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|^\[[^\]]+\]: |(?![\s\S]))/m;

function unreleasedBody(log: string) {
  return (log.match(UNRELEASED)?.[1] ?? "").trim();
}

/** The body of one version's section, without its heading. */
export function sectionFor(log: string, version: string) {
  const v = version.replace(/^v/, "").replace(/[.+]/g, "\\$&");
  const m = log.match(new RegExp(`^## \\[${v}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`, "m"));
  return m ? m[1].trim() : null;
}

function rollChangelog(log: string, version: string, body: string, prev: string | null) {
  const date = new Date().toISOString().slice(0, 10);
  let out = log.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n\n`);
  const links = [`[Unreleased]: ${REPO}/compare/v${version}...HEAD`, prev ? `[${version}]: ${REPO}/compare/${prev}...v${version}` : `[${version}]: ${REPO}/releases/tag/v${version}`];
  out = out.replace(/^\[Unreleased\]: .*$/m, links.join("\n"));
  if (!out.includes(links[0])) out = `${out.trimEnd()}\n\n${links.join("\n")}\n`;
  return out;
}

// ── commands ────────────────────────────────────────────────────────────────

function check(tag?: string) {
  const v = currentVersion();
  if (tag && `v${v}` !== tag) die(`Tag ${tag} doesn't match the app version ${v}`);
  ok(`All manifests at ${v}${tag ? `, matching ${tag}` : ""}`);
}

function notes(tag?: string) {
  const version = (tag ?? `v${currentVersion()}`).replace(/^v/, "");
  const body = sectionFor(read(CHANGELOG), version);
  if (!body) die(`No "## [${version}]" section in ${CHANGELOG}`);
  const prev = previousTag(`v${version}`);
  const footer = prev ? `\n\n**Full diff:** ${REPO}/compare/${prev}...v${version}` : "";
  process.stdout.write(`${body}${footer}\n`);
}

/** Which updater platforms a signed bundle serves, by its name. The first is the one an older updater asks for. */
function platformsOf(name: string): string[] {
  const arch = /aarch64|arm64/.test(name) ? "aarch64" : /x64|amd64|x86_64/.test(name) ? "x86_64" : null;
  if (!arch) return [];
  if (name.endsWith(".app.tar.gz")) return [`darwin-${arch}`, `darwin-${arch}-app`];
  if (name.endsWith(".AppImage")) return [`linux-${arch}`, `linux-${arch}-appimage`];
  if (name.endsWith(".deb")) return [`linux-${arch}-deb`];
  if (name.endsWith(".rpm")) return [`linux-${arch}-rpm`];
  if (name.endsWith(".msi")) return [`windows-${arch}`, `windows-${arch}-msi`];
  if (name.endsWith("-setup.exe")) return [`windows-${arch}-nsis`];
  return [];
}

/**
 * latest.json, written once after every build has uploaded. Each desktop job
 * used to rewrite it on the release in turn, and two at once lost one: v0.10.0
 * shipped without Apple silicon, and its build failed on the clash.
 */
function manifest(tag: string | undefined, dir: string | undefined) {
  if (!tag || !dir) die("Usage: release manifest v0.2.0 <dir of .sig files>");
  const version = tag.replace(/^v/, "");
  const platforms: Record<string, { signature: string; url: string }> = {};
  for (const sig of readdirSync(dir).filter((f) => f.endsWith(".sig"))) {
    const name = sig.slice(0, -4);
    const entry = { signature: readFileSync(join(dir, sig), "utf8").trim(), url: `${REPO}/releases/download/${tag}/${name}` };
    for (const p of platformsOf(name)) platforms[p] ??= entry;
  }
  for (const need of ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]) if (!platforms[need]) die(`No signed update for ${need} in ${dir}`);
  const notes = sectionFor(read(CHANGELOG), version) ?? "";
  process.stdout.write(JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2) + "\n");
}

function previousTag(tag: string) {
  const tags = git("tag", "--list", "v*", "--sort=-v:refname").split("\n").filter(Boolean);
  const i = tags.indexOf(tag);
  return i >= 0 ? (tags[i + 1] ?? null) : (tags[0] ?? null);
}

function release(kind: string | undefined, dry: boolean, push: boolean) {
  const cur = currentVersion();
  const prev = lastTag();
  const commits = commitsSince(prev);
  const log = read(CHANGELOG);
  const curated = unreleasedBody(log);
  const next = bump(cur, kind ?? inferBump(cur, commits, curated));
  const tag = `v${next}`;

  // Preflight: a release only ever comes from a clean, current main.
  const problems: string[] = [];
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") problems.push(`You're on ${branch}, not main`);
  if (git("status", "--porcelain")) problems.push("The working tree has uncommitted changes");
  if (gitOk("rev-parse", "-q", "--verify", `refs/tags/${tag}`)) problems.push(`Tag ${tag} already exists`);
  if (!commits.length && !curated) problems.push(`Nothing to release since ${prev ?? "the start"}`);
  if (!dry) {
    spawnSync("git", ["fetch", "--quiet", "origin", "main", "--tags"], { cwd: ROOT, stdio: "inherit" });
    if (gitOk("rev-parse", "-q", "--verify", "origin/main") && git("rev-list", "--count", "HEAD..origin/main") !== "0") problems.push("main is behind origin/main; pull first");
  }
  if (problems.length && !dry) die(problems.join("\n  "));

  const body = curated || sectionFromCommits(commits) || "- Maintenance release.";
  const nextLog = rollChangelog(log, next, body, prev);

  console.log(`\n  ${cur} → \x1b[1m${next}\x1b[0m  (${commits.length} commit${commits.length === 1 ? "" : "s"} since ${prev ?? "the start"})`);
  console.log(`  Notes from ${curated ? "## [Unreleased] in CHANGELOG.md" : "commit messages"}\n`);
  console.log(body.replace(/^/gm, "    "));
  console.log();

  if (dry) {
    for (const p of problems) console.log(`\x1b[33m!\x1b[0m ${p} (would stop a real release)`);
    console.log("Dry run: nothing written.");
    return;
  }

  console.log("Typechecking…");
  if (spawnSync("bun", ["run", "typecheck"], { cwd: ROOT, stdio: "inherit" }).status !== 0) die("Typecheck failed");

  for (const m of MANIFESTS) write(m.file, read(m.file).replace(m.re, m.put(next)));
  write(CHANGELOG, nextLog);
  check();

  git("add", CHANGELOG, ...MANIFESTS.map((m) => m.file));
  git("commit", "-q", "-m", `chore(release): ${tag}`);
  git("tag", "-a", tag, "-m", `Otto ${tag}\n\n${body}`);
  ok(`Committed and tagged ${tag}`);

  if (push) {
    git("push", "--atomic", "origin", "main", tag);
    ok(`Pushed. The Release workflow is building ${tag}: ${REPO}/actions`);
  } else {
    console.log(`\nReview with \`git show ${tag}\`, then push to build it:\n\n  git push --atomic origin main ${tag}\n\nTo undo before pushing:  git tag -d ${tag} && git reset --hard HEAD~1`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [cmd, arg, arg2] = args.filter((a) => !a.startsWith("--"));
  for (const f of flags) if (!["--dry-run", "--push"].includes(f)) die(`Unknown flag ${f}`);
  try {
    if (cmd === "check") check(arg);
    else if (cmd === "notes") notes(arg);
    else if (cmd === "manifest") manifest(arg, arg2);
    else release(cmd, flags.has("--dry-run"), flags.has("--push"));
  } catch (e) {
    die((e as Error).message);
  }
}
