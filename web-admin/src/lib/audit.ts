import type { RowDataPacket } from "mysql2";
import { execute, query, schema, type SqlParam } from "./db";
import type { Actor, Permission } from "./roles";

/**
 * The record of who did what.
 *
 * This is the reason the panel can be trusted with destructive actions at all,
 * so three properties matter more than convenience:
 *
 *   1. **Denials are recorded too.** A successful ban tells you what happened;
 *      a string of refused attempts tells you something is wrong, and that is
 *      the signal you actually want.
 *   2. **Before and after are captured.** "My item disappeared" is answerable
 *      only if the row's previous contents were written down at the time.
 *   3. **It cannot be edited.** `ash_admin` holds INSERT on this table and not
 *      UPDATE or DELETE (web-admin/sql/admin-grants.sql), so the panel can add
 *      to the record and nothing more - including when the panel is the thing
 *      that has been compromised.
 *
 * A failure to write an audit row fails the action. That is the opposite of the
 * public site's audit helper, which swallows errors so bookkeeping never breaks
 * a login. Here the bookkeeping *is* the point: an untraceable staff action is
 * worse than a refused one.
 */

export type AuditOutcome = "ok" | "denied" | "error";

export interface AuditEntry {
  actor: Pick<Actor, "accountId" | "username" | "gmLevel" | "role"> | null;
  action: Permission | "auth.login" | "auth.login_failed" | "auth.logout" | "auth.totp_failed" | "auth.blocked";
  outcome: AuditOutcome;
  targetType?: string | null;
  targetId?: string | number | null;
  /** Human-readable target, so the log stays legible after a rename. */
  targetLabel?: string | null;
  summary?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  address?: string | null;
  sessionId?: string | null;
}

function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    // A truncated snapshot still beats no snapshot; the column is generous.
    return text.length > 60_000 ? `${text.slice(0, 60_000)}…(truncated)` : text;
  } catch {
    return null;
  }
}

export async function audit(entry: AuditEntry): Promise<void> {
  await execute(
    `INSERT INTO ${schema.admin}.\`admin_audit\`
       (actor_account_id, actor_username, actor_gmlevel, actor_role,
        action, outcome, target_type, target_id, target_label,
        summary, reason, before_json, after_json, address, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.actor?.accountId ?? null,
      entry.actor?.username?.slice(0, 32) ?? null,
      entry.actor?.gmLevel ?? null,
      entry.actor?.role ?? null,
      entry.action,
      entry.outcome,
      entry.targetType ?? null,
      entry.targetId === undefined || entry.targetId === null ? null : String(entry.targetId).slice(0, 64),
      entry.targetLabel?.slice(0, 128) ?? null,
      entry.summary?.slice(0, 512) ?? null,
      entry.reason?.slice(0, 512) ?? null,
      serialise(entry.before),
      serialise(entry.after),
      entry.address?.slice(0, 45) ?? null,
      entry.sessionId?.slice(0, 64) ?? null,
    ],
  );
}

/* ------------------------------------------------------------------ *
 * Reading the log
 * ------------------------------------------------------------------ */

export interface AuditRecord {
  id: number;
  createdAt: Date;
  actorAccountId: number | null;
  actorUsername: string | null;
  actorRole: string | null;
  action: string;
  outcome: AuditOutcome;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  summary: string | null;
  reason: string | null;
  before: string | null;
  after: string | null;
  address: string | null;
}

export interface AuditFilter {
  actorAccountId?: number;
  action?: string;
  outcome?: AuditOutcome;
  targetType?: string;
  targetId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function readAudit(filter: AuditFilter): Promise<{ rows: AuditRecord[]; total: number }> {
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.actorAccountId !== undefined) {
    where.push("actor_account_id = ?");
    params.push(filter.actorAccountId);
  }
  if (filter.action) {
    where.push("action = ?");
    params.push(filter.action);
  }
  if (filter.outcome) {
    where.push("outcome = ?");
    params.push(filter.outcome);
  }
  if (filter.targetType) {
    where.push("target_type = ?");
    params.push(filter.targetType);
  }
  if (filter.targetId) {
    where.push("target_id = ?");
    params.push(filter.targetId);
  }
  if (filter.q?.trim()) {
    where.push("(actor_username LIKE ? OR target_label LIKE ? OR summary LIKE ? OR reason LIKE ? OR address = ?)");
    const like = `%${filter.q.trim()}%`;
    params.push(like, like, like, like, filter.q.trim());
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<RowDataPacket & Record<string, never>>(
    `SELECT id, created_at, actor_account_id, actor_username, actor_role, action, outcome,
            target_type, target_id, target_label, summary, reason, before_json, after_json, address
       FROM ${schema.admin}.\`admin_audit\`
       ${clause}
      ORDER BY id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const counted = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM ${schema.admin}.\`admin_audit\` ${clause}`,
    params,
  );

  return {
    rows: rows.map((row) => {
      const r = row as unknown as Record<string, unknown>;
      return {
        id: Number(r.id),
        createdAt: r.created_at as Date,
        actorAccountId: (r.actor_account_id as number | null) ?? null,
        actorUsername: (r.actor_username as string | null) ?? null,
        actorRole: (r.actor_role as string | null) ?? null,
        action: String(r.action),
        outcome: r.outcome as AuditOutcome,
        targetType: (r.target_type as string | null) ?? null,
        targetId: (r.target_id as string | null) ?? null,
        targetLabel: (r.target_label as string | null) ?? null,
        summary: (r.summary as string | null) ?? null,
        reason: (r.reason as string | null) ?? null,
        before: (r.before_json as string | null) ?? null,
        after: (r.after_json as string | null) ?? null,
        address: (r.address as string | null) ?? null,
      };
    }),
    total: Number(counted[0]?.n ?? 0),
  };
}

/** Counts for the overview: what has happened lately, and what was refused. */
export async function auditPulse(hours = 24): Promise<{ total: number; denied: number; errors: number }> {
  const rows = await query<RowDataPacket & { total: number; denied: number; errors: number }>(
    `SELECT COUNT(*) AS total,
            SUM(outcome = 'denied') AS denied,
            SUM(outcome = 'error')  AS errors
       FROM ${schema.admin}.\`admin_audit\`
      WHERE created_at > (NOW() - INTERVAL ? HOUR)`,
    [Math.max(1, Math.trunc(hours))],
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    denied: Number(rows[0]?.denied ?? 0),
    errors: Number(rows[0]?.errors ?? 0),
  };
}
