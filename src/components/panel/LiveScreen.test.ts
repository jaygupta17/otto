import { describe, expect, test } from "bun:test";
import { confirmTakes, dblclickTakes } from "./LiveScreen";

// The gate around "Take control": taking control pauses a busy agent, so a
// stray tap, a gesture's synthetic events or one held key must never reach it.
describe("confirmTakes", () => {
  test("a pointer tap is ignored while it could be the second tap of a fast double-tap", () => {
    expect(confirmTakes(1, 0, false)).toBe(false);
    expect(confirmTakes(1, 150, false)).toBe(false);
    expect(confirmTakes(2, 299, false)).toBe(false);
  });

  test("and works once the button has had a beat to be seen", () => {
    expect(confirmTakes(1, 300, false)).toBe(true);
    expect(confirmTakes(1, 5000, false)).toBe(true);
    // Deliberately double-clicking the button is fine once past the gate.
    expect(confirmTakes(2, 400, false)).toBe(true);
  });

  test("a keyboard or screen reader activation is never a stray tap and goes through at once", () => {
    expect(confirmTakes(0, 0, false)).toBe(true);
    expect(confirmTakes(0, 50, false)).toBe(true);
    expect(confirmTakes(0, 5000, false)).toBe(true);
  });

  test("the keypress that armed cannot also confirm on its release", () => {
    // Enter-to-arm then Enter-to-confirm quickly is two presses and works;
    // one Space held across the arm is one press and must not.
    expect(confirmTakes(0, 0, true)).toBe(false);
    expect(confirmTakes(0, 5000, true)).toBe(false);
  });
});

describe("dblclickTakes", () => {
  test("a mouse's own double-click takes control at once on desktop", () => {
    expect(dblclickTakes(false, null)).toBe(true);
    // Touched a moment ago, but this one is the mouse: still deliberate.
    expect(dblclickTakes(false, 5000)).toBe(true);
  });

  test("touch devices never take from a dblclick: a double-tap synthesises one", () => {
    expect(dblclickTakes(true, null)).toBe(false);
    expect(dblclickTakes(true, 5000)).toBe(false);
  });

  test("so does a touchscreen on a mouse-first machine (the synthetic dblclick path)", () => {
    expect(dblclickTakes(false, 0)).toBe(false);
    expect(dblclickTakes(false, 300)).toBe(false);
    expect(dblclickTakes(false, 999)).toBe(false);
    expect(dblclickTakes(false, 1000)).toBe(true);
  });

  test("the synthetic click, click, dblclick of a double-tap resolves to no take", () => {
    // On the pane the two clicks arm and disarm; the dblclick is the only
    // takeover path in the sequence and the gate refuses it on touch.
    const clicks = [confirmTakes(1, 0, false), confirmTakes(2, 30, false)]; // stray taps, if they met the confirm
    const dblclick = dblclickTakes(true, 30);
    expect([...clicks, dblclick]).toEqual([false, false, false]);
  });
});
