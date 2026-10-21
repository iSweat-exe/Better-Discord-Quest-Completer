import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionStore } from "@/features/sessions/session-store";
import { useUiStore } from "@/features/shell/ui-store";
import type * as IpcModule from "@/lib/ipc";
import type { Catalog, Game, LibraryEntry, Quest, QuestsResponse, SessionInfo } from "@/types/domain";

const api = vi.hoisted(() => ({
  getQuestsConnection: vi.fn(),
  refreshQuests: vi.fn(),
  getOrbsBalance: vi.fn(),
  getCatalog: vi.fn(),
  getLibrary: vi.fn(),
  addToLibrary: vi.fn(),
  startSession: vi.fn(),
  disconnectQuests: vi.fn(),
}));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  ipc: api,
}));

import QuestsPage from "./quests-page";

const NOW = Date.now();
const DAY = 86_400_000;

const game = (id: string, name: string, playable = true): Game => ({
  id,
  name,
  aliases: [],
  iconHash: null,
  themes: [],
  executables: [{ name: `${name.toLowerCase()}.exe`, os: "win32", isLauncher: false, support: playable ? "ok" : "otherPlatform" }],
});

const OVERWATCH = game("356875221078245376", "Overwatch");
const CATALOG: Catalog = {
  games: [OVERWATCH, game("2", "Fortnite"), game("3", "Console Only", false)],
  source: "bundled",
  fetchedAt: null,
  refreshError: null,
  platform: "win32",
};

const quest = (overrides: Partial<Quest>): Quest => ({
  id: "q",
  name: "Quest",
  gameTitle: null,
  publisher: null,
  applicationId: null,
  reward: null,
  rewardOrbs: null,
  startsAt: null,
  expiresAt: NOW + 3 * DAY,
  tasks: [{ kind: "playOnDesktop", targetSeconds: 1800 }],
  status: "available",
  progressSeconds: null,
  completedAt: null,
  claimedAt: null,
  ...overrides,
});

const session = (gameId: string): SessionInfo => ({
  id: `${gameId}:overwatch.exe`,
  gameId,
  gameName: "Overwatch",
  executable: "overwatch.exe",
  path: "C:/games/overwatch.exe",
  pid: 1,
  startedAt: NOW,
  targetSeconds: 1800,
  detection: "off",
  detectedAt: null,
});

function respond(quests: Quest[], library: LibraryEntry[] = []) {
  const response: QuestsResponse = { quests, fetchedAt: NOW, rawJson: "{}" };
  api.getQuestsConnection.mockResolvedValue(true);
  api.refreshQuests.mockResolvedValue(response);
  api.getOrbsBalance.mockResolvedValue(1250);
  api.getCatalog.mockResolvedValue(CATALOG);
  api.getLibrary.mockResolvedValue(library);
  api.addToLibrary.mockResolvedValue([]);
  api.startSession.mockResolvedValue({});
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuestsPage />
    </QueryClientProvider>,
  );
}

