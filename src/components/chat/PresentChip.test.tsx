import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnArtifacts } from "./PresentChip";
import type { Block } from "../../lib/opencode/projection";

const present = (id: string, source: string, title?: string): Block =>
  ({ kind: "tool", key: `tool:${id}`, id, name: "present", status: "completed", input: { source, ...(title ? { title } : {}) }, started: 0 }) as unknown as Block;

const text = { kind: "text", key: "t", text: "Done.", streaming: false } as unknown as Block;

describe("a turn's artifacts", () => {
  test("render a chip for what the turn presented", () => {
    const html = renderToStaticMarkup(<TurnArtifacts blocks={[text, present("c1", "out/cover.png", "Cover"), text]} />);
    expect(html).toContain("Cover");
    expect(html).toContain("cover.png");
  });

  test("one chip per source, the last presentation winning, in first-seen order", () => {
    const html = renderToStaticMarkup(
      <TurnArtifacts blocks={[present("c1", "out/a.html", "First"), present("c2", "out/b.html", "Other"), present("c3", "out/a.html", "Second")]} />,
    );
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain("Second");
    expect(html).not.toContain("First");
    expect(html.indexOf("Second")).toBeLessThan(html.indexOf("Other"));
  });

  test("render nothing for a turn that presented nothing", () => {
    expect(renderToStaticMarkup(<TurnArtifacts blocks={[text]} />)).toBe("");
  });
});
