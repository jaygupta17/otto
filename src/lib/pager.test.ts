import { describe, expect, test } from "bun:test";
import { axisOf, ofHint, resist, settle } from "./pager";

const base = { axis: "x" as const, edge: false, dx: 0, dy: 0, vx: 0, vy: 0, width: 400, at: 1, count: 3 };

describe("axisOf", () => {
  test("waits until the drag is past the slop", () => {
    expect(axisOf(3, 4)).toBeNull();
  });
  test("sideways is x, down is y, up is nothing", () => {
    expect(axisOf(-30, 10)).toBe("x");
    expect(axisOf(5, 40)).toBe("y");
    expect(axisOf(5, -40)).toBe("none");
  });
});

describe("resist", () => {
  test("only past the ends", () => {
    expect(resist(100, 0, 3)).toBe(35);
    expect(resist(-100, 2, 3)).toBe(-35);
    expect(resist(100, 1, 3)).toBe(100);
    expect(resist(-100, 0, 3)).toBe(-100);
  });
});

describe("settle", () => {
  test("a short drag stays", () => {
    expect(settle({ ...base, dx: -40 })).toEqual({ close: false, to: 1 });
  });
  test("far enough or flicked turns the page", () => {
    expect(settle({ ...base, dx: -120 })).toEqual({ close: false, to: 2 });
    expect(settle({ ...base, dx: 30, vx: 800 })).toEqual({ close: false, to: 0 });
  });
  test("never past the ends", () => {
    expect(settle({ ...base, at: 2, dx: -300 })).toEqual({ close: false, to: 2 });
    expect(settle({ ...base, at: 0, dx: 300 })).toEqual({ close: false, to: 0 });
  });
  test("pulled down closes; a nudge doesn't", () => {
    expect(settle({ ...base, axis: "y", dy: 140 })).toEqual({ close: true });
    expect(settle({ ...base, axis: "y", dy: 40, vy: 900 })).toEqual({ close: true });
    expect(settle({ ...base, axis: "y", dy: 10, vy: 900 })).toEqual({ close: false, to: 1 });
    expect(settle({ ...base, axis: "y", dy: 60 })).toEqual({ close: false, to: 1 });
  });
  test("a swipe in from the left edge closes, even with a page before", () => {
    expect(settle({ ...base, edge: true, dx: 100 })).toEqual({ close: true });
    expect(settle({ ...base, edge: true, dx: 40 })).toEqual({ close: false, to: 1 });
    // From the edge but leftwards is an ordinary page turn.
    expect(settle({ ...base, edge: true, dx: -150 })).toEqual({ close: false, to: 2 });
  });
  test("up does nothing", () => {
    expect(settle({ ...base, axis: "none", dy: -300 })).toEqual({ close: false, to: 1 });
  });
});

test("ofHint", () => {
  expect(ofHint(1, 3)).toBe("2 of 3");
  expect(ofHint(0, 1)).toBe("");
});
