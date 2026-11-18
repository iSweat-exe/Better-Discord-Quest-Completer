import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "@/features/shell/ui-store";
import type * as IpcModule from "@/lib/ipc";

import { useOnboardingStore } from "./onboarding-store";
import { placeCard } from "./position";
import { checklist, isChecklistComplete, TOUR_STEPS } from "./steps";
import { TourOverlay } from "./tour";
import { WelcomeDialog } from "./welcome-dialog";

const api = vi.hoisted(() => ({ getLibrary: vi.fn() }));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  ipc: api,
}));

const VIEWPORT = { width: 1100, height: 720 };
const CARD = { width: 320, height: 180 };

function resetOnboarding() {
  useOnboardingStore.setState({
    welcomed: false,
    tourStep: null,
    checklistHidden: false,
    checklistCelebrated: false,
    launchedOnce: false,
    detectedOnce: false,
    tipsSeen: [],
  });
}

function renderWithQueries(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("checklist", () => {
  it("starts with one step done, so it never shows zero progress", () => {
    const items = checklist({ libraryCount: 0, launched: false, detected: false, connected: false });
    expect(items.filter((item) => item.done).map((item) => item.id)).toEqual(["install"]);
    expect(isChecklistComplete(items)).toBe(false);
  });

  it("is complete once Discord saw a game, the quests being optional", () => {
    const items = checklist({ libraryCount: 1, launched: true, detected: true, connected: false });
    expect(isChecklistComplete(items)).toBe(true);
    expect(items.find((item) => item.id === "quests")?.optional).toBe(true);
  });
});

describe("placeCard", () => {
  it("puts the card below its target when there is room", () => {
    const target = { top: 20, left: 400, width: 300, height: 44 };
    expect(placeCard(target, CARD, VIEWPORT)).toEqual({ top: 76, left: 390 });
  });

  it("puts it beside a sidebar entry", () => {
    const target = { top: 300, left: 12, width: 200, height: 40 };
    expect(placeCard(target, CARD, VIEWPORT).left).toBe(224);
  });

  it("keeps it inside the viewport, and centers it without a target", () => {
    const low = { top: 650, left: 1000, width: 80, height: 40 };
    const placed = placeCard(low, CARD, VIEWPORT);
    expect(placed.top + CARD.height).toBeLessThanOrEqual(VIEWPORT.height);
    expect(placed.left + CARD.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(placeCard(null, CARD, VIEWPORT)).toEqual({ top: 270, left: 390 });
  });
});

describe("TourOverlay", () => {
  beforeEach(() => {
    resetOnboarding();
    useUiStore.setState({ page: "settings", searchOpen: false });
  });

  it("is a short tour: four steps at most", () => {
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(4);
  });

  it("walks through the steps with the buttons and the arrow keys, showing the progress", async () => {
    useOnboardingStore.getState().startTour();
    render(<TourOverlay />);

    expect(screen.getByRole("dialog", { name: "Search for your quest's game" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(useUiStore.getState().page).toBe("games");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
  });

  it("can be left at any step with Escape or the skip button", async () => {
    useOnboardingStore.getState().startTour();
    render(<TourOverlay />);

    await userEvent.keyboard("{Escape}");
    expect(useOnboardingStore.getState().tourStep).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    useOnboardingStore.getState().startTour();
    await userEvent.click(await screen.findByRole("button", { name: "Skip the tour" }));
    expect(useOnboardingStore.getState().tourStep).toBeNull();
  });

  it("ends on the first real action: searching a game", async () => {
    useOnboardingStore.setState({ tourStep: TOUR_STEPS.length - 1 });
    render(<TourOverlay />);

    await userEvent.click(screen.getByRole("button", { name: "Find my first game" }));
    expect(useOnboardingStore.getState().tourStep).toBeNull();
    expect(useUiStore.getState()).toMatchObject({ page: "games", searchOpen: true });
  });
});

describe("WelcomeDialog", () => {
  beforeEach(() => {
    resetOnboarding();
    api.getLibrary.mockReset();
  });

  it("welcomes a new user and offers the tour without imposing it", async () => {
    api.getLibrary.mockResolvedValue([]);
    renderWithQueries(<WelcomeDialog />);

    expect(await screen.findByRole("dialog", { name: "Welcome to Discord Quest Completer" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I'll explore myself" }));
    expect(useOnboardingStore.getState()).toMatchObject({ welcomed: true, tourStep: null });
  });

  it("starts the tour when asked", async () => {
    api.getLibrary.mockResolvedValue([]);
    renderWithQueries(<WelcomeDialog />);

    await userEvent.click(await screen.findByRole("button", { name: "Take the tour (4 steps)" }));
    expect(useOnboardingStore.getState().tourStep).toBe(0);
  });

  it("never shows to someone who already uses the app", async () => {
    api.getLibrary.mockResolvedValue([{ game: { id: "1" }, addedAt: 0, lastPlayedAt: null, totalSeconds: 0 }]);
    renderWithQueries(<WelcomeDialog />);

    await vi.waitFor(() => {
      expect(useOnboardingStore.getState().welcomed).toBe(true);
    });
    expect(useOnboardingStore.getState().checklistHidden).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
