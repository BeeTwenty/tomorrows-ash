import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MINIMUM_PANEL_LEVEL,
  SEC_ADMINISTRATOR,
  SEC_CONSOLE,
  SEC_GAMEMASTER,
  SEC_MODERATOR,
  SEC_PLAYER,
  type Actor,
  type Permission,
  can,
  canActOnAccount,
  canGrantLevel,
  maskEmail,
  permissionRequires,
  roleForLevel,
  roleRank,
  requiresReason,
} from "./roles";

const actorAt = (gmLevel: number, accountId = 100): Actor => ({
  accountId,
  username: `ACTOR${accountId}`,
  gmLevel,
  role: roleForLevel(gmLevel)!,
});

const support = actorAt(SEC_MODERATOR, 1);
const gm = actorAt(SEC_GAMEMASTER, 2);
const admin = actorAt(SEC_ADMINISTRATOR, 3);
const owner = actorAt(SEC_CONSOLE, 4);

test("gm levels map to the roles the core's own enum implies", () => {
  assert.equal(roleForLevel(SEC_PLAYER), null, "a plain player is not staff");
  assert.equal(roleForLevel(SEC_MODERATOR), "support");
  assert.equal(roleForLevel(SEC_GAMEMASTER), "gamemaster");
  assert.equal(roleForLevel(SEC_ADMINISTRATOR), "administrator");
  assert.equal(roleForLevel(SEC_CONSOLE), "owner");
  assert.equal(roleForLevel(99), "owner", "levels above the enum do not fall through to nothing");
  assert.equal(roleForLevel(-1), null);
  assert.equal(MINIMUM_PANEL_LEVEL, SEC_MODERATOR);
});

test("support is read-only: it holds no permission that changes anything", () => {
  const writes: Permission[] = [
    "account.ban", "account.unban", "account.mute", "account.password_reset",
    "character.edit", "character.restore_item", "character.teleport", "character.revive",
    "character.kick", "realm.motd", "realm.maintenance", "realm.population_cap",
    "realm.announce", "tree.edit", "tree.reload", "budget.edit", "item.stage",
    "account.set_gmlevel", "item.promote", "admin.session.revoke",
  ];
  for (const permission of writes) {
    assert.equal(can(support, permission), false, `support must not hold ${permission}`);
  }
  assert.equal(can(support, "account.view"), true);
  assert.equal(can(support, "character.view"), true);
});

test("each tier holds everything the tier below it holds", () => {
  const all = Object.keys({
    "account.view": 0, "character.view": 0, "audit.view.self": 0, "realm.view": 0,
    "tree.view": 0, "item.view": 0, "account.ban": 0, "account.unban": 0,
    "account.mute": 0, "account.password_reset": 0, "character.edit": 0,
    "character.restore_item": 0, "character.teleport": 0, "character.revive": 0,
    "character.kick": 0, "audit.view.all": 0, "realm.motd": 0, "realm.maintenance": 0,
    "realm.population_cap": 0, "realm.announce": 0, "tree.edit": 0, "tree.reload": 0,
    "budget.edit": 0, "item.stage": 0, "account.set_gmlevel": 0, "item.promote": 0,
    "admin.session.revoke": 0,
  }) as Permission[];

  for (const permission of all) {
    for (const [lower, higher] of [[support, gm], [gm, admin], [admin, owner]] as const) {
      if (can(lower, permission)) {
        assert.equal(can(higher, permission), true,
          `${higher.role} must inherit ${permission} from ${lower.role}`);
      }
    }
  }
});

test("only an owner can hand out staff levels or promote itemization", () => {
  for (const actor of [support, gm, admin]) {
    assert.equal(can(actor, "account.set_gmlevel"), false, `${actor.role} must not grant levels`);
    assert.equal(can(actor, "item.promote"), false);
  }
  assert.equal(can(owner, "account.set_gmlevel"), true);
  assert.equal(permissionRequires("account.set_gmlevel"), "owner");
});

test("nobody may act on a peer or a superior", () => {
  assert.equal(canActOnAccount(gm, SEC_PLAYER, 900).allowed, true, "a GM may act on a player");
  assert.equal(canActOnAccount(gm, SEC_GAMEMASTER, 900).allowed, false, "…but not on a peer");
  assert.equal(canActOnAccount(gm, SEC_ADMINISTRATOR, 900).allowed, false, "…nor a superior");
  assert.equal(canActOnAccount(owner, SEC_ADMINISTRATOR, 900).allowed, true);
});

test("nobody may act on their own account", () => {
  const verdict = canActOnAccount(owner, SEC_PLAYER, owner.accountId);
  assert.equal(verdict.allowed, false);
  assert.match((verdict as { reason: string }).reason, /your own account/i);
});

test("nobody may grant a level at or above their own", () => {
  assert.equal(canGrantLevel(owner, { accountId: 900, gmLevel: 0 }, SEC_ADMINISTRATOR).allowed, true);
  assert.equal(canGrantLevel(owner, { accountId: 900, gmLevel: 0 }, SEC_CONSOLE).allowed, false,
    "an owner cannot mint another owner");
  assert.equal(canGrantLevel(admin, { accountId: 900, gmLevel: 0 }, SEC_MODERATOR).allowed, false,
    "an administrator holds no grant permission at all");
});

test("the two-step escalation is closed", () => {
  // An owner promoting someone to owner would create a peer who could then
  // promote anyone. Refused at the first step, so the second never exists.
  assert.equal(canGrantLevel(owner, { accountId: 900, gmLevel: SEC_PLAYER }, SEC_CONSOLE).allowed, false);
  // And nobody can raise an account that already outranks them.
  assert.equal(canGrantLevel(owner, { accountId: 900, gmLevel: SEC_CONSOLE }, SEC_MODERATOR).allowed, false);
});

test("a level outside the core's enum is refused", () => {
  for (const bad of [-1, 5, 1.5, Number.NaN, 999]) {
    assert.equal(canGrantLevel(owner, { accountId: 900, gmLevel: 0 }, bad).allowed, false,
      `level ${bad} must be refused`);
  }
});

test("destructive actions demand a written reason", () => {
  for (const p of ["account.ban", "account.set_gmlevel", "character.edit", "item.promote"] as Permission[]) {
    assert.equal(requiresReason(p), true, `${p} should require a reason`);
  }
  assert.equal(requiresReason("account.view"), false);
});

test("support sees a masked address; a GM sees the real one", () => {
  assert.equal(maskEmail("player@example.com", support), "pl••••@example.com");
  assert.equal(maskEmail("player@example.com", gm), "player@example.com");
  assert.equal(maskEmail("", support), "—");
});

test("role ranks are strictly ordered", () => {
  assert.ok(roleRank("support") < roleRank("gamemaster"));
  assert.ok(roleRank("gamemaster") < roleRank("administrator"));
  assert.ok(roleRank("administrator") < roleRank("owner"));
});
