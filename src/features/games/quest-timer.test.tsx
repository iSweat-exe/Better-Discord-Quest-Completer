import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionInfo } from "@/types/domain";

import { QuestTimer } from "./quest-timer";

const session = (startedAgoSeconds: number, targetSeconds = 900): SessionInfo => ({
  id: "1:game.exe",
  gameId: "1",
  gameName: "Game",
  executable: "game.exe",
  path: "C:\\game.exe",
  pid: 1,
  startedAt: Date.now() - startedAgoSeconds * 1000,
  targetSeconds,
  detection: "off",
  detectedAt: null,
});

describe("QuestTimer", () => {
  it("shows the remaining time while the goal is not reached", () => {
    render(<QuestTimer session={session(60)} />);
    expect(screen.getByText(/left/)).toHaveTextContent("14:");
    expect(screen.getByText("Goal: 15 min")).toBeInTheDocument();
  });

  it("does not run while Discord has not noticed the game", () => {
    render(<QuestTimer session={{ ...session(300), detection: "waiting" }} />);

    expect(screen.getByText("Waiting for Discord")).toBeInTheDocument();
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
    // The clock is quantized to whole seconds, so allow one second of rounding.
    expect(screen.getByText(/Launched 0[45]:\d\d ago/)).toBeInTheDocument();
  });

  it("counts from the detection, not from the launch", () => {
    const detectedAgo = 60;
    render(
      <QuestTimer
        session={{ ...session(600), detection: "detected", detectedAt: Date.now() - detectedAgo * 1000 }}
      />,
    );

    // 14 minutes remain: only the last minute counts, not the ten since the launch.
    expect(screen.getByText(/left/)).toHaveTextContent("14:");
    expect(screen.getByText(/Detected by Discord at/)).toBeInTheDocument();
  });

  it("announces completion with text, not only color", () => {
    render(<QuestTimer session={session(901)} />);
    expect(screen.getByText("Timer complete")).toBeInTheDocument();
    expect(screen.getByText("Check your quest progress in Discord.")).toBeInTheDocument();
  });
});
