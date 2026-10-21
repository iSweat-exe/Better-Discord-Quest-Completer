import type { Executable, Game } from "@/types/domain";

/** Splits an executable name into its folders and file name. */
export function pathSegments(name: string): string[] {
  return name.split(/[\\/]/).filter(Boolean);
}

export interface ExecutableGroups {
  /** Can be launched on this platform. */
  usable: Executable[];
  /** Registered for this platform but unusable (unsupported name, not an .exe…). */
  unsupported: Executable[];
  /** Registered for another platform only; never shown. */
  otherPlatformCount: number;
}

export function groupExecutables(game: Game): ExecutableGroups {
  const groups: ExecutableGroups = { usable: [], unsupported: [], otherPlatformCount: 0 };

  for (const executable of game.executables) {
    switch (executable.support) {
      case "ok":
        groups.usable.push(executable);
        break;
      case "otherPlatform":
        groups.otherPlatformCount += 1;
        break;
      default:
        groups.unsupported.push(executable);
    }
  }
  return groups;
}

/** The executable launched by default: the first one that can run here. */
export function firstPlayable(game: Game): Executable | undefined {
  return game.executables.find((executable) => executable.support === "ok");
}

/** Whether the game can be simulated at all on this platform. */
export function isPlayable(game: Game): boolean {
  return game.executables.some((executable) => executable.support === "ok");
}