describe("QuestsPage", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    useUiStore.setState({ searchOpen: false, searchSeed: "" });
    useSessionStore.setState({ sessions: [] });
  });

  it("shows the gate instead of any quest when no token is saved", async () => {
    api.getQuestsConnection.mockResolvedValue(false);
    renderPage();
    expect(await screen.findByText("Why is your token needed?")).toBeInTheDocument();
    expect(api.refreshQuests).not.toHaveBeenCalled();
  });

  it("lists quests with their game, reward and deadline", async () => {
    respond([
      quest({ id: "a", name: "Play Overwatch", applicationId: OVERWATCH.id, gameTitle: "Overwatch", reward: "Orb Effect" }),
    ]);
    renderPage();

    expect(await screen.findByText("Play Overwatch")).toBeInTheDocument();
    expect(screen.getByText("Reward: Orb Effect")).toBeInTheDocument();
    expect(screen.getByText(/Play on PC · 30 min/)).toBeInTheDocument();
    expect(screen.getByText(/Expires in 3 days/)).toBeInTheDocument();
  });

  it("adds the quest's game and launches it for the length the quest asks", async () => {
    respond([quest({ id: "a", name: "Play Overwatch", applicationId: OVERWATCH.id })]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Add and launch" }));

    await waitFor(() => {
      expect(api.addToLibrary).toHaveBeenCalledWith(OVERWATCH.id);
    });
    await waitFor(() => {
      expect(api.startSession).toHaveBeenCalledWith(OVERWATCH.id, "overwatch.exe", 30);
    });
  });

  it("only offers to launch a game that is already in the library", async () => {
    const entry: LibraryEntry = { game: OVERWATCH, addedAt: 0, lastPlayedAt: null, totalSeconds: 0 };
    respond([quest({ id: "a", name: "Play Overwatch", applicationId: OVERWATCH.id })], [entry]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Launch (30 min)" }));
    expect(api.addToLibrary).not.toHaveBeenCalled();
    expect(api.startSession).toHaveBeenCalledWith(OVERWATCH.id, "overwatch.exe", 30);
  });

  it("opens the search on the game's title when the game cannot be identified", async () => {
    respond([quest({ id: "a", name: "Mystery", gameTitle: "Zzzzzz Qqqqqq" })]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Search “Zzzzzz Qqqqqq”/ }));
    expect(useUiStore.getState()).toMatchObject({ searchOpen: true, searchSeed: "Zzzzzz Qqqqqq" });
  });

  it("does not offer a fake game for quests that are not played on a PC", async () => {
    respond([quest({ id: "v", name: "Watch the trailer", tasks: [{ kind: "watchVideo", targetSeconds: 30 }] })]);
    renderPage();

    const card = (await screen.findByText("Watch the trailer")).closest("li")!;
    expect(within(card).getByText(/completed in Discord/)).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("warns when the game has no Windows executable", async () => {
    respond([quest({ id: "c", name: "Console quest", applicationId: "3" })]);
    renderPage();
    expect(await screen.findByText("No Windows executable is registered for this game.")).toBeInTheDocument();
  });

  it("shows the Orbs balance, and nothing when Discord does not answer", async () => {
    respond([quest({ id: "a", name: "Open quest" })]);
    const { unmount } = renderPage();
    expect(await screen.findByText("1,250")).toBeInTheDocument();
    unmount();

    respond([quest({ id: "a", name: "Open quest" })]);
    api.getOrbsBalance.mockRejectedValue(new Error("nope"));
    renderPage();
    expect(await screen.findByText("Open quest")).toBeInTheDocument();
    expect(screen.queryByText(/Orbs balance/)).not.toBeInTheDocument();
  });

  it("tells how long Discord says a running quest still needs", async () => {
    const entry: LibraryEntry = { game: OVERWATCH, addedAt: 0, lastPlayedAt: null, totalSeconds: 0 };
    respond([quest({ id: "a", applicationId: OVERWATCH.id, status: "enrolled", progressSeconds: 600 })], [entry]);
    useSessionStore.setState({ sessions: [session(OVERWATCH.id)] });
    renderPage();

    expect(await screen.findByText("About 20 min left, according to Discord")).toBeInTheDocument();
  });

  it("waits for the first progress report of a game that just started", async () => {
    const entry: LibraryEntry = { game: OVERWATCH, addedAt: 0, lastPlayedAt: null, totalSeconds: 0 };
    respond([quest({ id: "a", applicationId: OVERWATCH.id, status: "enrolled" })], [entry]);
    useSessionStore.setState({ sessions: [session(OVERWATCH.id)] });
    renderPage();

    expect(await screen.findByText(/Waiting for Discord's first progress update/)).toBeInTheDocument();
  });

  it("keeps a reward history: when a quest was done, and what is left to claim", async () => {
    respond([
      quest({ id: "c", name: "Claimed one", status: "claimed", claimedAt: NOW - 2 * DAY, reward: "Orb Effect" }),
      quest({ id: "d", name: "Done one", status: "completed", completedAt: NOW - DAY, reward: "Badge" }),
    ]);
    renderPage();

    await userEvent.click(await screen.findByRole("radio", { name: "Finished or expired" }));
    expect(screen.getByText("Reward claimed 2 days ago")).toBeInTheDocument();
    expect(screen.getByText(/Completed yesterday/)).toBeInTheDocument();
    expect(screen.getByText(/reward to claim in Discord/)).toBeInTheDocument();
  });

  it("separates finished quests from the ones to do", async () => {
    respond([
      quest({ id: "todo", name: "Still open" }),
      quest({ id: "done", name: "Already done", status: "completed" }),
      quest({ id: "late", name: "Too late", expiresAt: NOW - DAY }),
    ]);
    renderPage();

    expect(await screen.findByText("Still open")).toBeInTheDocument();
    expect(screen.queryByText("Already done")).not.toBeInTheDocument();
    expect(screen.queryByText("Too late")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Finished or expired" }));
    expect(screen.getByText("Already done")).toBeInTheDocument();
    expect(screen.getByText("Too late")).toBeInTheDocument();
    expect(screen.queryByText("Still open")).not.toBeInTheDocument();
  });
});
