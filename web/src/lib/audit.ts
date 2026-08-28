import { env, isDemo } from "./env";
import { execute, schema, tableExists } from "./db";

/**
 * A small append-only log of account events, in our own schema.
 *
 * It records what happened and to which account, never why it failed and never
 * a password, token or verifier. Its job is to answer "was this account taken
 * over?" - not to be an intrusion detection system.
 */
export type AuditEvent =
  | "register"
  | "login"
  | "login_failed"
  | "logout"
  | "password_change"
  | "password_reset_request"
  | "password_reset"
  | "password_reset_failed";

export async function audit(
  event: AuditEvent,
  options: { accountId?: number | null; username?: string | null; address?: string | null; detail?: string | null } = {},
): Promise<void> {
  if (isDemo) return;
  try {
    if (!(await tableExists(env.db.web, "web_audit"))) return;
    await execute(
      `INSERT INTO ${schema.web}.\`web_audit\` (event, account_id, username, address, detail)
       VALUES (?, ?, ?, ?, ?)`,
      [
        event,
        options.accountId ?? null,
        options.username?.slice(0, 32) ?? null,
        options.address?.slice(0, 45) ?? null,
        options.detail?.slice(0, 255) ?? null,
      ],
    );
  } catch (error) {
    // Never let bookkeeping break a login.
    console.warn("[audit] write failed:", error instanceof Error ? error.message : error);
  }
}
