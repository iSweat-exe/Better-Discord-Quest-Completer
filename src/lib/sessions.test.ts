import { describe, expect, it } from "vitest";

import type { SessionInfo } from "@/types/domain";

import { timerElapsedSeconds, timerStartedAt } from "./sessions";

const session = (overrides: Partial<SessionInfo>): SessionInfo => ({
  id: "1:g.exe",
  gameId: "1",
  gameName: "Game",
  executable: "g.exe",
  path: "C:\\g.exe",
  pid: 1,
  startedAt: 1_000_000,
  targetSeconds: 900,
  detection: "off",
  detectedAt: null,
  ...overrides,
});

describe("timerStartedAt", () => {
  it("has not started while waiting for Discord", () => {
    expect(timerStartedAt(session({ detection: "waiting" }))).toBeNull();
  });

  it("starts at the detection once Discord noticed the game", () => {
    expect(timerStartedAt(session({ detection: "detected", detectedAt: 1_030_000 }))).toBe(1_030_000);
  });

  it("starts at the launch when waiting is off or detection cannot be verified", () => {
    expect(timerStartedAt(session({ detection: "off" }))).toBe(1_000_000);
    expect(timerStartedAt(session({ detection: "unverifiable" }))).toBe(1_000_000);
  });

  it("keeps working with a backend that does not report detection", () => {
    const legacy = session({}) as Partial<SessionInfo>;
    delete legacy.detection;
    expect(timerStartedAt(legacy as SessionInfo)).toBe(1_000_000);
  });
});

describe("timerElapsedSeconds", () => {
  it("counts from the timer start, not from the launch", () => {
    const detected = session({ detection: "detected", detectedAt: 1_030_000 });
    expect(timerElapsedSeconds(detected, 1_090_000)).toBe(60);
  });

  it("is null while waiting and never negative", () => {
    expect(timerElapsedSeconds(session({ detection: "waiting" }), 2_000_000)).toBeNull();
    expect(timerElapsedSeconds(session({}), 500_000)).toBe(0);
  });
});
