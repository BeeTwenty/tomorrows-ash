# ADR 0008 — The admin panel

**Date:** 2026-08-31
**Status:** Accepted

## Context

The realm needs an operator surface: ban and unban accounts, answer support
tickets about a character, rebalance the ability trees, put the realm into
maintenance. Today all of that is a GM logging into the game client, or a
person with a MySQL prompt and root.

Both are worse than they look. The in-game commands cannot reach an offline
character's row, cannot edit a tree, and leave no record beyond the core's own
sparse logging. The MySQL prompt can do anything at all, to any table, with no
record whatsoever — and the credentials for it end up in a shell history.

The brief asked for three things explicitly: a staff role distinct from player
accounts, an audit log of every action, and tiered permissions if tiers made
sense. It also asked for the access-control model to be settled before any
functionality was written, on the grounds that this is the highest-privilege
surface in the project.

## Decision

A **separate Next.js service in `web-admin/`**, with its own database user, its
own session secret, its own deployment, and no code path shared with the public
site except pure functions.

### Why separate rather than a section of `web/`

The public site is reachable by anyone with the URL and exists to be reached. It
runs as `ash_web`, which by design cannot ban an account, cannot write to
`account_access`, and holds no `DELETE` anywhere.

Folding the panel into it would mean giving that process the ability to do all
of those things, and then relying on application code to decide who may. Every
public route, every dependency, every rendering bug in the marketing pages would
then sit inside a blast radius that includes `account_access`. The separation is
not two Next.js apps for tidiness — it is **two database users**, and that is the
boundary that actually holds when the application layer is wrong.

The costs are real and accepted: two deployments and two sets of environment
variables. The shared-code rule, though, is not left to review — `tsconfig.json`
maps exactly three pure modules by name (`srp6`, `limits`, `wow`) rather than
exposing `web/src/lib` through a wildcard, so importing `db.ts`, `env.ts` or
`session.ts` from here does not compile. Those three are duplicated on purpose:
sharing them is exactly how the two processes would end up with one set of
privileges.

(The wildcard was the first attempt, and it typechecked locally only because
`web/node_modules` happened to be installed. CI, which installs neither app's
dependencies for the other, is what caught it.)

### Identity from the game account, authorization from `account_access`

Staff sign in with their **game account** — same username, same SRP6 verifier,
same 16-character limits the 3.3.5a client imposes. No second credential to
lose, and an account disabled in the game is disabled here by the same act.

Authorization does **not** come from the password. It comes from
`acore_auth.account_access.gmlevel`, the column the core itself uses, read after
the password is verified and **re-read from the database on every request**. A
correct password for a level-0 account gets the same answer as a wrong one.

Re-reading per request is what makes demotion immediate. A signed cookie
carrying a role would let a demoted administrator keep working until their
session expired.

### Four tiers, mapped onto the core's own enum

`src/common/Common.h` already defines the levels; inventing a parallel scheme
would mean two things to keep in agreement.

| Tier | gmlevel | Holds |
|---|---|---|
| Support | 1 (`SEC_MODERATOR`) | Read-only. Accounts, characters, trees, realm status, and **their own** audit rows. Emails masked. |
| Game master | 2 (`SEC_GAMEMASTER`) | Player-affecting: ban, unban, mute, password reset, character edit, kick, revive, teleport. The whole audit log. |
| Administrator | 3 (`SEC_ADMINISTRATOR`) | Realm-affecting: MOTD, maintenance, announcements, tree and node edits, staged itemization. |
| Owner | 4 (`SEC_CONSOLE`) | The three that can escalate or are irreversible: staff levels, promoting an itemization change, revoking others' sessions. |

Tiers are not a convenience. Most staff work is answering tickets, and the
account that does it all day should not be able to make itself an owner.

### Three escalation rules, enforced in one place

`src/lib/roles.ts` is pure functions with no database access, so it is tested
exhaustively rather than reasoned about:

1. **Nobody acts on their own account.** Not a ban, not a level change.
2. **Nobody acts on a peer or a superior.** `targetGmLevel >= actor.gmLevel`
   is refused, so a game master cannot ban an administrator.
3. **Nobody grants a level at or above their own.** No sequence of legal moves
   ends with someone holding more than they started with.

Character actions are authorised against the character's **owning account**,
not the character — otherwise a GM unreachable through their account would be
reachable through the level 80 they play on.

### Mandatory TOTP, with the secret sealed at rest

The panel's own second factor, not `account.totp_secret`: that column is the
*game client's* factor, and sharing it would mean the panel could read it and
that enrolling in one silently changed the other.

