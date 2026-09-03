# Ashmorrow admin panel

The operator surface for realm Ashmorrow: accounts, characters, ability trees,
itemization, realm configuration, and a record of everything anyone did.

It is a **separate service** from the public site in `web/`. Separate process,
separate deployment, separate database user, separate session secret. That
separation is the security boundary — see
[`docs/decisions/0008-admin-panel.md`](../docs/decisions/0008-admin-panel.md)
for why, and read it before changing anything about how access is decided.

```bash
cd web-admin
npm install
cp .env.example .env.local     # then fill it in; `npm run gen-secret` prints the keys
npm run check                  # typecheck + lint + unit tests. Run before pushing.
npm run dev                    # http://localhost:3010
```

There is **no demo mode**. Without a database the panel refuses to start.

---

## How access is decided

Four things have to be true before a request does anything. They are checked in
this order, each one cheaper than the next:

1. **The deployment is not misconfigured.** A public instance with no allowlist,
   or no trustworthy way to determine a client address, is not a degraded panel
   — it is an open one, so the process refuses to start.
2. **The address is allowed.** IPv4 and IPv6, CIDR ranges, fail-closed.
3. **The session is live.** Stateful and revocable, re-checked every request.
4. **The role carries the permission.** One chokepoint, `requirePermission()`.

### Identity is your game account

Same username, same password, same 16-character limits the 3.3.5a client
imposes. There is no second credential to lose, and disabling an account in the
game disables it here by the same act.

Your **password does not grant access**. Access comes from
`acore_auth.account_access.gmlevel`, read fresh from the database on every
request. A correct password for a level-0 account is refused exactly like a
wrong one, and demoting someone signs them out on their next click rather than
at their next login.

### Four tiers

| Tier | gmlevel | What it can do |
|---|---|---|
| **Support** | 1 | Read only. Accounts, characters, trees, realm status, and their own audit rows. Emails masked. |
| **Game master** | 2 | Ban, unban, mute, reset a password, edit a character, kick, revive, teleport. The whole audit log. |
| **Administrator** | 3 | MOTD, maintenance mode, announcements, tree and node edits, staged itemization. |
| **Owner** | 4 | Staff levels, promoting an itemization change, revoking others' sessions. |

Three rules hold regardless of tier, and are enforced in `src/lib/roles.ts` as
pure functions with their own tests:

- Nobody performs staff actions on **their own** account.
- Nobody acts on a **peer or superior** — a game master cannot ban an administrator.
- Nobody grants a level **at or above their own**.

Character actions are authorised against the character's *owning account*, so a
GM who cannot be reached through their account cannot be reached through the
level 80 they play on either.

### A second factor, mandatory

TOTP, on first sign-in, no opt-out. It is the panel's own — separate from the
authenticator on your game login, if you have one — because sharing that column
would mean the panel could read it.

Ten single-use recovery codes are issued at enrolment and shown **once**. Out of
codes and lost the device? An owner clears the enrolment; there is no
self-service path, by design.

The secret is sealed with AES-256-GCM under `ADMIN_TOTP_KEY` before it is
stored, so a database dump on its own does not let anyone mint codes.

---

## The audit log

Every action, every refusal, with before-and-after snapshots and the reason the
operator typed.

It is **append-only by grant**: `ash_admin` holds `INSERT` on `admin_audit` and
not `UPDATE` or `DELETE`. A fully compromised panel can add to the record and
cannot edit it. Trimming old rows is a root job, done deliberately.

A failed audit write **fails the action**. An untraceable staff action is worse
than a refused one.

Some actions require a written reason of at least eight characters — bans,
unbans, mutes, staff-level changes, character edits, maintenance, and promoting
an item change. A price that moved without a recorded argument is a price nobody
can defend three months later.

---

## What it does, and what it deliberately does not

### Accounts
View, search and filter. Ban (permanent or for a term), unban, mute, reset a
password, lock to last IP, set a staff level. Full ban history.

The ban predicate is **copied from the core**, not invented:

```sql
active = 1 AND (unbandate > UNIX_TIMESTAMP() OR unbandate = bandate)
```

`unbandate = bandate` is how a permanent ban is written, and `active = 1` alone
is not enough — expired rows keep `active = 1` until the worldserver's periodic
sweep clears them. A panel that checked only `active` would tell a support agent
an account is banned when it can log in perfectly well.

### Characters
View, search, equipped items, classless build breakdown. Edit level and gold.
Queue a rename, a customise, a spell or talent reset for next login. Kick,
revive and teleport through the console.

**The online rule.** While a character is online the worldserver holds their
state in memory and writes it back on logout. A direct `UPDATE` in that window
is not a race that usually works — it is a change that will be overwritten with
no error anywhere. Every direct write checks `online` first and refuses, saying
so; console actions still work.

### Ability trees
Edit names, descriptions, costs, tiers, level gates and enabled flags, then
reload the running server. This is the intended way to rebalance — trees, costs
and prerequisites are rows, and changing them must never need a recompile.

`spell_id` is **not** editable here. A node pointing at a spell that does not
exist takes a player's points and gives them nothing, and only
`tools/gen_trees.py` can prove a spell exists. Repointing a node is a repository
change, reviewed.

Re-pricing applies to new purchases only: the site and the module both sum
`classless_character_node.cost_paid`, the price actually paid, not the node's
current cost.

### Itemization
`AllowableClass` is a **signed** integer where `-1` means every class, and it is
the *weaker* of the two gates on gear — armour proficiency is a skill granted by
a spell and checked separately, and plate is sold only by Warrior and Paladin
trainers. Clearing a mask does not hand a cloth-wearer plate.

