import { describe, expect, it } from "vitest";

import { formatBytes, formatClock, formatDuration, formatRelativeTime } from "./format";

describe("formatClock", () => {
  it("pads minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
  });

  it("adds hours only when needed", () => {
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3 * 3600 + 7 * 60 + 9)).toBe("3:07:09");
  });

  it("clamps negative and fractional values", () => {
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(59.9)).toBe("00:59");
  });
});

describe("formatBytes", () => {
  it("scales to the largest fitting unit", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024, "en")).toBe("5 MB");
  });

  it("drops decimals for large values", () => {
    expect(formatBytes(150 * 1024, "en")).toBe("150 KB");
  });

  it("uses the locale's decimal separator", () => {
    expect(formatBytes(1536, "fr")).toBe("1,5 KB");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);

  it("picks the largest unit", () => {
    expect(formatRelativeTime(now - 3 * 3600_000, now, "en")).toBe("3 hours ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now, "en")).toBe("2 days ago");
    expect(formatRelativeTime(now - 5 * 60_000, now, "en")).toBe("5 minutes ago");
  });

  it("says « now » for very recent timestamps", () => {
    expect(formatRelativeTime(now - 10_000, now, "en")).toBe("this minute");
  });
});

describe("formatDuration", () => {
  it("speaks in the largest sensible units", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(90)).toBe("1 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3600 + 20 * 60 + 59)).toBe("1 h 20 min");
  });

  it("clamps negative values", () => {
    expect(formatDuration(-10)).toBe("0 s");
  });
});
