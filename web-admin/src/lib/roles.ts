/**
 * Who may do what.
 *
 * Authorization hangs off `acore_auth.account_access.gmlevel` - the same column
 * the game server reads to decide whether a `.command` is allowed. There is no
 * separate roster of panel staff, deliberately: promoting someone in game
 * promotes them here, and demoting them takes this away in the same instant.
 *
 * The levels are AzerothCore's own (`src/common/Common.h`):
 *
 *   0 SEC_PLAYER · 1 SEC_MODERATOR · 2 SEC_GAMEMASTER
 *   3 SEC_ADMINISTRATOR · 4 SEC_CONSOLE
 *
 * Everything in this module is a pure function of (actor, target). It holds no
 * database handle and performs no I/O, so the rules can be tested exhaustively
 * and cannot be accidentally bypassed by a code path that "already knows" the
 * answer.
 */

export const SEC_PLAYER = 0;
export const SEC_MODERATOR = 1;
export const SEC_GAMEMASTER = 2;
export const SEC_ADMINISTRATOR = 3;
export const SEC_CONSOLE = 4;

export type Role = "support" | "gamemaster" | "administrator" | "owner";

export interface Actor {
  accountId: number;
  username: string;
  /** Read fresh from account_access on every request, never from the cookie. */
  gmLevel: number;
  role: Role;
}

/** The minimum gmlevel that gets into the panel at all. */
export const MINIMUM_PANEL_LEVEL = SEC_MODERATOR;

export function roleForLevel(gmLevel: number): Role | null {
  if (gmLevel >= SEC_CONSOLE) return "owner";
  if (gmLevel >= SEC_ADMINISTRATOR) return "administrator";
  if (gmLevel >= SEC_GAMEMASTER) return "gamemaster";
  if (gmLevel >= SEC_MODERATOR) return "support";
  return null;
}

/**
 * Every privileged thing the panel can do, named.
 *
 * Actions are permissions, not pages. A page may show what a role cannot use,
 * but nothing is *done* without naming the permission that allows it, and the
 * name is what lands in the audit log.
 */
export type Permission =
  // --- read ---------------------------------------------------------------
  | "account.view"
  | "character.view"
  | "audit.view.self"
  | "audit.view.all"
  | "realm.view"
  | "tree.view"
  | "item.view"
  // --- player-affecting ----------------------------------------------------
  | "account.ban"
  | "account.unban"
  | "account.mute"
  | "account.password_reset"
  | "character.edit"
  | "character.restore_item"
  | "character.teleport"
  | "character.revive"
  | "character.kick"
  // --- realm-affecting -----------------------------------------------------
  | "realm.motd"
  | "realm.maintenance"
  | "realm.population_cap"
  | "realm.announce"
  | "tree.edit"
  | "tree.reload"
  | "budget.edit"
  | "item.stage"
  // --- dangerous -----------------------------------------------------------
  | "account.set_gmlevel"
  | "item.promote"
  | "admin.session.revoke";

const PERMISSIONS: Record<Permission, Role> = {
  "account.view": "support",
  "character.view": "support",
  "audit.view.self": "support",
  "realm.view": "support",
  "tree.view": "support",
  "item.view": "support",

  "account.ban": "gamemaster",
  "account.unban": "gamemaster",
  "account.mute": "gamemaster",
  "account.password_reset": "gamemaster",
  "character.edit": "gamemaster",
  "character.restore_item": "gamemaster",
  "character.teleport": "gamemaster",
  "character.revive": "gamemaster",
  "character.kick": "gamemaster",
  "audit.view.all": "gamemaster",

  "realm.motd": "administrator",
  "realm.maintenance": "administrator",
  "realm.population_cap": "administrator",
  "realm.announce": "administrator",
  "tree.edit": "administrator",
  "tree.reload": "administrator",
  "budget.edit": "administrator",
  "item.stage": "administrator",

  "account.set_gmlevel": "owner",
  "item.promote": "owner",
  "admin.session.revoke": "owner",
};

const ROLE_RANK: Record<Role, number> = {
  support: 1,
  gamemaster: 2,
  administrator: 3,
  owner: 4,
};

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

export function permissionRequires(permission: Permission): Role {
  return PERMISSIONS[permission];
}

export function can(actor: Actor, permission: Permission): boolean {
  return roleRank(actor.role) >= roleRank(permissionRequires(permission));
}

/** Permissions that must carry a written reason into the audit log. */
const REASON_REQUIRED = new Set<Permission>([
  "account.ban",
  "account.unban",
  "account.mute",
  "account.set_gmlevel",
  "character.edit",
  "character.restore_item",
  "realm.maintenance",
  "item.promote",
  "budget.edit",
]);

export function requiresReason(permission: Permission): boolean {
  return REASON_REQUIRED.has(permission);
}

/* ------------------------------------------------------------------ *
 * Escalation guards
 *
 * Three rules, each of which has to hold independently. They are the reason a
 * compromised support account cannot become an owner, and the reason a
 * disgruntled GM cannot ban the person above them.
 * ------------------------------------------------------------------ */

export type Refusal = { allowed: false; reason: string };
export type Allowance = { allowed: true };
export type Verdict = Allowance | Refusal;

const ALLOW: Allowance = { allowed: true };
const deny = (reason: string): Refusal => ({ allowed: false, reason });

/**
 * May the actor act on an account at this level?
 *
 * Strictly greater, not greater-or-equal: peers cannot act on each other. That
 * also makes acting on yourself impossible, which is the point - an actor who
 * could ban themselves could unban themselves.
 */
export function canActOnAccount(actor: Actor, targetGmLevel: number, targetAccountId: number): Verdict {
  if (actor.accountId === targetAccountId) {
    return deny("You cannot perform staff actions on your own account.");
  }
  if (targetGmLevel >= actor.gmLevel) {
    return deny("That account holds a staff level at or above your own.");
  }
  return ALLOW;
}

/**
 * May the actor set an account's gmlevel to `newLevel`?
 *
 * The new level must be strictly below the actor's own, so nobody can mint a
 * peer or a superior. Combined with `canActOnAccount` above, this closes the
 * two-step escalation as well: an administrator cannot promote a support
 * account to administrator and then be promoted back by it.
 */
export function canGrantLevel(
  actor: Actor,
  target: { accountId: number; gmLevel: number },
  newLevel: number,
): Verdict {
  if (!can(actor, "account.set_gmlevel")) {
    return deny("Only an owner may change staff levels.");
  }
  if (!Number.isInteger(newLevel) || newLevel < SEC_PLAYER || newLevel > SEC_CONSOLE) {
    return deny(`A staff level must be an integer between ${SEC_PLAYER} and ${SEC_CONSOLE}.`);
  }
  if (actor.accountId === target.accountId) {
    return deny("You cannot change your own staff level.");
  }
  if (newLevel >= actor.gmLevel) {
    return deny("You cannot grant a staff level at or above your own.");
  }
  if (target.gmLevel >= actor.gmLevel) {
    return deny("That account already holds a staff level at or above your own.");
  }
  return ALLOW;
}

/** Support staff see accounts, but never the address a reset would go to. */
export function maskEmail(email: string, actor: Actor): string {
  if (!email) return "—";
  if (roleRank(actor.role) >= roleRank("gamemaster")) return email;
  const [local, domain] = email.split("@");
  if (!local || !domain) return "—";
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
