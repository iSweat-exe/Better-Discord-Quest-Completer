import { describe, expect, it } from "vitest";

import { formatOrbsValue, ORBS_PER_OFFER, orbsToUsd, USD_PER_ORB } from "./orbs";

describe("orbs value", () => {
  it("prices 1,400 Orbs as 3 days of a $9.99 monthly Nitro", () => {
    expect(orbsToUsd(ORBS_PER_OFFER)).toBeCloseTo(0.999, 6);
    expect(USD_PER_ORB).toBeCloseTo(0.000_713_6, 7);
    expect(orbsToUsd(0)).toBe(0);
  });

  it("formats the estimate in dollars for the locale", () => {
    expect(formatOrbsValue(1400, "en-US")).toBe("≈ $1.00");
    expect(formatOrbsValue(700, "en-US")).toBe("≈ $0.50");
    expect(formatOrbsValue(14_000, "fr-FR")).toMatch(/^≈ 9,99\s\$US$/u);
  });
});
