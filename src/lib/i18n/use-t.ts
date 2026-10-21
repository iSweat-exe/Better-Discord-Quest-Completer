import { useMemo } from "react";

import { translate, useLocaleStore, type Locale, type Translate } from "./index";

/** Translation function bound to the active language, plus the language itself. */
export function useT(): { t: Translate; locale: Locale } {
  const locale = useLocaleStore((state) => state.locale);

  return useMemo(
    () => ({ locale, t: (key, params) => translate(locale, key, params) }),
    [locale],
  );
}
