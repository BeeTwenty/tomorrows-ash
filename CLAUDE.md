# CLAUDE.md — working notes for AI sessions

Read this before touching anything. It is the list of things that have already
gone wrong, or would, and the invariants that hold the design together.

**Project:** Tomorrow's Ash — a classless WoW private server. Realm: **Ashmorrow**.
**Base:** AzerothCore (WotLK 3.3.5a), pinned in `upstream.json`.

---

## 1. This repo does not contain the game server

`git clone` gives you our work only. The core is **fetched**, not vendored:

```bash
./install.sh          # Linux/macOS - deps, core, build, database, configs
.\install.ps1         # Windows
```

Both are thin wrappers over `python3 tools/ta.py install`, which is where the
logic lives so both platforms run the same code. It is idempotent: re-run after
a failure and it skips what already succeeded. The individual steps
(`doctor`, `bootstrap`, `configure`, `build`, `db`, `conf`) still exist for
working on one thing at a time.

Client data extraction — the four extractors in the right order, from the right
directory, with output filed where the server looks — is
`ta.py extract --client PATH`.

`.acore/` is gitignored and must never be committed. `tools/ta.py` is the single
entry point for build, database and run — read its `--help` before reaching for
raw cmake or mysql.

Upstream is bumped by editing one SHA in `upstream.json`, not by merging.

---

## 2. Invariants — do not break these without an explicit decision

**Zero core modifications.** The classless system needs no C++ changes to
AzerothCore, and that is what keeps upstream bumps cheap. If you think you need
one, re-read `docs/CLASS-RESTRICTIONS.md` first — the acquisition path is almost
certainly already open. CI warns if `patches/` becomes non-empty.

**The budget is derived, never stored.** Points are computed from level on every
read: `(level - FirstLevel + 1) * PerLevel + Bonus`. Do **not** add a
`classless_character` table to cache it — that was proposed and rejected. See
`docs/PHASE2-BUDGET.md §5`.

**Fail-safe by default.** Every module hook returns early unless
`Classless.Enable` is 1. Dropping the module into a stock realm must change
nothing.

**Data over code.** Trees, costs and prerequisites are rows. Rebalancing a live
realm must never need a recompile.

**Armor proficiency is locked to body type.** It is granted by a spell, so it
*could* be sold from a tree. It must not be — see `docs/BODY-TYPES.md §3`.

---

## 3. Facts that are counter-intuitive and cost time

Every one of these was established by reading the core or querying the database.
Do not re-derive them from memory; if you doubt one, verify it the same way.

