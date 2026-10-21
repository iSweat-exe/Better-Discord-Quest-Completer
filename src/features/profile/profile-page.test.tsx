import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "@/features/shell/ui-store";
import type * as IpcModule from "@/lib/ipc";
import type { AppStats, LibraryEntry, Profile, Quest, QuestsResponse } from "@/types/domain";

const api = vi.hoisted(() => ({
  getQuestsConnection: vi.fn(),
  getProfile: vi.fn(),
  refreshQuests: vi.fn(),
  getOrbsBalance: vi.fn(),
  getAppStats: vi.fn(),
  getLibrary: vi.fn(),
}));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  ipc: api,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import ProfilePage from "./profile-page";

const NOW = Date.now();
const DAY = 86_400_000;

const PROFILE: Profile = { id: "1", displayName: "Nelly", username: "nelly", avatar: null };

const quest = (overrides: Partial<Quest>): Quest => ({
  id: "q",
  name: "Quest",
  gameTitle: null,
  publisher: null,
  applicationId: null,
  reward: null,
  rewardOrbs: null,
  startsAt: null,
  expiresAt: NOW + DAY,
  tasks: [],
  status: "available",
  progressSeconds: null,
  completedAt: null,
  claimedAt: null,
  ...overrides,
});

const QUESTS: Quest[] = [
  quest({ id: "1", status: "claimed", rewardOrbs: 700 }),
  quest({ id: "2", status: "claimed", rewardOrbs: 500 }),
  quest({ id: "3", status: "completed", rewardOrbs: 200 }),
  quest({ id: "4", status: "enrolled" }),
  quest({ id: "5", expiresAt: NOW - DAY }),
];

function setup(options: { connected?: boolean; stats?: AppStats; library?: LibraryEntry[] } = {}) {
  const response: QuestsResponse = { quests: QUESTS, fetchedAt: NOW, rawJson: "{}" };
  api.getQuestsConnection.mockResolvedValue(options.connected ?? true);
  api.getProfile.mockResolvedValue(PROFILE);
  api.refreshQuests.mockResolvedValue(response);
  api.getOrbsBalance.mockResolvedValue(1250);
  api.getAppStats.mockResolvedValue(options.stats ?? { questsCompleted: 0, orbsEarned: 0, recent: [] });
  api.getLibrary.mockResolvedValue(options.library ?? []);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

/** The value shown in the tile that carries `label`. */
const valueOf = (label: string) => {
  const tile = screen.getByText(label).closest("div");
  if (!tile) throw new Error(`no tile for ${label}`);
  return within(tile).getByText(/^[\d–][\d\s,.hmin–]*$/).textContent;
};

describe("ProfilePage", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    useUiStore.setState({ page: "profile" });
  });

  it("shows who the account is", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Nelly" })).toBeInTheDocument();
    expect(screen.getByText("@nelly")).toBeInTheDocument();
  });

  it("shows the Orbs balance and the Orbs earned from the claimed rewards", async () => {
    setup();
    await screen.findByRole("heading", { name: "Nelly" });

    await vi.waitFor(() => {
      expect(valueOf("Current balance")).toBe("1,250");
      expect(valueOf("Orbs earned")).toBe("1,200");
    });
    expect(screen.getByText("+200 still to claim in Discord")).toBeInTheDocument();
  });

  it("counts the quests by outcome", async () => {
    setup();
    await vi.waitFor(() => {
      expect(valueOf("Completed")).toBe("3");
    });
    expect(valueOf("Expired")).toBe("1");
    expect(valueOf("In progress")).toBe("1");
    expect(valueOf("Rewards to claim")).toBe("1");
  });

  it("shows what the app itself completed, newest first", async () => {
    setup({
      stats: {
        questsCompleted: 2,
        orbsEarned: 900,
        recent: [{ questId: "1", name: "Play Overwatch", orbs: 700, completedAt: NOW - DAY }],
      },
    });

    expect(await screen.findByText("Play Overwatch")).toBeInTheDocument();
    expect(screen.getByText("+700 Orbs")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(valueOf("Earned with the app")).toBe("900");
    });
  });

  it("explains when nothing was completed with the app yet", async () => {
    setup();
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });

  it("sends the user to the quests page when no account is connected", async () => {
    setup({ connected: false });

    await userEvent.click(await screen.findByRole("button", { name: "Go to quests" }));
    expect(useUiStore.getState().page).toBe("quests");
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  it("credits its author", async () => {
    setup();
    expect(await screen.findByRole("button", { name: "@iSweat-exe" })).toBeInTheDocument();
  });
});
