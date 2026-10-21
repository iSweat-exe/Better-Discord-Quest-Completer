import { describe, expect, it } from "vitest";

import { errorMessage } from "./errors";
import { translate } from "./i18n";
import { IpcError } from "./ipc";

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("en", key, params);

describe("errorMessage", () => {
  it("localizes known backend errors by kind", () => {
    expect(errorMessage(new IpcError("alreadyRunning", "x"), t)).toBe("This game is already running.");
  });

  it("includes the backend detail when the message asks for it", () => {
    expect(errorMessage(new IpcError("network", "timed out"), t)).toBe("Network error: timed out");
  });

  it("falls back to a generic message for anything else", () => {
    expect(errorMessage(new Error("boom"), t)).toBe("An unexpected error occurred: boom");
    expect(errorMessage("plain string", t)).toBe("An unexpected error occurred: plain string");
    expect(errorMessage(new IpcError("unknown", "odd"), t)).toBe("An unexpected error occurred: odd");
  });
});
