import { describe, expect, test } from "bun:test";
import { BAYER8, bayer, dot, fieldTone, gaugeTone, meterTone, groundTone, paint, parseColor, shimmerHalo, shimmerTone, SHIMMER_W, sphere, TRACK } from "./dither";

describe("bayer", () => {
  test("holds every threshold once, evenly spaced in (0, 1)", () => {
    for (const n of [2, 4, 8]) {
      const m = [...bayer(n)].sort((a, b) => a - b);
      expect(m.length).toBe(n * n);
      m.forEach((v, i) => expect(v).toBeCloseTo((i + 0.5) / (n * n), 6));
    }
  });

  test("the 2×2 matrix is the classic one", () => {
    expect([...bayer(2)].map((v) => v * 4 - 0.5)).toEqual([0, 2, 3, 1]);
  });

  test("a flat tone turns on that share of dots", () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      let on = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (dot(v, x, y)) on++;
      expect(on).toBe(Math.round(v * 64));
    }
    expect(BAYER8.length).toBe(64);
  });
});

describe("sphere", () => {
  test("is dark outside the disc and brightest facing the light", () => {
    expect(sphere(1.1, 0, 0, 0, 1)).toBe(-1);
    expect(sphere(0, 0, 0, 0, 1)).toBeCloseTo(1, 6);
    expect(sphere(-0.6, 0, -1, 0, 0.3)).toBeGreaterThan(sphere(0.6, 0, -1, 0, 0.3));
  });

  test("the shaded side keeps its ambient", () => {
    expect(sphere(0.9, 0, -1, 0, 0, 0.06)).toBeCloseTo(0.06, 6);
  });
});

test("paint writes dots in colour and leaves the rest clear", () => {
  const img = { data: new Uint8ClampedArray(4 * 4 * 4) } as ImageData;
  paint(img, 4, 4, (x) => (x < 2 ? 1 : 0), [10, 20, 30]);
  expect([...img.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
  expect(img.data[3 * 4 + 3]).toBe(0);
});

test("parseColor reads computed and hex colours", () => {
  expect(parseColor("rgb(143, 208, 255)")).toEqual([143, 208, 255]);
  expect(parseColor(" rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3]);
  expect(parseColor("#1a73c9")).toEqual([26, 115, 201]);
  expect(parseColor("#fff")).toEqual([255, 255, 255]);
});

test("the shimmer band peaks mid-tile and is dark at the edges", () => {
  expect(shimmerTone(0)).toBe(0);
  expect(shimmerTone(SHIMMER_W - 1)).toBe(0);
  expect(shimmerTone(SHIMMER_W / 2)).toBeGreaterThan(0.95);
});

test("the shimmer's accent halo is wider than the light, sparse, and dark at the edges", () => {
  expect(shimmerHalo(0)).toBe(0);
  expect(shimmerHalo(SHIMMER_W - 1)).toBe(0);
  const flank = SHIMMER_W / 2 + SHIMMER_W * 0.2;
  expect(shimmerTone(flank)).toBe(0);
  expect(shimmerHalo(flank)).toBeGreaterThan(0);
  for (let x = 0; x < SHIMMER_W; x++) expect(shimmerHalo(x)).toBeLessThanOrEqual(0.34);
});

test("the gauge fills clockwise from twelve o'clock", () => {
  expect(gaugeTone(0.1, -0.5, 0.25)).toBe(1);
  expect(gaugeTone(0.5, 0.1, 0.25)).toBe(TRACK);
  expect(gaugeTone(-0.5, -0.1, 0.9)).toBe(1);
  expect(gaugeTone(-0.5, -0.1, 0.7)).toBe(TRACK);
  expect(gaugeTone(1, 1, 1)).toBe(-1);
});

test("the meter is solid up to its share", () => {
  expect(meterTone(0, 100, 0.3)).toBe(1);
  expect(meterTone(29, 100, 0.3)).toBe(1);
  expect(meterTone(30, 100, 0.3)).toBe(TRACK);
  expect(meterTone(0, 100, 0)).toBe(TRACK);
});

test("the ground is densest in the middle and gone at the ends", () => {
  expect(groundTone(49.5, 100)).toBeCloseTo(0.9, 2);
  expect(groundTone(0, 100)).toBeLessThan(0.05);
  expect(groundTone(99, 100)).toBeLessThan(0.05);
});

describe("fieldTone", () => {
  test("thick at the edges, clear down the middle, fading in at the top and gone by the bottom", () => {
    for (const t of [0, 3.7, 12]) {
      expect(fieldTone(0.5, 0.3, t)).toBe(0);
      expect(fieldTone(0.02, 0.4, t)).toBeGreaterThan(0.2);
      expect(fieldTone(0.98, 0.4, t)).toBeGreaterThan(0.2);
      expect(fieldTone(0.02, 0, t)).toBe(0);
      expect(fieldTone(0.02, 1, t)).toBe(0);
    }
  });
  test("right-weighted leaves the left side clear", () => {
    expect(fieldTone(0.1, 0.4, 1, "right")).toBe(0);
    expect(fieldTone(0.98, 0.4, 1, "right")).toBeGreaterThan(0.2);
  });
  test("drifts over time", () => {
    expect(fieldTone(0.9, 0.3, 0)).not.toBeCloseTo(fieldTone(0.9, 0.3, 2), 3);
  });
});
