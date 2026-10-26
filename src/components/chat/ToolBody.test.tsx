import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolBody } from "./ToolBody";
import type { ToolBlock } from "../../lib/opencode/tools";

const block = (input: Record<string, unknown>) =>
  ({ kind: "tool", key: "tool:call_1", id: "call_1", name: "present", status: "completed", input, started: 0 }) as unknown as ToolBlock;

describe("a present call in the thread", () => {
  test("names what was shown and offers a way back to it", () => {
    const html = renderToStaticMarkup(<ToolBody b={block({ source: "out/cover.png", title: "Cover" })} />);
    expect(html).toContain("Cover");
    expect(html).toContain("Show</button>");
    expect(html).toContain("out/cover.png");
  });

  test("markup shows no path", () => {
    const html = renderToStaticMarkup(<ToolBody b={block({ source: "<h1>hi</h1>" })} />);
    expect(html).toContain("Markup");
    expect(html).not.toContain("&lt;h1&gt;");
  });
});