| Claim | Reality |
|---|---|
| `learnSpell` blocks off-class spells | **It has no class or race check at all.** This is what makes the whole project possible. |
| Spell power scales off Intellect | **No.** 3.3.5 spell power is gear/buff auras only (`SpellBaseDamageBonusDone`). An ungeared Warrior casts Fireball for exactly what an ungeared Mage does. This document previously claimed otherwise and was wrong. |
| Melee is roughly comparable | **No.** Casters get `Strength - 10` with no level term vs `level*3 + Str*2 - 20` for plate: 26 AP vs 522 at level 80. |
| Granting a spell cascades into its rank chain | **Not for a fresh grant.** Both recursion branches in `learnSpell` require the spell to be *already known*. |
| Learning or casting is level-gated | **Neither is.** Zero level checks in the entire learn path. `classless_node.required_level` is the only gate that exists. |
| `AllowableClass` is a plain bitmask | It is a **signed** int where **`-1` means all classes**. Treat as a bitmask only when not `-1`. |
| Script hooks can grant permissions | **Boolean hooks can only veto** — `CALL_ENABLED_BOOLEAN_HOOKS` returns false if any script says false. **But `OnPlayerIsClass` is not one of them:** it returns `Optional<bool>`, first script with a value wins, and it may return *true* (`ScriptDefines/PlayerScript.cpp:570`, used by `Player::IsClass`, `Player.cpp:1350`). That is the one documented way to loosen a hardcoded class check without a core edit. See `docs/PHASE3-ITEMIZATION.md §4`. |
| Class-restricted gear is gated by `AllowableClass` | **The class mask is the weaker of two gates and not the one implementing the design.** Armor proficiency is a *skill* granted by a spell, checked separately (`PlayerStorage.cpp:2339`), and plate is sold only by Warrior and Paladin class trainers — `Trainer::IsTrainerValidForPlayer` compares `getClass()` with no hook. Clear the mask and the ladder still holds. The mask **is** cleared on this realm as of Phase 3 — 4,746 gear rows, `classless_item_class_backup` holds the originals. |
| Relics are gear like any other | **They are the one category no SQL can reach.** `Player::FindEquipSlot` picks the relic slot with a hardcoded `IsClass`, so `AllowableClass` never gets a say. Opened via the `OnPlayerIsClass` hook in `ClasslessRelics.cpp`, behind `Classless.OpenRelicSlot`, default off until a client confirms the slot draws. |
| The server controls what the character-creation screen offers | **It controls nothing there.** In 3.3.5a the class list, race/class pairs and class names come from the client's `CharBaseInfo.dbc` and `ChrClasses.dbc`; there is no opcode for any of it. The server can only *refuse* a creation (`CharacterCreating.Disabled.ClassMask`, `CharacterHandler.cpp:346`). Hiding or renaming is a client patch. |
| Limiting classes means deleting `playercreateinfo` rows | **Use the classmask config instead.** Deleting rows makes `Player::Create` return false and log `Possible hacking-attempt` for every honest player who picked a still-listed class. The config returns a real "disabled" response, needs no migration, and survives a world DB re-import. |
| One `worldserver.conf` is the config | **There can be several, and Windows picks by working directory.** `ConfigMgr::GetConfigPath()` returns the *relative* `"configs/"` on Windows (`Config.cpp:709`), and an MSBuild build drops a second copy under `build/bin/<Config>/configs/` on every build. Editing the wrong one is indistinguishable from editing nothing. `ta.py conf` writes them all; `ta.py doctor` lists them; the server logs `[Classless] Config in effect:` with the absolute path it read. |
| A setting being right in the repo means the realm has it | **No.** `ta.py conf` used to skip an existing config entirely, so a key added later never reached a configured realm — a whole playtest ran with character creation unrestricted. It now rewrites its own keys in place. When a config matters, check the deployed file or the startup log, never the generator. |
| Off-class spells stay learned | **Not with `ValidateSkillLearnedBySpells = 1`.** `Player::_LoadSpells` (`PlayerStorage.cpp:6610`) deletes any spell whose skill line is invalid for the character's race/class, at every login. That is every ability the broker sells. It must be 0 on this realm; `ta.py conf` now forces it and the module warns at startup. |
| Cloth chest pieces are `INVTYPE_CHEST` | **They are `INVTYPE_ROBE` (20).** Any query comparing armor classes by slot that filters on 5 alone drops cloth entirely and looks like it worked. |

---

## 4. Build and tooling traps

**Module sources are globbed at CMake *configure* time.** Adding a new `.cpp`
without re-running cmake fails as an *undefined reference at link*, not a
missing-file error. `ta.py build` now auto-reconfigures when module sources
change; if you invoke cmake directly, do it yourself.

**Module configs install to `dist/etc/modules/`**, not `dist/etc/`. Putting them
in the latter means worldserver silently uses defaults.

**The server cannot start without client data.** It exits at
`Failed to find map files for starting areas`. This is expected in any
environment without an extracted WoW 3.3.5a client — it is not a bug, and it
means gameplay cannot be verified here. Verify what you can (migrations apply,
module loads, symbols link) and say plainly what you could not.

**Never invent spell IDs.** `tools/gen_trees.py` generates the tree SQL and
*refuses to emit* if a spell cannot be proven to exist via `trainer_spell` or
`spell_ranks`. A node pointing at a non-existent spell takes a player's points
and gives them nothing. `tools/spell_cascade.py` reports what a grant drags in.

---

## 5. Sandbox environment notes

- No systemd. Start MySQL with `mysqld_safe --user=mysql &` after
  `mkdir -p /var/run/mysqld && chown mysql:mysql /var/run/mysqld`.
