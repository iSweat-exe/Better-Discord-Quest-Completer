import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as IpcModule from "@/lib/ipc";
import type { UpdateInfo } from "@/types/domain";

const api = vi.hoisted(() => ({ checkForUpdate: vi.fn(), installUpdate: vi.fn() }));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  ipc: api,
}));

import { UpdateCard } from "./update-card";
import { UpdateDialog } from "./update-dialog";
import { downloadPercent, useUpdateStore } from "./update-store";

const INFO: UpdateInfo = {
  version: "2.1.0",
  currentVersion: "2.0.0",
  notes: "- Faster pages",
  publishedAt: null,
};

function renderUpdate() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UpdateCard />
      <UpdateDialog />
    </QueryClientProvider>,
  );
}

describe("update", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    useUpdateStore.setState({ info: null, phase: "idle", progress: null, dialogOpen: false });
  });

  it("shows nothing while the app is up to date", () => {
    renderUpdate();
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  });

  it("offers the update in the sidebar and opens the release notes", async () => {
    useUpdateStore.setState({ info: INFO });
    renderUpdate();

    expect(screen.getByText("Version 2.1.0 available")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(await screen.findByText("- Faster pages")).toBeInTheDocument();
    expect(screen.getByText("2.0.0 → 2.1.0")).toBeInTheDocument();
  });

  it("installs only when the user confirms", async () => {
    api.installUpdate.mockResolvedValue(undefined);
    useUpdateStore.setState({ info: INFO, dialogOpen: true });
    renderUpdate();
    expect(api.installUpdate).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(api.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("can be postponed", async () => {
    useUpdateStore.setState({ info: INFO, dialogOpen: true });
    renderUpdate();

    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
    expect(api.installUpdate).not.toHaveBeenCalled();
  });

  it("shows the download as a progress bar in the sidebar", () => {
    useUpdateStore.setState({ info: INFO, phase: "downloading", progress: { downloaded: 25, total: 100 } });
    renderUpdate();

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Downloading… 25 %")).toBeInTheDocument();
  });

  it("goes back to idle when the installation fails", async () => {
    api.installUpdate.mockRejectedValue(new Error("offline"));
    useUpdateStore.setState({ info: INFO, dialogOpen: true });
    renderUpdate();

    await userEvent.click(await screen.findByRole("button", { name: "Update now" }));
    await vi.waitFor(() => {
      expect(useUpdateStore.getState().phase).toBe("idle");
    });
  });
});

describe("downloadPercent", () => {
  it("is a whole percentage, capped at 100", () => {
    expect(downloadPercent({ downloaded: 1, total: 3 })).toBe(33);
    expect(downloadPercent({ downloaded: 9, total: 3 })).toBe(100);
  });

  it("is unknown without a size", () => {
    expect(downloadPercent({ downloaded: 5, total: null })).toBeNull();
    expect(downloadPercent(null)).toBeNull();
  });
});
