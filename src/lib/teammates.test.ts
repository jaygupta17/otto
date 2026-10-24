import { describe, expect, test } from "bun:test";
import { BIRD_IDS } from "./flock/birds";
import { HELPER_BIRDS, isListedAgent, isOfferedAgent } from "./teammates";

describe("helper birds", () => {
  test("explore and general are listed but not offered", () => {
    for (const id of ["explore", "general"]) {
      expect(isListedAgent(id)).toBe(true);
      expect(isOfferedAgent(id)).toBe(false);
    }
  });

  test("build and plan stay hidden; teammates are listed", () => {
    expect(isListedAgent("build")).toBe(false);
    expect(isListedAgent("plan")).toBe(false);
    expect(isListedAgent("relay")).toBe(true);
  });

  test("every helper is a real Flock bird, and no two share one", () => {
    const birds = Object.values(HELPER_BIRDS).map((h) => h.bird);
    for (const b of birds) expect(BIRD_IDS).toContain(b);
    expect(new Set(birds).size).toBe(birds.length);
  });
});