- Docker Hub anonymous pulls are rate limited here (HTTP 429). `ta.py db up`
  fails with a pointer to the native-MySQL path; that is the expected fallback.
- `azerothcore.org` is blocked by the egress proxy. Read the source tree
  instead of the wiki.
- A full build is ~15 GB and roughly 20 minutes on 4 cores with ccache.

---

## 6. More than one Claude works in this repo

Three workstreams run in parallel on their own branches, each owning a slice:

| Branch | Owns | Don't touch it from elsewhere |
|---|---|---|
| `claude/tomorrows-ash-classless-setup-*` | the server: `modules/`, `tools/`, `realm/`, core docs | — |
| `claude/tomorrows-ash-website-ksj53j` | `web/` — the Next.js site, and `web-admin/` — the operator panel | server module code |
| `claude/ashmorrow-custom-launcher-*` | the launcher — `docs/LAUNCHER-DESIGN.md`, ADRs 0005–0006 | server and website code |

`main` lags well behind all three; the branches are the live lines. Merge in
both directions rather than cherry-picking, and re-read this file after a merge
because the other sessions edit shared docs.

Coordinate, do not collide:

- **Do not "fix" `web/package.json` by resolving toward the Vite prototype.** A
  merge did exactly that once and broke the deploy for days: the manifest
  reverted to `tomorrows-ash-prototype` with a `vite build` script while every
  other file in `web/` belonged to the Next.js app, so `npm ci` refused to run.
  The correct manifest is `tomorrows-ash-web`, whose build script is
  `next build && node scripts/prepare-standalone.mjs`. The Vite prototype is gone
  from the working tree; it survives in full on the `prototype/tomorrows-ash-ui`
  branch (tip `aeb330c`) if it is ever wanted again.
- The website reads `classless_tree`, `classless_node` and
  `classless_character_node`. **Schema changes there are a cross-session
  contract** — check `web/src/lib/build.ts` before altering columns.
- Website spend is computed by joining `classless_character_node.cost_paid` —
  the price *paid*, not `classless_node.cost`, which can change.
- **`docs/decisions/` is shared.** Numbering is sequential across all sessions
  (0001–0003 server, 0004 website, 0005–0006 launcher, 0007 licence, 0008 admin
  panel). Check the directory before claiming a number, and never renumber
  someone else's ADR.
- **The admin panel needs one thing from the server branch.** `classless_config`
  in the world database, holding `Points.FirstLevel`, `Points.PerLevel` and
  `Points.Bonus`, read by the module at load with `mod_classless.conf` as the
  seed. Without it the panel cannot show a character's *available* points — only
  what they spent — because mirroring the conf values into the panel's own
  environment would be a second source of truth. The ask, with the reasoning, is
  in `docs/decisions/0008-admin-panel.md`; the grant is written and commented out
  in `web-admin/sql/admin-grants.sql`.

---

## 7. Where things are

| Path | |
|---|---|
| `modules/mod-classless/` | the module: C++, SQL migrations, config |
| `tools/ta.py` | build / db / run CLI |
| `tools/gen_trees.py` | generates tree SQL, verifies every spell |
| `tools/spell_cascade.py` | what does granting this spell drag in? |
| `tools/audit_items.py` | class restrictions on gear, measured; generates the unlock SQL |
| `tools/gen_body_types.py` | body-type stat curves and race coverage; refuses to emit if it misses an approved anchor |
| `docs/CLASS-RESTRICTIONS.md` | how AzerothCore enforces class rules, with file:line |
| `docs/ARCHITECTURE.md` | repo model, module rules |
| `docs/BODY-TYPES.md` | the three body types, final |
| `docs/PHASE2-BUDGET.md` | budget design, respec semantics, pricing |
| `docs/PHASE3-ITEMIZATION.md` | class restrictions on gear: what they cost, the pass, what needs sign-off |
| `docs/TRAINING-SYSTEM.md` | rank progression: what the first playtest exposed, three options, awaiting a decision |
| `docs/ROADMAP.md` | phase status and open questions |
| `docs/decisions/` | ADRs — read before re-opening a settled question |
| `web/` | the public site (§9) |
| `web-admin/` | the operator panel (§10) |

