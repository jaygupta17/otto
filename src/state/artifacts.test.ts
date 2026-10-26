import { beforeEach, describe, expect, test } from "bun:test";
import { artifactsFor, isPresentTool, selectedArtifact, useArtifacts } from "./artifacts";
import { useUI } from "./ui";
import { useChat } from "./chat";

/** A machine whose workspace holds these files (paths relative to its root). */
function client(files: string[]) {
  return {
    async listDir(path: string) {
      const prefix = `${path.replace(/\/$/, "")}/`;
      return files
        .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
        .map((f) => ({ path: f.slice(prefix.length), type: "file" as const }));
    },
  };
}

const reset = () => {
  useArtifacts.setState({ bySession: {}, selected: {}, fresh: 0, request: 0, reveal: null });
  useUI.setState({ panel: null, lastPanel: "artifact" });
};

/** Call ids are unique per conversation; the store remembers every one it has seen. */
let seq = 0;
const id = (name: string) => `${name}-${++seq}`;

beforeEach(() => {
  reset();
  useChat.setState({ client: client(["/work/a/cover.png", "/work/a/index.html", "/work/a/notes.md", "/work/a/build.zip"]) as never, activeId: "ses_1", homeDir: "/work", sessions: {}, timelines: {} });
});

describe("the present tool", () => {
  test("is named `present`, with or without a namespace", () => {
    expect(isPresentTool("present")).toBe(true);
    expect(isPresentTool("otto.present")).toBe(true);
    expect(isPresentTool("otto.present:2")).toBe(true);
    expect(isPresentTool("present_file")).toBe(false);
    expect(isPresentTool("read")).toBe(false);
    expect(isPresentTool(undefined)).toBe(false);
  });
});

describe("recording a presentation", () => {
  test("a file in the session becomes an artifact with the right renderer", async () => {
    const cover = id("cover");
    await useArtifacts.getState().presented(cover, { source: "a/cover.png", title: "Cover" }, "ses_1", "/work", 1000);
    const [a] = useArtifacts.getState().bySession.ses_1;
    expect(a).toMatchObject({ id: cover, title: "Cover", kind: "image", path: "/work/a/cover.png", sessionId: "ses_1", at: 1000 });
    expect(a.problem).toBeUndefined();
    // The newest is the one on show.
    expect(useArtifacts.getState().selected.ses_1).toBe(cover);
  });

  test("each renderer follows the source", async () => {
    const store = useArtifacts.getState();
    const kinds: Record<string, string> = {};
    for (const [name, source, at] of [
      ["h", "a/index.html", 1],
      ["t", "a/notes.md", 2],
      ["d", "a/build.zip", 3],
      ["m", "<h1>hi</h1>", 4],
      ["u", "https://example.com", 5],
    ] as const) {
      const call = id(name);
      await store.presented(call, { source }, "ses_1", "/work", at);
      kinds[name] = useArtifacts.getState().bySession.ses_1.find((a) => a.id === call)!.kind;
    }
    expect(kinds).toEqual({ h: "html", t: "text", d: "download", m: "html", u: "url" });
  });

  test("`as` picks the renderer for a file the name doesn't explain", async () => {
    const store = useArtifacts.getState();
    const [zip, sheet] = [id("zip"), id("sheet")];
    await store.presented(zip, { source: "a/build.zip", as: "text" }, "ses_1", "/work", 1);
    await store.presented(sheet, { source: "a/notes.md", as: "download" }, "ses_1", "/work", 2);
    const byId = Object.fromEntries(useArtifacts.getState().bySession.ses_1.map((a) => [a.id, a.kind]));
    expect(byId).toEqual({ [zip]: "text", [sheet]: "download" });
  });

  test("markup is kept as markup, never as DOM", async () => {
    await useArtifacts.getState().presented(id("m"), { source: '<h1 id="x">hi</h1>' }, "ses_1", "/work", 1);
    const a = useArtifacts.getState().bySession.ses_1[0];
    expect(a.markup).toBe('<h1 id="x">hi</h1>');
    expect(a.path).toBeUndefined();
  });

  test("a path outside the session is recorded, and says why it can't be shown", async () => {
    await useArtifacts.getState().presented(id("x"), { source: "../secrets.env" }, "ses_1", "/work/a", 1);
    const a = useArtifacts.getState().bySession.ses_1[0];
    expect(a.path).toBeUndefined();
    expect(a.problem).toContain("outside this session's folder");
  });

  test("a file that isn't there says so, once the check comes back", async () => {
    await useArtifacts.getState().presented(id("n"), { source: "a/missing.png" }, "ses_1", "/work", 1);
    expect(useArtifacts.getState().bySession.ses_1[0].problem).toContain("Couldn't find that file");
  });

  test("the same call is recorded once, however often the timeline is scanned", async () => {
    const store = useArtifacts.getState();
    const call = id("once");
    await store.presented(call, { source: "a/cover.png" }, "ses_1", "/work", 1);
    await store.presented(call, { source: "a/cover.png" }, "ses_1", "/work", 1);
    await store.presented(call, { source: "a/cover.png" }, "ses_1", "/work", 1);
    expect(useArtifacts.getState().bySession.ses_1).toHaveLength(1);
  });

  test("out of order (checks finish when they finish), the list is still newest first", async () => {
    const store = useArtifacts.getState();
    const [old, fresh, mid] = [id("old"), id("new"), id("mid")];
    await store.presented(old, { source: "a/cover.png" }, "ses_1", "/work", 100);
    await store.presented(fresh, { source: "<h1>x</h1>" }, "ses_1", "/work", 300);
    await store.presented(mid, { source: "a/notes.md" }, "ses_1", "/work", 200);
    expect(useArtifacts.getState().bySession.ses_1.map((a) => a.id)).toEqual([fresh, mid, old]);
  });

  test("the list is capped, and the oldest drops", async () => {
    const store = useArtifacts.getState();
    const ids = Array.from({ length: 30 }, () => id("cap"));
    for (let i = 0; i < 30; i++) await store.presented(ids[i], { source: "<h1>x</h1>" }, "ses_1", "/work", 1000 + i);
    const list = useArtifacts.getState().bySession.ses_1;
    expect(list).toHaveLength(24);
    expect(list[0].id).toBe(ids[29]);
    expect(list.at(-1)?.id).toBe(ids[6]);
  });

  test("a trimmed presentation doesn't creep back on the next scan", async () => {
    const store = useArtifacts.getState();
    const ids = Array.from({ length: 26 }, () => id("trim"));
    for (let i = 0; i < 26; i++) await store.presented(ids[i], { source: "<h1>x</h1>" }, "ses_1", "/work", 1000 + i);
    // The recorder walks the whole history again: the two oldest are still known.
    await store.presented(ids[0], { source: "<h1>x</h1>" }, "ses_1", "/work", 1000);
    await store.presented(ids[1], { source: "<h1>x</h1>" }, "ses_1", "/work", 1001);
    const list = useArtifacts.getState().bySession.ses_1;
    expect(list).toHaveLength(24);
    expect(list.some((a) => a.id === ids[0] || a.id === ids[1])).toBe(false);
  });

  test("a call with no source is an entry that says what was wrong", async () => {
    await useArtifacts.getState().presented(id("e"), {}, "ses_1", "/work", 1);
    expect(useArtifacts.getState().bySession.ses_1[0].problem).toContain("didn't say what to show");
  });

  test("a presentation lights the dock only while the panel is closed", async () => {
    await useArtifacts.getState().presented(id("a"), { source: "<h1>x</h1>" }, "ses_1", "/work", 1);
    expect(useArtifacts.getState().fresh).toBe(1);
    useUI.setState({ panel: "artifact" });
    await useArtifacts.getState().presented(id("b"), { source: "<h1>y</h1>" }, "ses_1", "/work", 2);
    expect(useArtifacts.getState().fresh).toBe(1); // you're looking at it
    useArtifacts.getState().seen();
    expect(useArtifacts.getState().fresh).toBe(0);
  });
});

