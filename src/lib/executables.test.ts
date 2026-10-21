import { describe, expect, it } from "vitest";

import type { Executable, Game } from "@/types/domain";

import { firstPlayable, groupExecutables, isPlayable, pathSegments } from "./executables";

const executable = (name: string, support: Executable["support"]): Executable => ({
  name,
  os: "win32",
  isLauncher: false,
  support,
});

const game = (executables: Executable[]): Game => ({
  id: "1",
  name: "Game",
  aliases: [],
  executables,
  iconHash: null,
  themes: [],
});

describe("pathSegments", () => {
  it("splits on both separators", () => {
    expect(pathSegments(String.raw`bin\win64/game.exe`)).toEqual(["bin", "win64", "game.exe"]);
  });

  it("ignores empty segments", () => {
    expect(pathSegments("/a//b.exe")).toEqual(["a", "b.exe"]);
  });
});

describe("groupExecutables", () => {
  const sample = game([
    executable("game.exe", "ok"),
    executable(">hl2.exe", "invalidPath"),
    executable("data.dat", "notExe"),
    executable("game", "otherPlatform"),
  ]);

  it("separates usable, unsupported and other-platform executables", () => {
    const groups = groupExecutables(sample);
    expect(groups.usable.map((item) => item.name)).toEqual(["game.exe"]);
    expect(groups.unsupported.map((item) => item.name)).toEqual([">hl2.exe", "data.dat"]);
    expect(groups.otherPlatformCount).toBe(1);
  });

  it("tells whether a game can be played", () => {
    expect(isPlayable(sample)).toBe(true);
    expect(isPlayable(game([executable("game", "otherPlatform")]))).toBe(false);
  });
});

describe("firstPlayable", () => {
  it("returns the first executable that can run here", () => {
    const sample = game([executable("mac", "otherPlatform"), executable("b.exe", "ok"), executable("c.exe", "ok")]);
    expect(firstPlayable(sample)?.name).toBe("b.exe");
  });

  it("returns nothing when none can", () => {
    expect(firstPlayable(game([executable("x", "notExe")]))).toBeUndefined();
  });
});
