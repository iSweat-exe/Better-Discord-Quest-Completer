import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NumberStepper } from "./field";

function setup(value = 15) {
  const onCommit = vi.fn();
  render(<NumberStepper label="Duration" unit="min" min={1} max={480} value={value} onCommit={onCommit} />);
  return { onCommit, input: screen.getByRole("textbox", { name: "Duration" }) };
}

describe("NumberStepper", () => {
  it("steps up and down", async () => {
    const { onCommit } = setup(15);
    await userEvent.click(screen.getByRole("button", { name: "Increase" }));
    await userEvent.click(screen.getByRole("button", { name: "Decrease" }));
    expect(onCommit).toHaveBeenNthCalledWith(1, 20);
    expect(onCommit).toHaveBeenNthCalledWith(2, 10);
  });

  it("disables the buttons at the bounds", () => {
    setup(1);
    expect(screen.getByRole("button", { name: "Decrease" })).toBeDisabled();
  });

  it("commits a typed value on Enter and clamps it", async () => {
    const { onCommit, input } = setup(15);
    await userEvent.clear(input);
    await userEvent.type(input, "999{Enter}");
    expect(onCommit).toHaveBeenCalledWith(480);
  });

  it("ignores non-digits and does not commit an unchanged value", async () => {
    const { onCommit, input } = setup(15);
    await userEvent.clear(input);
    await userEvent.type(input, "1a5{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue("15");
  });
});
