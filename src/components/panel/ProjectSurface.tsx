/**
 * Project knowledge: the instruction files the agent reads at the start of
 * every session (AGENTS.md, and CLAUDE.md for projects that use it). Read,
 * edit, or have the agent write one.
 */
import { BookOpen, Eye, Pencil, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useChat } from "../../state/chat";
import { toast, useUI } from "../../state/ui";
import { basename } from "../../lib/format";
import { Markdown } from "../chat/Markdown";
import { Button, IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { PanelEmpty, PanelHeader, PanelTitle, useSurfaceVisible } from "./SidePanel";

const CANDIDATES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md", ".github/copilot-instructions.md"];

const TEMPLATE = (name: string) => `# ${name}

## What this is
One or two sentences on what the project does and who uses it.

## Commands
- Install: \`\`
- Dev: \`\`
- Test: \`\`

## Conventions
- Code style, naming, and patterns to follow.
- Things to avoid.

## Layout
- \`src/\` …
`;

const GENERATE_PROMPT =
  "Explore this project and write an AGENTS.md at its root for future agent sessions: what the project is, how to install, run, test and build it, the code layout, and conventions worth following. Keep it short and specific to this repo. If an AGENTS.md exists, improve it instead.";

export function ProjectSurface({ root }: { root: string | null }) {
  const client = useChat((s) => s.client);
  const visible = useSurfaceVisible("project");
  const [found, setFound] = useState<string[] | null>(null);
  const [file, setFile] = useState("AGENTS.md");
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dir = root?.replace(/\/$/, "") ?? "";
  const editing = draft !== null;
  const dirty = editing && draft !== text;

  const scan = useCallback(async () => {
    if (!client || !root) return;
    const hits: string[] = [];
    await Promise.all(
      CANDIDATES.map(async (c) => {
        try {
          await client.readFile(`${dir}/${c}`, root);
          hits.push(c);
        } catch {
          /* not there */
        }
      }),
    );
    const ordered = CANDIDATES.filter((c) => hits.includes(c));
    setFound(ordered);
    setFile((f) => (ordered.includes(f) ? f : (ordered[0] ?? "AGENTS.md")));
  }, [client, root, dir]);

  useEffect(() => {
    setFound(null);
    setDraft(null);
  }, [root]);

  useEffect(() => {
    if (visible && found === null) void scan();
  }, [visible, found, scan]);

  useEffect(() => {
    if (!client || !root || !found?.includes(file)) return setText(null);
    let alive = true;
    client
      .readFile(`${dir}/${file}`, root)
      .then((t) => alive && setText(t))
      .catch(() => alive && setText(null));
    return () => {
      alive = false;
    };
  }, [client, root, dir, file, found]);

  const save = async () => {
    if (!client || !root || draft === null) return;
    setSaving(true);
    try {
      await client.writeFile(`${dir}/${file}`, draft, root);
      setText(draft);
      setDraft(null);
      if (!found?.includes(file)) setFound([...(found ?? []), file]);
      toast({ tone: "ok", title: `Saved ${file}` });
    } catch (e) {
      toast({ tone: "error", title: `Couldn't save ${file}`, body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    const chat = useChat.getState();
    if (root && root !== chat.projectDir) chat.setProjectDir(root);
    const id = await chat.send(GENERATE_PROMPT, { sessionId: null }).catch(() => null);
    if (id) {
      useUI.getState().closePanel();
      setFound(null);
    }
  };

  const header = (
    <PanelHeader
      actions={
        found &&
        (found.includes(file) || editing) && (
          <>
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()} className="mr-1">
                  {saving ? <Spinner size={12} /> : "Save"}
                </Button>
              </>
            ) : (
              <IconButton label="Edit" size={28} onClick={() => setDraft(text ?? "")}>
                <Pencil size={13} />
              </IconButton>
            )}
          </>
        )
      }
    >
      <PanelTitle surface="project" detail={root ? basename(root) : undefined} />
    </PanelHeader>
  );

  if (!root) return (
    <>
      {header}
      <PanelEmpty icon={<BookOpen size={18} />} title="No project yet" body="Connect a workspace to see its instructions." />
    </>
  );

  return (
    <>
      {header}
      {found && found.length > 1 && (
        <div className="flex shrink-0 gap-1 border-b border-line px-3 py-1.5">
          {found.map((f) => (
            <button
              key={f}
              onClick={() => {
                if (dirty && !confirm("Discard your changes?")) return;
                setDraft(null);
                setFile(f);
              }}
              className={`h-6 rounded-md px-2 font-mono text-[11px] transition-colors ${f === file ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {found === null ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner size={16} />
        </div>
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              void save();
            }
          }}
          spellCheck={false}
          autoFocus
          className="scroll-quiet min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[12px] leading-relaxed text-ink outline-none"
        />
      ) : found.length === 0 ? (
        <PanelEmpty
          icon={<BookOpen size={18} />}
          title="No AGENTS.md yet"
          body="Commands, conventions and things to avoid, read at the start of every session."
        >
          <Button size="sm" variant="primary" icon={<Sparkles size={13} />} onClick={() => void generate()}>
            Have the agent write it
          </Button>
          <Button
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => {
              setFile("AGENTS.md");
              setText("");
              setDraft(TEMPLATE(basename(root)));
            }}
          >
            Start from a template
          </Button>
        </PanelEmpty>
      ) : text === null ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner size={16} />
        </div>
      ) : (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center gap-1.5 text-[11px] text-faint">
            <Eye size={11} /> The agent reads this at the start of every session here.
          </div>
          {text.trim() ? <Markdown text={text} className="text-[13px]" /> : <div className="text-[13px] text-faint">This file is empty.</div>}
          <div className="mt-6 border-t border-line pt-4">
            <Button size="sm" variant="ghost" icon={<Sparkles size={13} />} onClick={() => void generate()}>
              Ask the agent to update it
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
