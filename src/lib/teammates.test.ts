import { describe, expect, test } from "bun:test";
import { HELPERS, isHelper, isListedAgent, isOfferedAgent, STARTER_TEAM } from "./teammates";

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

  test("helpers are glyphs, each its own", () => {
    expect(Object.keys(HELPERS).sort()).toEqual(["explore", "general"]);
    const seeds = Object.values(HELPERS).map((h) => h.glyph);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(isHelper("relay")).toBe(false);
    expect(isHelper("toString")).toBe(false);
  });

  test("the starting team is Juno with Scout, Relay and Patch", () => {
    expect(STARTER_TEAM.map((t) => t.id)).toEqual(["juno", "scout", "relay", "patch"]);
  });
});