Changes are **staged** by an administrator and **promoted** by an owner, the same
discipline as `modules/mod-classless/data/sql-staged/`. Promotion re-checks the
live value inside a transaction and refuses if the item changed since staging.

### Realm
MOTD (stored in `acore_auth.motd`, so it survives a restart, and pushed live
through the console when one is configured), maintenance mode
(`realmlist.allowedSecurityLevel` — the realm stays visible and shows as locked,
which tells players something is happening), and in-game announcements.

### Three things it does not do

- **Population cap.** `PlayerLimit` is in `worldserver.conf` with no database
  representation. The panel could write a number somewhere and it would change
  nothing, so the realm page says so instead of offering a field.
- **The budget curve.** `Points.PerLevel` and friends live in
  `mod_classless.conf`, which the panel cannot read. Mirroring them here would
  create a second source of truth that silently disagrees with the first. The
  editor ships once the server branch publishes a `classless_config` table —
  the request is in ADR 0008. Until then character pages show points *spent* and
  say the total available is unknown.
- **Anything needing a running server, without one.** Kicks, revives, teleports,
  live MOTD and tree reloads need SOAP. Without it those actions are refused with
  a reason rather than appearing to work.

### Enabling the console

In `worldserver.conf`: `SOAP.Enabled = 1`, `SOAP.IP = "127.0.0.1"`, `SOAP.Port = 7878`.
In `web-admin/.env.local`: `SOAP_ENABLED=1`, `SOAP_USER`, `SOAP_PASSWORD`.

**Never expose 7878** — bind it to localhost.

**The account must be gmlevel 3 or higher.** `ACSoap.cpp` returns 403 below
`SEC_ADMINISTRATOR`, and that floor is hardcoded, so there is no least-privilege
option here. It authenticates with a game account's username and password
(`AccountMgr::CheckPassword`, so SRP6), which means this environment holds a
credential for a powerful account — use a dedicated one, not a person's. The
panel's own tiers do not constrain what it can do.

---

## Deployment

Full instructions, Windows and Linux, are in [`SETUP.md`](../SETUP.md). The short
version:

```bash
mysql -u root -p < web-admin/sql/admin-schema.sql
$EDITOR web-admin/sql/admin-grants.sql        # replace CHANGE_ME
mysql -u root -p < web-admin/sql/admin-grants.sql

cd web-admin
npm ci
npm run gen-secret >> .env.local              # then fill in the rest
npm run build
npm start                                     # 127.0.0.1:3010 only
```

It binds localhost, not `0.0.0.0`. Reaching it from elsewhere is a deliberate
act — an SSH tunnel (`ssh -L 3010:127.0.0.1:3010 you@host`) or a reverse proxy
that terminates TLS. `ADMIN_BIND=0.0.0.0` opts out.

Put it behind a reverse proxy that terminates TLS, then:

```
ADMIN_PUBLIC=1
ADMIN_SITE_URL=https://admin.example.com
ADMIN_IP_ALLOWLIST=203.0.113.7,198.51.100.0/24
ADMIN_TRUSTED_PROXY_HOPS=1
```

With `ADMIN_PUBLIC=1` the panel refuses to start unless the allowlist is
non-empty, a trusted proxy is configured, and the site URL is https. That is
deliberate: those are the controls, and starting without them while logging a
warning is how an open admin panel ends up on the internet for a week.

### The two secrets are not interchangeable

- `ADMIN_SESSION_SECRET` — rotating it signs every staff member out. Safe, occasionally useful.
- `ADMIN_TOTP_KEY` — rotating it makes every enrolled authenticator unreadable. **Back it up.**

They are separate keys for exactly that reason.

---

## Development

```bash
python3 ../tools/ta.py admin dev-db --yes   # database, schema, grants, fixture, .env.local
npm run dev
```

The fixture creates one account per tier so the permission model can be
exercised rather than reasoned about — `ASHOWNER`, `ASHSTAFF`, `ASHGM`,
`ASHSUPPORT` and a player to act on, `ASHCULPRIT`. Passwords are in
`sql/dev-fixture-admin.sql` and are obviously not production values.

```bash
npm run check                          # typecheck + lint + unit tests
npx tsx --test src/lib/roles.test.ts   # one file
```

### Layout

| Path | |
|---|---|
| `src/lib/roles.ts` | the permission model and escalation guards — pure, exhaustively tested |
| `src/lib/authz.ts` | the chokepoint: `requirePermission`, `enforce`, `performAudited` |
| `src/lib/session.ts` | stateful revocable sessions, gmlevel re-read per request |
| `src/lib/audit.ts` | writing and reading the record |
| `src/lib/mfa.ts` `totp.ts` `secretbox.ts` | the second factor |
| `src/lib/ip.ts` | client address resolution and the allowlist |
| `src/lib/soap.ts` | the worldserver console, with validated arguments |
| `sql/admin-schema.sql` | the panel's own schema |
| `sql/admin-grants.sql` | `ash_admin`, and what it is deliberately not given |

### Rules for changing this codebase

- **Only pure modules are shared with `web/`**, and `tsconfig.json` enforces it.
  The three — `srp6`, `limits`, `wow` — are mapped by name, not by a `@shared/*`
  wildcard. A wildcard is what this had first, and it made `db.ts`, `env.ts` and
  `session.ts` reachable: the public site's database pool and its notion of who
  is signed in, the two things this app must never inherit. `import ... from
  "@shared/db"` is now a compile error, not a code-review question.
- **Never widen a grant to make something work.** If the panel needs a privilege
  it does not have, that is a design question first.
- **Never build a console command from unvalidated input.** `soap.ts` exports
  validators; every caller uses them. The console runs as a GM account on the
  live realm.
- **Every mutation goes through `performAudited`.** If it is worth doing, it is
  worth a row.