Module SQL goes in `modules/mod-classless/data/sql/db-{world,characters,auth}/`
and is applied automatically by AzerothCore's updater. The directory name must
contain `world`, `characters` or `auth` or the migration is silently ignored.

`modules/mod-classless/data/sql-staged/` is deliberately outside that tree: it
holds generated migrations that are written but must not run until somebody
decides they should. Promoting one is a `git mv` into `data/sql/db-world/`.

---

## 8. Working style that has served this project

- **Verify, don't recall.** Spell IDs, formulas and schemas are all checkable
  against the source tree or the database. Several confident memories here were
  wrong.
- **Say what you did not test.** Most of this is verified by loading, not by
  playing. Be explicit about which.
- **Correct the record.** When a measurement contradicts something a document
  asserts, fix the document and say so — §3 exists because of that.
- **Phases end in a written report**: what was built, what was decided and why,
  what is risky or unfinished, and what the product owner needs to decide.

---

## 9. The website (`web/`)

Owned by `claude/tomorrows-ash-website-ksj53j` per §6. A separate Next.js
service: it reads the realm's database but builds, deploys and fails on its own,
and needs none of the server toolchain above.

```bash
cd web
npm install
npm run dev        # http://localhost:3000 — runs on sample data with no database
npm run check      # typecheck + lint + unit tests. Run before pushing.
npm run build      # then `npm start` serves the standalone build

npx tsx --test src/lib/srp6.test.ts     # one test file
```

From the repo root, `ta.py` drives its ops too:

```bash
python3 tools/ta.py web dev-db --yes    # MySQL + schemas + module SQL + sample characters + .env.local
python3 tools/ta.py web setup           # install, configure, build
python3 tools/ta.py web sql --grants    # site's own schema + least-privilege MySQL user
python3 tools/ta.py web doctor
python3 tools/ta.py web verify-srp6 --username SOME --password ITSPASSWORD
```

With no `DB_HOST` the site runs in **demo mode** on fixtures and says so on every
affected page — which is why the design was reviewable before a realm existed.

### Traps specific to this half

**Never prerender realm data.** Pages that read the database are
`force-dynamic`; caching lives in the data layer. A prerendered page bakes in
whatever the build machine could see, which in a container is nothing.

**SRP6 must match the core byte for byte.** `src/lib/srp6.ts` is ported from the
pinned upstream, and its test asserts against a vector captured from the compiled
`Acore::Crypto::SRP6` (`docs/reference/srp6/testvector.json`). Get the
little-endian conversions wrong and registration silently creates accounts the
game client can never log into. `ta.py web verify-srp6` checks it against a real
account the server itself made.

**The game client's limits are the real limits.** Account names and passwords cap
at 16 characters because the 3.3.5a client cannot send more. A form that accepts
more creates accounts nobody can use.

**Probe the schema, never assume it.** `src/lib/build.ts` asks
`information_schema` which columns exist, so the armory renders correctly before
and after a module migration and degrades to an honest "not yet" instead of
inventing data. Two details of the shared contract in §6 are load-bearing here:
there are **no ranks** (a node is bought once — no `rank` or `max_rank` column),
and **`granted = 0`** means the character already knew that spell and was never
charged, so respec must leave it alone.

That probing is not theoretical. The armory was written against the §5 sketch in
`ARCHITECTURE.md`, which had a `rank` column the shipped schema does not have.
The query failed, the error was swallowed, and every character with purchases
rendered "the classless system is not live on this realm yet" — the honest
fallback giving a dishonest answer.

**Own your tables applies here too.** Everything the site owns lives in its own
`ashmorrow_web` schema (sessions, reset tokens, rate limits, audit log). It never
adds a column to an AzerothCore table.

---

## 10. The admin panel (`web-admin/`)

Owned by the same branch as `web/` per §6, and a **third service**: its own
process, its own deployment, its own MySQL user. Read
`docs/decisions/0008-admin-panel.md` before changing anything about how access is
decided.

```bash
cd web-admin
npm install
npm run check      # typecheck + lint + unit tests. Run before pushing.
npm run dev        # http://localhost:3010 — needs a database; there is no demo mode

python3 tools/ta.py admin dev-db --yes    # database, schema, grants, fixture, .env.local
python3 tools/ta.py admin doctor
```

