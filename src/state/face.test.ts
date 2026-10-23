import { describe, expect, test } from "bun:test";
import { reaction } from "./face";

describe("reaction", () => {
  test("celebrates a finished run and is pleased by one you watched finish", () => {
    expect(reaction("working", "done")?.mood).toBe("party");
    expect(reaction("writing", "idle")?.mood).toBe("happy");
  });

  test("thanks you for answering and jolts when a run fails", () => {
    expect(reaction("needs", "working")?.mood).toBe("love");
    expect(reaction("retrying", "failed")?.mood).toBe("wow");
  });

  test("gets an idea when it starts writing and shades on when it's back from retrying", () => {
    expect(reaction("working", "writing")?.mood).toBe("idea");
    expect(reaction("retrying", "writing")?.mood).toBe("cool");
  });

  test("has nothing to say for quiet changes", () => {
    expect(reaction("idle", "working")).toBeNull();
    expect(reaction("writing", "working")).toBeNull();
    expect(reaction("done", "idle")).toBeNull();
    expect(reaction("working", "stopped")).toBeNull();
  });
});
