import { describe, expect, it } from "vitest";

import { modifierLabel, pageForDigit, pageForKeys, shortcutDigit, SHORTCUT_PAGES } from "./shortcuts";

describe("page shortcuts", () => {
  it("number the pages in the order of the sidebar, Settings last", () => {
    expect(pageForDigit("1")).toBe("games");
    expect(pageForDigit("3")).toBe("shop");
    expect(pageForDigit("6")).toBe("settings");
  });

  it("give every page one distinct digit", () => {
    const digits = SHORTCUT_PAGES.map((page) => shortcutDigit(page));
    expect(new Set(digits).size).toBe(SHORTCUT_PAGES.length);
    expect(digits).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("open nothing for a key that is not a page digit", () => {
    expect(pageForDigit("0")).toBeNull();
    expect(pageForDigit("7")).toBeNull();
    expect(pageForDigit("k")).toBeNull();
  });

  it("leave the profile out: it is reached from the sidebar's account", () => {
    expect(shortcutDigit("profile")).toBeNull();
  });

  it("name the command key after the system", () => {
    expect(modifierLabel("MacIntel")).toBe("⌘");
    expect(modifierLabel("Win32")).toBe("Ctrl");
  });

  it("follow the physical key, so an AZERTY keyboard works too", () => {
    // AZERTY: the key marked 1 types "&", the one marked 3 types '"'.
    expect(pageForKeys({ code: "Digit1", key: "&" })).toBe("games");
    expect(pageForKeys({ code: "Digit3", key: '"' })).toBe("shop");
    expect(pageForKeys({ code: "Digit6", key: "-" })).toBe("settings");
  });

  it("accept the numeric keypad and fall back on the character", () => {
    expect(pageForKeys({ code: "Numpad2", key: "2" })).toBe("quests");
    expect(pageForKeys({ key: "4" })).toBe("presence");
  });

  it("ignore other keys", () => {
    expect(pageForKeys({ code: "KeyK", key: "k" })).toBeNull();
    expect(pageForKeys({ code: "Digit0", key: "à" })).toBeNull();
  });
});
