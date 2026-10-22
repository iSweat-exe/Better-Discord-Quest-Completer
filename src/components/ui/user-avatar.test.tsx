import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Profile } from "@/types/domain";

import { UserAvatar } from "./user-avatar";

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "1",
  displayName: "✿ Cypr3s (E-Girls)",
  username: "isweatmc",
  avatar: "abc",
  ...overrides,
});

describe("UserAvatar", () => {
  it("shows the initial while the picture has not loaded, instead of an empty circle", () => {
    const { container } = render(<UserAvatar profile={profile()} size={72} />);

    expect(screen.getByText("C")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("loading", "eager");
  });

  it("gives way to the picture once it has loaded", () => {
    const { container } = render(<UserAvatar profile={profile()} size={72} />);

    fireEvent.load(container.querySelector("img")!);
    expect(screen.queryByText("C")).not.toBeInTheDocument();
  });

  it("keeps the initial when the picture cannot be loaded", () => {
    const { container } = render(<UserAvatar profile={profile()} size={72} />);

    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("shows the initial for an account that kept the default avatar", () => {
    const { container } = render(<UserAvatar profile={profile({ avatar: null, displayName: "nelly" })} size={72} />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("N")).toBeInTheDocument();
  });
});
