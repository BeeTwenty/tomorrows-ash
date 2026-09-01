/** Formatting helpers. Server-rendered, so everything is explicit UTC. */

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

const UNITS: [seconds: number, name: string][] = [
  [31_536_000, "year"],
  [2_592_000, "month"],
  [86_400, "day"],
  [3600, "hour"],
  [60, "minute"],
  [1, "second"],
];

export function formatRelative(value: Date | string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "never";

  const deltaSeconds = Math.round((now - date.getTime()) / 1000);
  const past = deltaSeconds >= 0;
  const magnitude = Math.abs(deltaSeconds);

  if (magnitude < 10) return "just now";

  for (const [seconds, name] of UNITS) {
    if (magnitude >= seconds) {
      const count = Math.floor(magnitude / seconds);
      const plural = count === 1 ? name : `${name}s`;
      return past ? `${count} ${plural} ago` : `in ${count} ${plural}`;
    }
  }
  return "just now";
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Truncate for a dense table cell without hiding that it was truncated. */
export function clamp(value: string | null | undefined, length: number): string {
  if (!value) return "—";
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
