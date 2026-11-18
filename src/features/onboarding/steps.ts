import type { Page } from "@/features/shell/ui-store";
import type { MessageKey } from "@/lib/i18n";

/** A stop of the guided tour: the element it highlights, on which page, and what it says. */
export interface TourStep {
  id: string;
  /** Value of the `data-tour` attribute of the highlighted element. */
  target: string;
  page: Page;
  title: MessageKey;
  body: MessageKey;
}

/**
 * The guided tour: four stops at most, since completion drops sharply past that.
 * It shows where things are and ends on the first real action (searching a game),
 * rather than explaining everything up front.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: "search", target: "search", page: "games", title: "tour.search.title", body: "tour.search.body" },
  { id: "discord", target: "discord", page: "games", title: "tour.discord.title", body: "tour.discord.body" },
  { id: "quests", target: "nav-quests", page: "games", title: "tour.quests.title", body: "tour.quests.body" },
  { id: "help", target: "nav-diagnostic", page: "games", title: "tour.help.title", body: "tour.help.body" },
];

/** What the checklist knows about the user. */
export interface Progress {
  libraryCount: number;
  launched: boolean;
  detected: boolean;
  connected: boolean;
}

export type ChecklistItemId = "install" | "add" | "launch" | "detect" | "quests";

export interface ChecklistItem {
  id: ChecklistItemId;
  label: MessageKey;
  done: boolean;
  /** Not needed to complete the list. */
  optional: boolean;
}

/**
 * The first steps, up to the moment the app proves itself: Discord showing the
 * game. The first item is already done, so the list never starts at zero.
 */
export function checklist(progress: Progress): ChecklistItem[] {
  return [
    { id: "install", label: "start.install", done: true, optional: false },
    { id: "add", label: "start.add", done: progress.libraryCount > 0, optional: false },
    { id: "launch", label: "start.launch", done: progress.launched, optional: false },
    { id: "detect", label: "start.detect", done: progress.detected, optional: false },
    { id: "quests", label: "start.quests", done: progress.connected, optional: true },
  ];
}

/** Whether every required step is done. */
export function isChecklistComplete(items: readonly ChecklistItem[]): boolean {
  return items.every((item) => item.optional || item.done);
}
