import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@opencode/client";
import { cleanName, isFree, modelLabel, modelLabels, providerName } from "./modelLabel";

/** Just enough of a ModelInfo for naming. */
const m = (providerID: string, id: string, name = "MiMo-V2.6-Flash", input = 1, output = 1): ModelInfo =>
  ({ providerID, id, name, cost: [{ input, output }] }) as ModelInfo;

const labels = (models: ModelInfo[]) => [...modelLabels(models).values()];

describe("cleanName", () => {
  test("drops a trailing free tag, keeps everything else", () => {
    expect(cleanName(m("a", "x", "Exo Free"))).toBe("Exo");
    expect(cleanName(m("a", "x", "Big Pickle (free)"))).toBe("Big Pickle");
    expect(cleanName(m("a", "x", "mimo-v2.6-flash-free"))).toBe("mimo-v2.6-flash");
    expect(cleanName(m("a", "x", "MiMo-V2.6-Flash"))).toBe("MiMo-V2.6-Flash");
    expect(cleanName(m("a", "x", "Free"))).toBe("Free");
  });
});

describe("isFree", () => {
  test("by id suffix or by price", () => {
    expect(isFree(m("opencode", "mimo-v2.6-flash-free"))).toBe(true);
    expect(isFree(m("openrouter", "mimo:free"))).toBe(true);
    expect(isFree(m("opencode", "mimo", "MiMo", 0, 0))).toBe(true);
    expect(isFree(m("opencode-go", "mimo"))).toBe(false);
  });
});

describe("modelLabels", () => {
  test("a lone model keeps its plain name", () => {
    expect(modelLabels([m("opencode-go", "mimo-v2.6-flash")]).get("opencode-go/mimo-v2.6-flash")).toBe("MiMo-V2.6-Flash");
  });

  test("the free twin is tagged and the paid name stays as it was", () => {
    const free = m("opencode", "mimo-v2.6-flash-free");
    const paid = m("opencode-go", "mimo-v2.6-flash");
    const map = modelLabels([paid, free]);
    expect(map.get("opencode/mimo-v2.6-flash-free")).toBe("MiMo-V2.6-Flash · Free");
    expect(map.get("opencode-go/mimo-v2.6-flash")).toBe("MiMo-V2.6-Flash");
  });

  test("same works inside one provider", () => {
    const free = m("opencode", "mimo-v2.6-flash-free");
    const paid = m("opencode", "mimo-v2.6-flash");
    const map = modelLabels([free, paid]);
    expect(map.get("opencode/mimo-v2.6-flash-free")).toBe("MiMo-V2.6-Flash · Free");
    expect(map.get("opencode/mimo-v2.6-flash")).toBe("MiMo-V2.6-Flash");
  });

  test("two paid twins fall apart by provider", () => {
    const map = modelLabels([m("opencode", "mimo-v2.6-flash"), m("opencode-go", "mimo-v2.6-flash")]);
    expect(map.get("opencode/mimo-v2.6-flash")).toBe("MiMo-V2.6-Flash · OpenCode Zen");
    expect(map.get("opencode-go/mimo-v2.6-flash")).toBe("MiMo-V2.6-Flash · OpenCode Go");
  });

  test("two free twins say free and which provider", () => {
    const map = modelLabels([m("opencode", "a-free", "MiMo-V2.6-Flash", 0, 0), m("opencode-go", "b-free", "MiMo-V2.6-Flash", 0, 0)]);
    expect(map.get("opencode/a-free")).toBe("MiMo-V2.6-Flash · OpenCode Zen · Free");
    expect(map.get("opencode-go/b-free")).toBe("MiMo-V2.6-Flash · OpenCode Go · Free");
  });

  test("a twin the tags can't separate falls back to its id", () => {
    const map = modelLabels([m("opencode", "mimo-a", "MiMo-V2.6-Flash", 0, 0), m("opencode", "mimo-b", "MiMo-V2.6-Flash", 0, 0)]);
    expect(map.get("opencode/mimo-a")).toBe("MiMo-V2.6-Flash · mimo-a");
    expect(map.get("opencode/mimo-b")).toBe("MiMo-V2.6-Flash · mimo-b");
  });

  test("a mixed group with two paid twins still separates every row", () => {
    const trio = [
      m("opencode", "mimo-free", "MiMo-V2.6-Flash", 0, 0),
      m("opencode-go", "mimo", "MiMo-V2.6-Flash"),
      m("anthropic", "mimo", "MiMo-V2.6-Flash"),
    ];
    const map = modelLabels(trio);
    expect(new Set(labels(trio)).size).toBe(3);
    expect(map.get("opencode/mimo-free")).toBe("MiMo-V2.6-Flash · Free");
    // The two paid twins also share a name with each other, so they name their provider.
    expect(map.get("opencode-go/mimo")).toBe("MiMo-V2.6-Flash · OpenCode Go");
    expect(map.get("anthropic/mimo")).toBe("MiMo-V2.6-Flash · Anthropic");
  });

  test("distinct names are left alone", () => {
    const map = modelLabels([m("opencode-go", "mimo", "MiMo-V2.6-Flash"), m("anthropic", "sonnet", "Claude Sonnet 4.5")]);
    expect(map.get("opencode-go/mimo")).toBe("MiMo-V2.6-Flash");
    expect(map.get("anthropic/sonnet")).toBe("Claude Sonnet 4.5");
  });
});

describe("modelLabel", () => {
  test("looks one model up, and falls back to its plain name", () => {
    const free = m("opencode", "mimo-v2.6-flash-free");
    const paid = m("opencode-go", "mimo-v2.6-flash");
    expect(modelLabel([free, paid], free)).toBe("MiMo-V2.6-Flash · Free");
    expect(modelLabel([paid], paid)).toBe("MiMo-V2.6-Flash");
    expect(modelLabel([], m("opencode", "x", "Exo Free"))).toBe("Exo");
  });
});

describe("providerName", () => {
  test("known ids read as brands, unknown ones are prettified", () => {
    expect(providerName("opencode")).toBe("OpenCode Zen");
    expect(providerName("opencode-go")).toBe("OpenCode Go");
    expect(providerName("some-new-one")).toBe("Some New One");
  });
});
