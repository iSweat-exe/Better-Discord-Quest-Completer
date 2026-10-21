import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as IpcModule from "@/lib/ipc";
import type { QuestsResponse } from "@/types/domain";

const connectQuests = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  ipc: { connectQuests },
}));

import { TokenGate } from "./token-gate";

const RESPONSE: QuestsResponse = { quests: [], fetchedAt: 0, rawJson: "{}" };
const TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccccc";

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TokenGate />
    </QueryClientProvider>,
  );
  return { client };
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Enter my token…" }));
  return {
    input: await screen.findByLabelText("Discord token"),
    submit: screen.getByRole("button", { name: "Unlock" }),
    acknowledge: screen.getByRole("checkbox"),
  };
}

describe("TokenGate", () => {
  beforeEach(() => {
    connectQuests.mockReset();
  });

  it("explains why the token is needed and what the risks are before asking for it", () => {
    setup();
    expect(screen.getByText("Why is your token needed?")).toBeInTheDocument();
    expect(screen.getByText("What it never does")).toBeInTheDocument();
    expect(screen.getByText("Risks you should know about")).toBeInTheDocument();
  });

  it("keeps the submit button disabled until a token is typed AND the risks are acknowledged", async () => {
    setup();
    const { input, submit, acknowledge } = await openDialog();
    expect(submit).toBeDisabled();

    await userEvent.type(input, TOKEN);
    expect(submit).toBeDisabled();

    await userEvent.click(acknowledge);
    expect(submit).toBeEnabled();
  });

  it("explains step by step how to find the token, and warns against the classic scam", async () => {
    setup();
    await openDialog();

    expect(screen.getByText("How do I find my token?")).toBeInTheDocument();
    expect(screen.getByText(/Open discord\.com\/app in your browser/)).toBeInTheDocument();
    expect(screen.getByText(/“authorization” line/)).toBeInTheDocument();
    expect(screen.getByText(/Never paste code into the browser console/)).toBeInTheDocument();
    expect(screen.getByText(/change your Discord password/)).toBeInTheDocument();
  });

  it("masks the token by default", async () => {
    setup();
    const { input } = await openDialog();
    expect(input).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show token" }));
    expect(input).toHaveAttribute("type", "text");
  });

  it("sends the token once and leaves nothing of it behind", async () => {
    connectQuests.mockResolvedValue(RESPONSE);
    const { client } = setup();
    const { input, submit, acknowledge } = await openDialog();

    await userEvent.type(input, `  ${TOKEN}  `);
    await userEvent.click(acknowledge);
    await userEvent.click(submit);

    await waitFor(() => {
      expect(connectQuests).toHaveBeenCalledTimes(1);
    });
    expect(connectQuests.mock.calls[0]).toEqual([`  ${TOKEN}  `]);

    // The dialog closes and the mutation, which held the token, is reset.
    await waitFor(() => {
      expect(screen.queryByLabelText("Discord token")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(client.getMutationCache().getAll()).toHaveLength(0);
    });
  });

  it("clears the field when the dialog is cancelled and reopened", async () => {
    setup();
    const first = await openDialog();
    await userEvent.type(first.input, TOKEN);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByLabelText("Discord token")).not.toBeInTheDocument();
    });

    const second = await openDialog();
    expect(second.input).toHaveValue("");
    expect(second.acknowledge).not.toBeChecked();
  });
});
