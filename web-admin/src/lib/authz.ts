import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit, type AuditEntry, type AuditOutcome } from "./audit";
import { configurationProblems, env } from "./env";
import { checkAllowlist, resolveClientAddress } from "./ip";
import {
  can,
  permissionRequires,
  requiresReason,
  type Actor,
  type Permission,
  type Verdict,
} from "./roles";
import { loadSession, type AdminSession, type SessionFailure } from "./session";

/**
 * The chokepoint.
 *
 * Every page, action and route handler in this app starts here. Not "should",
 * *does* - the functions below either return an authorised context or they do
 * not return at all, so there is no shape of code where a caller forgets the
 * check and still renders. That is the reason authorisation lives in a
 * function that produces the actor rather than one that inspects an actor the
 * caller already has: you cannot get an actor without passing the gate.
 *
 * Middleware is deliberately *not* the boundary. Next.js middleware has been
 * bypassable at the framework level (CVE-2025-29927), it cannot reach the
 * database to re-read a GM level, and it runs before the route knows what
 * permission it needs. It is useful for cheap early rejection and nothing more;
 * `src/middleware.ts` says so in as many words.
 *
 * Six things are checked, in this order, because each one is cheaper than the
 * next and a failure of an earlier one makes the later ones meaningless:
 *
 *   1. The deployment is not misconfigured (env.configurationProblems()).
 *   2. The request's origin is same-site, for anything that mutates.
 *   3. A trustworthy client address exists and is on the allowlist.
 *   4. A session row exists, is live, and still matches the account.
 *   5. The session has finished the login sequence (password *and* TOTP).
 *   6. The actor's role carries the permission the caller named.
 */

export class AccessDenied extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AccessDenied";
    this.status = status;
  }
}

