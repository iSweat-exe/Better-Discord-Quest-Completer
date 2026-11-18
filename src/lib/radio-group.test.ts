import { describe, expect, it } from "vitest";

import { nextRadioIndex, radioTabIndex } from "./radio-group";

describe("nextRadioIndex", () => {
  it("moves to the next and previous option, wrapping around", () => {
    expect(nextRadioIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextRadioIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextRadioIndex("ArrowUp", 1, 3)).toBe(0);
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextRadioIndex("Home", 2, 3)).toBe(0);
    expect(nextRadioIndex("End", 0, 3)).toBe(2);
  });

  it("ignores other keys and empty groups", () => {
    expect(nextRadioIndex("Enter", 0, 3)).toBeNull();
    expect(nextRadioIndex("a", 0, 3)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("radioTabIndex", () => {
  it("puts only the selected option in the Tab order", () => {
    const values = ["a", "b", "c"];
    expect(values.map((value) => radioTabIndex(values, "b", value))).toEqual([-1, 0, -1]);
  });

  it("falls back to the first option when none is selected", () => {
    const values = ["a", "b"];
    expect(values.map((value) => radioTabIndex(values, "z", value))).toEqual([0, -1]);
  });
});
