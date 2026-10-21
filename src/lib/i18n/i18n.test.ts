import { describe, expect, it } from "vitest";

import { en } from "./en";
import { fr } from "./fr";
import { resolveLocale, translate } from "./index";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("dictionaries", () => {
  it("define exactly the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(fr[key]));
    }
  });

  it("provide both plural forms for every plural message", () => {
    const keys = new Set(Object.keys(fr));
    for (const key of keys) {
      if (key.endsWith("_one")) expect(keys.has(key.replace(/_one$/, "_other")), key).toBe(true);
    }
  });
});

describe("translate", () => {
  it("interpolates parameters", () => {
    expect(translate("en", "games.addedToast", { name: "Overwatch" })).toBe("Overwatch added to your library");
    expect(translate("fr", "games.addedToast", { name: "Overwatch" })).toBe("Overwatch ajouté à la bibliothèque");
  });

  it("selects the plural form from `count`", () => {
    expect(translate("en", "nav.running", { count: 1 })).toBe("1 game running");
    expect(translate("en", "nav.running", { count: 3 })).toBe("3 games running");
    expect(translate("fr", "nav.running", { count: 2 })).toBe("2 jeux en cours");
  });

  it("treats zero as singular in French and plural in English", () => {
    expect(translate("fr", "nav.running", { count: 0 })).toBe("0 jeu en cours");
    expect(translate("en", "nav.running", { count: 0 })).toBe("0 games running");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(translate("en", "games.started", {})).toBe("{name} is running");
  });
});

describe("resolveLocale", () => {
  it("honors an explicit language", () => {
    expect(resolveLocale("fr", "en-US")).toBe("fr");
    expect(resolveLocale("en", "fr-FR")).toBe("en");
  });

  it("follows the system language when set to auto", () => {
    expect(resolveLocale("auto", "fr-CA")).toBe("fr");
    expect(resolveLocale("auto", "de-DE")).toBe("en");
  });
});
