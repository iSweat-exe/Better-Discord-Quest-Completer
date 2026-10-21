import { create } from "zustand";

import type { Language } from "@/types/domain";

import { en } from "./en";
import { fr, type MessageKey } from "./fr";

export type Locale = "fr" | "en";
export type { MessageKey };

type PluralKey<K extends string> = K extends `${infer Base}_one` ? Base : never;
/** Keys that exist only in `_one` / `_other` form. */
export type PluralMessageKey = PluralKey<MessageKey>;
export type TranslationKey = MessageKey | PluralMessageKey;

export type Params = Record<string, string | number>;
export type Translate = (key: TranslationKey, params?: Params) => string;

const dictionaries: Record<Locale, Record<MessageKey, string>> = { fr, en };

/** Resolves the `auto` setting from the system language. */
export function resolveLocale(language: Language, systemLanguage: string): Locale {
  if (language !== "auto") return language;
  return systemLanguage.toLowerCase().startsWith("fr") ? "fr" : "en";
}

function lookup(locale: Locale, key: string, count: number | undefined): string {
  const dictionary: Record<string, string | undefined> = dictionaries[locale];

  if (count !== undefined) {
    const category = new Intl.PluralRules(locale).select(count) === "one" ? "one" : "other";
    const plural = dictionary[`${key}_${category}`];
    if (plural !== undefined) return plural;
  }
  return dictionary[key] ?? key;
}

export function translate(locale: Locale, key: TranslationKey, params?: Params): string {
  const count = typeof params?.count === "number" ? params.count : undefined;
  const template = lookup(locale, key, count);

  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params?.[name];
    return value === undefined ? placeholder : String(value);
  });
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: resolveLocale("auto", typeof navigator === "undefined" ? "en" : navigator.language),
  setLocale: (locale) => {
    set({ locale });
  },
}));
