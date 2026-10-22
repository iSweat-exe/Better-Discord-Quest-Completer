import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GameIcon } from "./game-icon";

describe("GameIcon", () => {
  it("shows the monogram while the icon has not loaded, instead of an empty tile", () => {
    render(<GameIcon gameId="1" name="Overwatch" iconHash="abc" />);
    expect(screen.getByText("OV")).toBeInTheDocument();
  });

  it("gives way to the icon once it has loaded", () => {
    const { container } = render(<GameIcon gameId="1" name="Overwatch" iconHash="abc" />);

    fireEvent.load(container.querySelector("img")!);
    expect(screen.queryByText("OV")).not.toBeInTheDocument();
  });

  it("keeps the monogram when the icon cannot be loaded or does not exist", () => {
    const { container, rerender } = render(<GameIcon gameId="1" name="Overwatch" iconHash="abc" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("OV")).toBeInTheDocument();

    rerender(<GameIcon gameId="2" name="Minecraft" iconHash={null} />);
    expect(screen.getByText("MI")).toBeInTheDocument();
  });
});