export class Misconfigured extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The admin panel is misconfigured and is refusing requests:\n - ${problems.join("\n - ")}`);
    this.name = "Misconfigured";
    this.problems = problems;
  }
}

/** Where a rejected visitor is sent, with a code the sign-in page can explain. */
const SIGN_IN = "/login";

function signInWith(reason: SessionFailure | "allowlist" | "stage"): never {
  redirect(`${SIGN_IN}?reason=${encodeURIComponent(reason)}`);
}

export async function clientAddress(): Promise<string | null> {
  const h = await headers();
  return resolveClientAddress((name) => h.get(name), {
    trustedProxyHops: env.access.trustedProxyHops,
    realIpHeader: env.access.realIpHeader,
  });
}

function assertConfigured(): void {
  const problems = configurationProblems();
  if (problems.length > 0) throw new Misconfigured(problems);
}

/**
 * Cross-site request rejection.
 *
 * Stricter than the public site's version, which tolerates a missing Origin
 * for the sake of old browsers submitting plain forms. Nothing reaches this
 * panel except a modern browser running our own JavaScript, so a mutation with
 * no Origin is not a compatibility case - it is a request that did not come
 * from the panel.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) throw new AccessDenied("Request has no Origin header.", 400);

  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new AccessDenied("Request has no Host header.", 400);

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AccessDenied("Request has a malformed Origin header.", 400);
  }

  if (originHost !== host) throw new AccessDenied("Cross-origin request refused.", 403);
}

/**
 * Steps 1-3 only, for the sign-in pages.
 *
 * They cannot use `gate()` - there is no session yet, which is the point - but
 * they must not skip the checks that come before one. An unauthenticated form
 * post is exactly the request the allowlist exists to refuse.
 */
export async function preAuthGate(options: { mutating?: boolean } = {}): Promise<string | null> {
  assertConfigured();
  if (options.mutating) await assertSameOrigin();

  const address = await clientAddress();
  const verdict = checkAllowlist(address, env.access.allowlist);
  if (!verdict.allowed) {
    await auditQuietly({
      actor: null,
      action: "auth.blocked",
      outcome: "denied",
      summary: verdict.reason,
      address,
    });
    throw new AccessDenied("This panel is not reachable from your network.", 403);
  }
  return address;
}

export interface AdminContext {
  session: AdminSession;
  actor: Actor;
  address: string | null;
}

interface GateOptions {
  /** Mutations additionally check Origin. Reads do not need to. */
  mutating?: boolean;
  /** Allow a half-authenticated session through - only the TOTP screens do. */
  allowStages?: AdminSession["stage"][];
}

/**
 * Steps 1-5. Returns a context or redirects; never returns a partial one.
 */
async function gate(options: GateOptions = {}): Promise<AdminContext> {
  assertConfigured();
  if (options.mutating) await assertSameOrigin();

  const address = await clientAddress();
  const verdict = checkAllowlist(address, env.access.allowlist);
  if (!verdict.allowed) {
    await auditQuietly({
      actor: null,
      action: "auth.blocked",
      outcome: "denied",
      summary: verdict.reason,
      address,
    });
    signInWith("allowlist");
  }

  const lookup = await loadSession(address);
  if (!lookup.ok) signInWith(lookup.reason);

  const allowed = options.allowStages ?? ["active"];
  if (!allowed.includes(lookup.session.stage)) {
    // A session stuck at the TOTP step is not an attack, it is an unfinished
    // login. Send it back to the step it owes rather than to a dead end.
    redirect(lookup.session.stage === "pending_enrolment" ? "/login/enrol" : "/login/verify");
  }

  return { session: lookup.session, actor: lookup.session.actor, address };
}

/** A read-only page or component. */
export async function requireSession(options: GateOptions = {}): Promise<AdminContext> {
  return gate(options);
}

/**
 * The one function that grants the right to do a thing.
 *
 * A refusal here is written to the audit log before it is thrown. A support
 * account probing for the ban button leaves a trail whether or not the button
 * works, and that trail is the point of having the log at all.
 */
export async function requirePermission(
  permission: Permission,
  options: GateOptions & { targetType?: string; targetId?: string | number; targetLabel?: string } = {},
): Promise<AdminContext> {
  const context = await gate(options);

  if (!can(context.actor, permission)) {
    await auditQuietly({
      actor: context.actor,
      action: permission,
      outcome: "denied",
      targetType: options.targetType ?? null,
      targetId: options.targetId ?? null,
      targetLabel: options.targetLabel ?? null,
      summary: `Requires ${permissionRequires(permission)}; actor is ${context.actor.role}.`,
      address: context.address,
      sessionId: context.session.id,
    });
    throw new AccessDenied(
      `That action needs the ${permissionRequires(permission)} role. You are signed in as ${context.actor.role}.`,
    );
  }

  return context;
}

/**
 * Apply an escalation guard (canActOnAccount, canGrantLevel) and record the
 * refusal. The guards themselves are pure so they can be tested exhaustively;
 * this is the thing that makes their verdicts binding.
 */
export async function enforce(
  context: AdminContext,
  permission: Permission,
  verdict: Verdict,
  target: { type: string; id: string | number; label?: string },
): Promise<void> {
  if (verdict.allowed) return;

  await auditQuietly({
    actor: context.actor,
    action: permission,
    outcome: "denied",
    targetType: target.type,
    targetId: target.id,
    targetLabel: target.label ?? null,
    summary: verdict.reason,
    address: context.address,
    sessionId: context.session.id,
  });
  throw new AccessDenied(verdict.reason);
}

/** Reasons are a data-quality rule, so they are enforced where the action is. */
export function normaliseReason(permission: Permission, raw: string | null | undefined): string | null {
  const reason = raw?.trim() ?? "";
  if (!requiresReason(permission)) return reason || null;
  if (reason.length < 8) {
    throw new AccessDenied("This action needs a written reason of at least 8 characters for the log.", 400);
  }
  return reason.slice(0, 512);
}

export interface ActionRecord {
  targetType: string;
  targetId: string | number;
  targetLabel?: string | null;
  summary: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Run a staff action with its audit row.
 *
 * The row is written *after* the work, so it can carry the real before/after,
 * and a throw is recorded as `error` rather than dropped - "it failed halfway"
 * is exactly the case a support ticket will ask about later. The audit write
 * itself is not caught: if the record cannot be made, the caller learns that
 * the action it just performed is untraceable.
 */
export async function performAudited<T>(
  context: AdminContext,
  permission: Permission,
  record: ActionRecord,
  work: () => Promise<T>,
): Promise<T> {
  let outcome: AuditOutcome = "ok";
  let result: T;

  try {
    result = await work();
  } catch (error) {
    outcome = "error";
    await audit({
      actor: context.actor,
      action: permission,
      outcome,
      targetType: record.targetType,
      targetId: record.targetId,
      targetLabel: record.targetLabel ?? null,
      summary: `${record.summary} - failed: ${error instanceof Error ? error.message : String(error)}`,
      reason: record.reason ?? null,
      before: record.before,
      address: context.address,
      sessionId: context.session.id,
    });
    throw error;
  }

  await audit({
    actor: context.actor,
    action: permission,
    outcome,
    targetType: record.targetType,
    targetId: record.targetId,
    targetLabel: record.targetLabel ?? null,
    summary: record.summary,
    reason: record.reason ?? null,
    before: record.before,
    after: record.after,
    address: context.address,
    sessionId: context.session.id,
  });

  return result;
}

/**
 * Audit writes that must not mask the thing they are describing.
 *
 * Used only on the denial paths. If the database is unreachable, the denial
 * still stands - turning a refusal into a 500 would make an outage look like a
 * way in. Successful actions use `audit()` directly and do fail on a bad write.
 */
async function auditQuietly(entry: AuditEntry): Promise<void> {
  try {
    await audit(entry);
  } catch (error) {
    console.error("[admin] audit write failed for a denial:", error);
  }
}

export { auditQuietly };
