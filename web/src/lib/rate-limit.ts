import { env } from "./env";
import { execute, queryOne, schema, tableExists } from "./db";
import type { RowDataPacket } from "mysql2";
import { isDemo } from "./env";

/**
 * Fixed-window rate limiting for the account endpoints.
 *
 * Two drivers:
 *   memory - per-process, zero setup, correct for a single instance.
 *   mysql  - shared, survives restarts, correct behind several instances.
 *
 * Every protected action is limited on **two** buckets: the client address and
 * the identity being targeted (account name or email). The identity bucket is
 * the one that matters, because it keeps working when the client address is
 * unavailable or spoofed - see `clientAddress()` in request.ts.
 */

export interface RateRule {
  /** Attempts permitted per window. */
  limit: number;
  windowSeconds: number;
}

export const RATE_RULES = {
  login: { limit: 8, windowSeconds: 300 },
  loginIdentity: { limit: 5, windowSeconds: 900 },
  register: { limit: 4, windowSeconds: 3600 },
  passwordResetRequest: { limit: 4, windowSeconds: 3600 },
  passwordResetSubmit: { limit: 8, windowSeconds: 3600 },
  passwordChange: { limit: 6, windowSeconds: 3600 },
  armorySearch: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>;

export interface RateResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window rolls over. */
  retryAfter: number;
}

const memoryBuckets = new Map<string, { hits: number; windowStart: number }>();
let lastSweep = 0;

function sweepMemory(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  const cutoff = now / 1000 - 24 * 3600;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.windowStart < cutoff) memoryBuckets.delete(key);
  }
}

function consumeMemory(key: string, rule: RateRule): RateResult {
  const now = Date.now();
  sweepMemory(now);
  const seconds = Math.floor(now / 1000);
  const windowStart = seconds - (seconds % rule.windowSeconds);
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.windowStart !== windowStart) {
    memoryBuckets.set(key, { hits: 1, windowStart });
    return { allowed: true, remaining: rule.limit - 1, retryAfter: 0 };
  }

  bucket.hits += 1;
  const allowed = bucket.hits <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - bucket.hits),
    retryAfter: allowed ? 0 : windowStart + rule.windowSeconds - seconds,
  };
}

interface HitsRow extends RowDataPacket {
  hits: number;
  window_start: number;
}

async function consumeMysql(key: string, rule: RateRule): Promise<RateResult> {
  const seconds = Math.floor(Date.now() / 1000);
  const windowStart = seconds - (seconds % rule.windowSeconds);

  // VALUES() is deprecated in MySQL 8.0.20+ but still supported there, and it
  // is the only form MariaDB understands. Both back AzerothCore installs.
  await execute(
    `INSERT INTO ${schema.web}.\`web_rate_limit\` (bucket, window_start, hits)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE
       hits = IF(window_start < VALUES(window_start), 1, hits + 1),
       window_start = IF(window_start < VALUES(window_start), VALUES(window_start), window_start)`,
    [key.slice(0, 190), windowStart],
  );

  const row = await queryOne<HitsRow>(
    `SELECT hits, window_start FROM ${schema.web}.\`web_rate_limit\` WHERE bucket = ?`,
    [key.slice(0, 190)],
  );

  const hits = row?.hits ?? 1;
  const allowed = hits <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - hits),
    retryAfter: allowed ? 0 : windowStart + rule.windowSeconds - seconds,
  };
}

/**
 * Count one attempt against a bucket.
 *
 * The MySQL driver falls back to the in-memory one rather than failing open:
 * a rate limiter that stops limiting when its storage hiccups is worse than
 * one that gets a little less accurate.
 */
export async function consume(key: string, rule: RateRule): Promise<RateResult> {
  if (env.security.rateLimitDriver === "mysql" && !isDemo) {
    try {
      if (await tableExists(env.db.web, "web_rate_limit")) {
        return await consumeMysql(key, rule);
      }
      console.warn("[rate-limit] web_rate_limit table missing; using in-memory limiting.");
    } catch (error) {
      console.warn("[rate-limit] mysql driver failed, falling back to memory:", error);
    }
  }
  return consumeMemory(key, rule);
}

/** Check several buckets at once; the strictest verdict wins. */
export async function consumeAll(
  entries: Array<{ key: string; rule: RateRule }>,
): Promise<RateResult> {
  const results = await Promise.all(entries.map(({ key, rule }) => consume(key, rule)));
  const blocked = results.find((r) => !r.allowed);
  if (blocked) return blocked;
  return results.reduce(
    (worst, r) => (r.remaining < worst.remaining ? r : worst),
    { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfter: 0 } as RateResult,
  );
}

export function rateLimitMessage(result: RateResult): string {
  const minutes = Math.ceil(result.retryAfter / 60);
  if (minutes <= 1) return "Too many attempts. Wait a minute and try again.";
  return `Too many attempts. Try again in about ${minutes} minutes.`;
}

/** Test seam: drops in-memory state between cases. */
export function _resetMemoryBuckets(): void {
  memoryBuckets.clear();
}
