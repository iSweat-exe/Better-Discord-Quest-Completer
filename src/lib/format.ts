/**
 * Builds an `Intl` formatter once per locale. Constructing one is surprisingly
 * costly, and lists (500 log lines, a quest card per second) format a lot.
 */
function perLocale<T>(create: (locale: string | undefined) => T): (locale?: string) => T {
  const cache = new Map<string, T>();
  return (locale) => {
    const key = locale ?? "";
    let formatter = cache.get(key);
    if (formatter === undefined) {
      formatter = create(locale);
      cache.set(key, formatter);
    }
    return formatter;
  };
}

/** `mm:ss`, or `h:mm:ss` once an hour has elapsed. Negative values clamp to zero. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/** `1 h 20 min`, `45 min` or `30 s`: a duration a person would say aloud. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds.toString()} s`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes.toString()} min`;
  return minutes === 0 ? `${hours.toString()} h` : `${hours.toString()} h ${minutes.toString()} min`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Human readable size (`1.5 MB`), using the given locale's decimal separator. */
export function formatBytes(bytes: number, locale?: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
  return `${formatted} ${BYTE_UNITS[unit]}`;
}

const relativeFormatter = perLocale((locale) => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }));
const clockFormatter = perLocale(
  (locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
);

const numberFormatter = perLocale((locale) => new Intl.NumberFormat(locale));

/** `1,250` / `1 250`, with the locale's grouping. */
export function formatNumber(value: number, locale?: string): string {
  return numberFormatter(locale).format(value);
}

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** « il y a 3 heures » / « 3 hours ago », rounded to the largest fitting unit. */
export function formatRelativeTime(timestamp: number, now: number, locale?: string): string {
  const formatter = relativeFormatter(locale);
  const elapsedSeconds = Math.round((timestamp - now) / 1000);

  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(elapsedSeconds) >= size) {
      return formatter.format(Math.trunc(elapsedSeconds / size), unit);
    }
  }
  return formatter.format(0, "minute");
}

export function formatTime(timestamp: number, locale?: string): string {
  return clockFormatter(locale).format(timestamp);
}
