import { describe, expect, it } from "vitest";

import { dominantHue } from "./game-hue";

/** RGBA pixels, `count` times the same color. */
const pixels = (rgba: [number, number, number, number], count = 4) => Array.from({ length: count }).flatMap(() => rgba);

describe("dominantHue", () => {
  it("finds the OKLCH hue of a vivid color", () => {
    // Pure red, green and blue sit near 29, 142 and 264 degrees in OKLCH.
    expect(dominantHue(pixels([255, 0, 0, 255]))).toBeCloseTo(29, -1);
    expect(dominantHue(pixels([0, 255, 0, 255]))).toBeCloseTo(142, -1);
    expect(dominantHue(pixels([0, 0, 255, 255]))).toBeCloseTo(264, -1);
  });

  it("gives an orange logo an orange, not a rose", () => {
    const hue = dominantHue(pixels([249, 158, 26, 255]));
    expect(hue).toBeGreaterThan(55);
    expect(hue).toBeLessThan(85);
  });

  it("has no hue for a gray, a dark or a transparent picture", () => {
    expect(dominantHue(pixels([128, 128, 128, 255]))).toBeNull();
    expect(dominantHue(pixels([30, 10, 10, 255]))).toBeNull();
    expect(dominantHue(pixels([255, 0, 0, 0]))).toBeNull();
    expect(dominantHue([])).toBeNull();
  });

  it("lets the vivid color win over a muted one", () => {
    const hue = dominantHue([...pixels([0, 0, 255, 255], 2), ...pixels([200, 160, 160, 255], 2)]);
    expect(hue).toBeGreaterThan(255);
    expect(hue).toBeLessThan(275);
  });

  it("averages hues around the circle instead of across it", () => {
    // Two pinks on either side of the 0/360 seam stay pink: a plain average would land near 180 (cyan).
    const hue = dominantHue([...pixels([255, 0, 150, 255], 2), ...pixels([255, 0, 70, 255], 2)]);
    expect(Math.abs((hue ?? 180) - 180)).toBeGreaterThan(120);
  });
});
