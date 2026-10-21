import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as IpcModule from "@/lib/ipc";
import { useUiStore } from "./ui-store";
import type { Profile } from "@/types/domain";

const api = vi.hoisted(() => ({
  getQuestsConnection: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  ipc: api,
}));

import { SidebarProfile } from "./sidebar-profile";

const PROFILE: Profile = { id: "80351110224678912", displayName: "Nelly", username: "nelly", avatar: "abc123" };

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SidebarProfile />
    </QueryClientProvider>,
  );
}

describe("SidebarProfile", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it("shows the picture, the display name and the @username", async () => {
    api.getQuestsConnection.mockResolvedValue(true);
    api.getProfile.mockResolvedValue(PROFILE);
    renderProfile();

    expect(await screen.findByText("Nelly")).toBeInTheDocument();
    expect(screen.getByText("@nelly")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.discordapp.com/avatars/80351110224678912/abc123.png?size=128",
    );
  });

  it("falls back to the first letter when the account has no picture", async () => {
    api.getQuestsConnection.mockResolvedValue(true);
    api.getProfile.mockResolvedValue({ ...PROFILE, avatar: null });
    renderProfile();

    expect(await screen.findByText("N")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens the profile page when clicked", async () => {
    api.getQuestsConnection.mockResolvedValue(true);
    api.getProfile.mockResolvedValue(PROFILE);
    useUiStore.setState({ page: "games" });
    renderProfile();

    await userEvent.click(await screen.findByRole("button", { name: "Open my profile" }));
    expect(useUiStore.getState().page).toBe("profile");
  });

  it("asks for nothing and shows nothing without a token", async () => {
    api.getQuestsConnection.mockResolvedValue(false);
    renderProfile();

    await vi.waitFor(() => {
      expect(api.getQuestsConnection).toHaveBeenCalled();
    });
    expect(api.getProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows nothing when Discord does not answer", async () => {
    api.getQuestsConnection.mockResolvedValue(true);
    api.getProfile.mockRejectedValue(new Error("offline"));
    renderProfile();

    await vi.waitFor(() => {
      expect(api.getProfile).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
