/**
 * What Orbs are worth in dollars, from what Discord sells for them: 1,400 Orbs
 * buy 3 days of Nitro, and a month of Nitro costs $9.99. An estimate to compare
 * rewards and prices, not a price Discord would pay.
 */
export const ORBS_PER_OFFER = 1400;
export const OFFER_DAYS = 3;
export const NITRO_MONTHLY_USD = 9.99;
const DAYS_PER_MONTH = 30;

/** Dollars one Orb is worth (about $0.000714). */
export const USD_PER_ORB = (NITRO_MONTHLY_USD * (OFFER_DAYS / DAYS_PER_MONTH)) / ORBS_PER_OFFER;

export function orbsToUsd(orbs: number): number {
  return orbs * USD_PER_ORB;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** "≈ $1.00" in English, "≈ 1,00 $US" in French. */
export function formatOrbsValue(orbs: number, locale?: string): string {
  const key = locale ?? "";
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(key, formatter);
  }
  return `≈ ${formatter.format(orbsToUsd(orbs))}`;
}
