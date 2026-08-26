/**
 * Formatting helpers shared by the server-rendered pages.
 *
 * Everything here is deterministic and locale-independent on purpose: the
 * pages are rendered on the server and cached, so a value that formatted
 * differently per request would produce hydration mismatches.
 */

export function formatNumber(value: number): string {
  return value.toLocaleString("en-GB");
}

/** "3d 04h", "4h 12m", "6m" - compact enough for a stat tile. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

/** "4 days played" style, for a character's time in the world. */
export function formatPlayed(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "no time played";
  const days = seconds / 86_400;
  if (days >= 1) return `${days.toFixed(1)} days played`;
  const hours = seconds / 3_600;
  if (hours >= 1) return `${hours.toFixed(1)} hours played`;
  return `${Math.round(seconds / 60)} minutes played`;
}

/** Largest unit first; the first one the gap clears wins. */
const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/** "3 hours ago". `now` is injectable so the output can be tested. */
export function formatRelative(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "never";
  const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(deltaSeconds);
  if (magnitude < 45) return "just now";

  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (magnitude >= seconds) return formatter.format(Math.round(deltaSeconds / seconds), unit);
  }
  return "just now";
}

/** Stable UTC timestamp for datetime attributes and patch-note dates. */
export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Copper -> "12g 30s 04c", the way the game shows money. */
export function formatMoney(copper: number): string {
  const gold = Math.floor(copper / 10_000);
  const silver = Math.floor((copper % 10_000) / 100);
  const rest = copper % 100;
  return `${formatNumber(gold)}g ${String(silver).padStart(2, "0")}s ${String(rest).padStart(2, "0")}c`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