RFC 6238 on `node:crypto`, tested against the RFC's published vectors. The
secret is sealed with AES-256-GCM under `ADMIN_TOTP_KEY` before storage, so a
database dump alone does not let anyone mint codes. A used step is recorded and
anything at or below it refused, so a shoulder-surfed code lives once rather
than for its ninety-second window.

### An audit log that the panel itself cannot rewrite

`ash_admin` holds `INSERT` on `admin_audit` and **not** `UPDATE` or `DELETE`.
That is the property that makes the log worth having: it holds even when the
panel is the thing that has been compromised. Trimming old rows is a root job,
done deliberately.

Denials are recorded alongside successes — a string of refused attempts is the
signal you actually want — and before/after snapshots are captured, because
"my item disappeared" is only answerable if the old row was written down at the
time. A failed audit write **fails the action**: an untraceable staff action is
worse than a refused one.

### The chokepoint

`src/lib/authz.ts` is the only way to obtain an actor. `requirePermission()`
either returns an authorised context or does not return at all, so there is no
shape of code where a page forgets the check and still renders. Layout guards
and navigation filtering are presentation; every page calls the guard itself.

**Middleware is not the boundary.** Next.js middleware has been bypassable at
the framework level (CVE-2025-29927), cannot reach the database to re-read a GM
level, and runs before the route knows which permission it needs. `middleware.ts`
does one thing that is safe to get wrong — bounce anonymous requests without a
database round trip — and says so in as many words.

### Exposure

Public HTTPS behind an IP allowlist, declared rather than guessed. `ADMIN_PUBLIC=1`
makes an allowlist and a trusted proxy mandatory, and the panel **refuses to
start** without them rather than starting in a state where a control the
operator believes in is switched off. `X-Forwarded-For` is written by the client,
so hops are counted from the right and only as many are peeled as the operator
says they run.

There is no demo mode. A panel that renders invented accounts teaches habits
that are all wrong on the first real deployment.

## Consequences

**Good.** The privilege boundary is a database grant, not an `if`. A compromised
public site still cannot ban anyone. A demoted administrator loses access on
their next click. Every action has a record that the panel cannot edit. The
realm can be rebalanced without a recompile, which is the "data over code"
invariant the project already committed to.

**Costs.** Two services to deploy and two secrets sets to manage. Some
duplication between `web/` and `web-admin/` that must be kept deliberate.
Mandatory TOTP means an owner has to be able to clear a lost enrolment, which is
itself a privileged action.

**Limits, stated plainly.** Three things the panel does not do, because doing
them would mean lying:

- **Population cap.** `PlayerLimit` lives in `worldserver.conf` with no database
  representation. The panel could write a number somewhere and it would change
  nothing, so the realm page says so instead of offering a field.
- **Anything needing a running server** — kicks, revives, teleports, live MOTD,
  tree reloads — needs SOAP. Without it the panel refuses those actions and says
  why, rather than appearing to make them.
- **The budget curve.** See below.

## The one thing this needs from the server branch

`Classless.Points.FirstLevel`, `PerLevel` and `Bonus` live in
`mod_classless.conf` on the worldserver. The panel cannot read that file — in
most deployments it is a different machine — and mirroring the values into the
panel's own environment would create a second source of truth that silently
disagrees with the first. `docs/PHASE2-BUDGET.md §5` already rejected caching
the budget for the same reason.

**Request to `claude/tomorrows-ash-classless-setup-*`:** publish the three values
in a `classless_config` table in the world database, read by the module at load,
with the conf file as the seed. Shape suggested, not prescribed:

```sql
CREATE TABLE `classless_config` (
  `name`  VARCHAR(64) NOT NULL,
  `value` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`name`)
);
-- Points.FirstLevel, Points.PerLevel, Points.Bonus
```

Until it exists, the panel reports points **spent** and says plainly that the
total available is unknown, rather than computing a number from values it cannot
verify. The grant for the table is written and commented out in
`web-admin/sql/admin-grants.sql`; the budget editor is the only planned page not
built, for the same reason.

## Alternatives rejected

**A section of the public site behind a role check.** Rejected above: it
collapses two database users into one, and the grant is the boundary that holds
when the code does not.

**SOAP for everything.** The console is the only correct path for an *online*
character, and the wrong one for everything else: it needs a running server, it
has no transaction, it returns prose rather than rows, and a GM account's level
bounds it independently of the panel's own tiers. It is used where it is the
only option and reported honestly when unavailable.

**A separate staff credential.** More to lose, more to reset, and it decouples
"disabled in the game" from "disabled in the panel" — which is precisely the
coupling you want when removing someone's access in a hurry.

**Flat permissions with an "are you sure" prompt.** A confirmation dialog is not
an access control. The account answering tickets all day should not be able to
make itself an owner, whatever it clicks through.