describe("things the user asked to see", () => {
  test("a path from chat opens the panel on it", async () => {
    await useArtifacts.getState().showLocal("ses_1", "/work", "a/notes.md", { line: 3 });
    expect(useUI.getState().panel).toBe("artifact");
    expect(useArtifacts.getState().selected.ses_1).toBe("local:a/notes.md");
    // The line jump carries the resolved path, so the preview can scroll to it.
    expect(useArtifacts.getState().reveal).toMatchObject({ path: "/work/a/notes.md", line: 3 });
  });

  test("a localhost link becomes a URL artifact", () => {
    useArtifacts.getState().showUrl("ses_1", "localhost:5173/app");
    expect(useUI.getState().panel).toBe("artifact");
    const [a] = useArtifacts.getState().bySession.ses_1;
    expect(a).toMatchObject({ kind: "url", url: "localhost:5173/app", title: "localhost:5173/app" });
  });
});

describe("what a session shows", () => {
  test("its own presentations, then its subagents'", async () => {
    const store = useArtifacts.getState();
    const [mine, helper, stranger] = [id("mine"), id("helper"), id("stranger")];
    await store.presented(mine, { source: "<h1>a</h1>" }, "ses_1", "/work", 10);
    await store.presented(helper, { source: "<h1>b</h1>" }, "ses_child", "/work", 20);
    await store.presented(stranger, { source: "<h1>c</h1>" }, "ses_other", "/work", 30);
    const list = artifactsFor(useArtifacts.getState().bySession, "ses_1", { ses_child: "ses_1" });
    expect(list.map((a) => a.id)).toEqual([helper, mine]);
  });

  test("the selected one, or the newest when nothing is chosen", async () => {
    const store = useArtifacts.getState();
    const [first, second] = [id("a"), id("b")];
    await store.presented(first, { source: "<h1>a</h1>" }, "ses_1", "/work", 10);
    await store.presented(second, { source: "<h1>b</h1>" }, "ses_1", "/work", 20);
    const list = useArtifacts.getState().bySession.ses_1;
    expect(selectedArtifact(undefined, list)?.id).toBe(second);
    expect(selectedArtifact(first, list)?.id).toBe(first);
    expect(selectedArtifact("gone", list)?.id).toBe(second);
    expect(selectedArtifact(undefined, [])).toBeNull();
  });

  test("no session shows nothing", async () => {
    await useArtifacts.getState().presented(id("a"), { source: "<h1>a</h1>" }, "ses_1", "/work", 1);
    expect(artifactsFor(useArtifacts.getState().bySession, null, {})).toEqual([]);
  });
});