### The separation is the point

Two Next.js apps buys little on its own. **Two database users** is the boundary:
`ash_web` cannot ban an account or write to `account_access` and never will;
`ash_admin` can, and is not reachable from the public site's process. Folding
the panel into `web/` would put `account_access` inside the blast radius of every
marketing page.

So: **only pure modules are shared** — `srp6`, `limits`, `wow` — and
`web-admin/tsconfig.json` maps those three *by name*. Not a `@shared/*`
wildcard: that was the first attempt, it made `db.ts`, `env.ts` and
`session.ts` reachable, and it typechecked locally purely because
`web/node_modules` was installed. `@shared/db` is now a compile error. Adding a
fourth shared module is a deliberate line in that file, and only a pure module
qualifies — no database, no environment, no session.

### Traps specific to this third

**The audit log is append-only by grant, not by code.** `ash_admin` holds INSERT
on `admin_audit` and not UPDATE or DELETE. CI asserts it (`.github/workflows/ci.yml`,
the "append-only" step) and `ta.py admin doctor` checks the live grant, because
widening it breaks nothing visible — the panel would keep working perfectly.

**A failed audit write fails the action.** The opposite of the public site's
audit helper, which swallows errors so bookkeeping never breaks a login. Here the
bookkeeping is the point.

**`requirePermission()` produces the actor.** You cannot obtain an actor without
passing the gate, so there is no shape of code where a page forgets the check and
still renders. Layout guards and navigation filtering are presentation only.
Middleware is explicitly *not* the boundary — it has been bypassable at the
framework level (CVE-2025-29927) and cannot reach the database.

**gmlevel is re-read on every request.** Never from the cookie. That is what
makes a demotion take effect on the next click rather than at the next login.

**The ban predicate is copied from the core, not invented.** `active = 1` alone
is wrong: expired ban rows keep `active = 1` until the worldserver's sweep clears
them, so the panel must also test
`(unbandate > UNIX_TIMESTAMP() OR unbandate = bandate)` — LoginDatabase.cpp,
`LOGIN_SEL_LOGONCHALLENGE`. The dev fixture deliberately contains an expired-but-
active row so a regression here shows up.

**A character who is online cannot be written to.** The worldserver holds their
row in memory and writes it back on logout, so a direct UPDATE is silently
discarded — not a race that usually works. Every direct write re-checks `online`
inside the write path and refuses.

**Never build a console command from unvalidated input.** `soap.ts` exports
validators (`characterName`, `accountName`, `integerArg`, `textArg`) and every
caller uses them. Newlines are stripped rather than escaped, because the console
reads one command per line and there is no escape for a newline.

**A success message that its own re-render destroys is a bug, not a nit.** Two
were found by testing rather than reading: lifting a ban swaps the unban form for
the ban form, and promoting an item change removes the row holding the button.
Both now keep the message — the first by rendering results outside the swap, the
second by redirecting with a notice in the URL.

**Enrolment resumes; it does not reissue.** `beginEnrolment` returns the existing
unconfirmed secret. Generating a new one per render looks harmless until a second
tab or a guard redirect silently invalidates the secret someone is part-way
through scanning, and the only symptom is "that code is not right" for a code
that was right.

**The panel cannot read `mod_classless.conf`.** So it does not pretend to know
the budget — see the `classless_config` request in §6.

**One service's setup must never touch another's credentials.** `admin dev-db`
originally called `web dev-db` to avoid repeating the fixture. That also created
the *website's* database user — and when `web_db_pass` was absent from
`tools/local.json` it generated a new password, applied it, and rewrote
`web/.env.local`. A website already running still held the old one, so setting
up the admin panel took the public site down with
`Access denied for user 'ash_web'@'localhost'`. It now calls `db init` and
`web_fixture` — the shared *data* — and creates only `ash_admin`.

**A doctor that never connects as the service proves nothing.** `web doctor`
passed cleanly through the outage above, because every check it ran connected as
the admin user from `local.json`. Both doctors now connect with the credential
out of the service's own `.env.local`, which is the value that is actually
wrong when this happens.
