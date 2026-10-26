import { describe, expect, test } from "bun:test";
import { cropLayout, fitCommand, parseFit, type ScreenGeometry } from "./screenFit";

const geo = (window: ScreenGeometry["window"]): ScreenGeometry => ({ screen: { w: 1920, h: 1080 }, window });

describe("parseFit", () => {
  test("reads the last JSON line of the output", () => {
    const out = 'noise\n{"screen": {"w": 1920, "h": 1080}, "window": {"id": 58720259, "x": 710, "y": 0, "w": 500, "h": 833}}\n';
    expect(parseFit(out)).toEqual(geo({ id: 58720259, x: 710, y: 0, w: 500, h: 833 }));
  });

  test("a Chrome that isn't up is a null window", () => {
    expect(parseFit('{"screen": {"w": 1920, "h": 1080}, "window": null}')).toEqual(geo(null));
  });

  test("nothing usable is null: an old kit prints nothing, a bad screen can't be cropped", () => {
    expect(parseFit("")).toBeNull();
    expect(parseFit("{not json")).toBeNull();
    expect(parseFit('{"screen": {"w": 0, "h": 1080}, "window": null}')).toBeNull();
    expect(parseFit('{"screen": {"w": 1920, "h": 1080}, "window": {"id": 1, "x": 0, "y": 0, "w": 0, "h": 10}}')).toEqual(geo(null));
  });
});

describe("fitCommand", () => {
  test("only runs on a kit that knows `fit` (older ones would open it as a URL)", () => {
    expect(fitCommand([390.4, 650])).toContain("-ge 3 ] && ~/.local/bin/otto-browser fit 390 650");
    expect(fitCommand("max")).toContain("otto-browser fit max");
    expect(fitCommand()).toContain("otto-browser fit 2>");
  });
});

describe("cropLayout", () => {
  test("the window fills the box and the stream sits under it so the window lands exactly there", () => {
    const c = cropLayout(geo({ id: 1, x: 710, y: 0, w: 500, h: 1000 }), { w: 400, h: 800 })!;
    // 0.8 CSS px per desktop px, no bars.
    expect(c.clip).toEqual({ x: 0, y: 0, w: 400, h: 800 });
    expect(c.frame).toEqual({ x: -568, y: -0, w: 1536, h: 864 });
  });

  test("a window shaped unlike the box is centred, with bars, never cut", () => {
    const c = cropLayout(geo({ id: 1, x: 0, y: 0, w: 960, h: 1080 }), { w: 400, h: 300 })!;
    const s = 300 / 1080;
    expect(c.clip.h).toBeCloseTo(300);
    expect(c.clip.w).toBeCloseTo(960 * s);
    expect(c.clip.x).toBeCloseTo((400 - 960 * s) / 2);
    expect(c.clip.y).toBeCloseTo(0);
  });

  test("only the part of the window on screen counts", () => {
    const c = cropLayout(geo({ id: 1, x: -100, y: 900, w: 600, h: 400 }), { w: 500, h: 180 })!;
    // On screen: x 0..500, y 900..1080, so 1 px per px.
    expect(c.clip).toEqual({ x: 0, y: 0, w: 500, h: 180 });
    expect(c.frame).toEqual({ x: -0, y: -900, w: 1920, h: 1080 });
  });

  test("no window, an off-screen one or an empty box is no crop", () => {
    expect(cropLayout(geo(null), { w: 400, h: 800 })).toBeNull();
    expect(cropLayout(geo({ id: 1, x: 2000, y: 0, w: 500, h: 800 }), { w: 400, h: 800 })).toBeNull();
    expect(cropLayout(geo({ id: 1, x: 0, y: 0, w: 500, h: 800 }), { w: 0, h: 800 })).toBeNull();
  });
});
