import { describe, expect, test } from "bun:test";
import { composeMessage, kindOf, mimeOf, splitNote, uniqueName, uploadFolder, type Attachment } from "./attachments";

const root = "/work/app";
const png: Attachment = { path: "/work/app/.otto/uploads/2026-10-24/shot.png", name: "shot.png", mime: "image/png", size: 2048 };
const csv: Attachment = { path: "/work/app/.otto/uploads/2026-10-24/sales.csv", name: "sales.csv", mime: "text/csv", size: 3 * 1024 * 1024 };

describe("attachments", () => {
  test("types come from the browser, else the extension", () => {
    expect(mimeOf("a.PNG", "")).toBe("image/png");
    expect(mimeOf("a.bin", "")).toBe("application/octet-stream");
    expect(mimeOf("a.png", "image/webp")).toBe("image/webp");
    expect(kindOf("application/pdf", "x.pdf")).toBe("PDF");
    expect(kindOf("text/csv", "x.csv")).toBe("CSV");
  });

  test("folders by local day and names that don't clash", () => {
    expect(uploadFolder("/w/", new Date(2026, 9, 4))).toBe("/w/.otto/uploads/2026-10-04");
    expect(uniqueName("a.png", new Set(["a.png", "a (2).png"]))).toBe("a (3).png");
    expect(uniqueName("../x/y", new Set())).toBe(".._x_y");
  });

  test("images ride along only for a model that takes them; every file is in the note", () => {
    const seen = composeMessage("look", [png, csv], root, true);
    expect(seen.files).toEqual([{ uri: `file://${png.path}`, name: "shot.png" }]);
    expect(seen.text.startsWith("look\n\n[The user attached 2 files")).toBe(true);
    expect(seen.text).toContain("- .otto/uploads/2026-10-24/sales.csv (CSV, 3.0 MB; open it with your tools)");
    const blind = composeMessage("look", [png], root, false);
    expect(blind.files).toBeUndefined();
    expect(blind.text).toContain("you can't view images");
  });

  test("the stored text splits back into what was typed and the note", () => {
    const out = composeMessage("hi", [csv], root, true);
    expect(splitNote(out.text, out.metadata)).toEqual({ text: "hi", note: out.metadata!.otto.note, attachments: [csv] });
    const only = composeMessage("", [csv], root, true);
    expect(splitNote(only.text, only.metadata).text).toBe("");
    expect(splitNote("plain", undefined)).toEqual({ text: "plain" });
  });
});
