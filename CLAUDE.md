# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **classless** World of Warcraft private server (realm: **Ashmorrow**) built on AzerothCore
(WotLK 3.3.5a), plus a public website. Any character can learn any ability; a per-level
skill-point budget is the only constraint.

Two independent deliverables live here, with separate lifecycles:

- **The realm** — `modules/mod-classless`, a C++ AzerothCore module plus SQL. Needs a
  ~15 GB build and extracted client data to run.
- **The website** — `web/`, a Next.js app. Builds and deploys on its own, needs none of the above.

Work on one without touching the other. The website reads the realm's database but is never
built from it.

## Commands

Everything for the realm goes through `tools/ta.py` (stdlib-only Python, Windows + Linux).
Per-machine settings live in `tools/local.json` (gitignored); never hardcode credentials.

```bash
python3 tools/ta.py doctor              # what's missing on this machine
python3 tools/ta.py bootstrap           # clone AzerothCore at the pinned commit into .acore/
python3 tools/ta.py configure && python3 tools/ta.py build
python3 tools/ta.py db up               # MySQL in Docker
python3 tools/ta.py db init             # create the three acore_* schemas
python3 tools/ta.py conf                # render dist/etc configs
python3 tools/ta.py run auth            # and `run world` in a second terminal
python3 tools/ta.py sync                # re-copy modules after edits, if bootstrap fell back to copy mode
```

Website:

```bash
cd web
npm install
npm run dev            # http://localhost:3000 — runs on sample data with no database
npm run check          # typecheck + lint + unit tests. Run before pushing.
npm test               # unit tests alone
npm run build          # then `npm start` serves the standalone build

npx tsx --test src/lib/srp6.test.ts    # a single test file
```

Website ops, from the repo root:

```bash
python3 tools/ta.py web dev-db --yes    # MySQL + schemas + module SQL + sample characters + .env.local
python3 tools/ta.py web setup           # install, configure, build
python3 tools/ta.py web sql --grants    # site's own schema + least-privilege MySQL user
python3 tools/ta.py web doctor
python3 tools/ta.py web verify-srp6 --username SOME --password ITSPASSWORD
python3 tools/gen_trees.py              # verify every tree spell; --write regenerates the migration
```

## The rules that shape everything

**Zero core C++ modifications.** The classless system is a module plus SQL. This is what makes
staying current with upstream realistic, and CI warns if a `patches/` directory appears. The
design rests on `Player::learnSpell()` having no class check — see `docs/CLASS-RESTRICTIONS.md`.

**Script hooks can only veto, never grant** (`ScriptMgrMacros.h:76`). Any *loosening* of a rule
must come from data or from an acquisition path we own. This is the single most important
constraint when designing a feature here; a boolean `OnPlayerCanX` hook will not do it.

**Overlay, not fork.** `upstream.json` pins an exact AzerothCore commit; `ta.py bootstrap`
fetches it into a gitignored `.acore/`. Everything this project changed relative to stock is
visible in this repo. Never commit `.acore/`, client data (`*.mpq`, `*.dbc`, maps), or `.env*`
files — CI fails on all three.

**Own your tables.** Module state lives in `classless_*` tables in the world and characters
databases; the website owns a separate `ashmorrow_web` schema. Nothing ever adds a column to an
AzerothCore table, so the core's own SQL updater can never collide with ours.

**Data over code.** Trees, abilities, costs and prerequisites are rows, not `switch` statements.
Rebalancing a live realm must never need a recompile.

**Fail-safe by default.** Every module hook returns early unless `Classless.Enable = 1`. Dropping
the module into a stock realm must change nothing.

## The classless data contract

Read by both the module and the website's armory, so changes here ripple:

```
world       classless_tree            id, name, description, sort_order, enabled
world       classless_node            id, tree_id, spell_id, name, description, tier, cost,
                                      required_level, requires_node, sort_order, enabled
characters  classless_character_node  guid, node_id, spell_id, cost_paid, granted, learned_at
```

Three things about it are load-bearing:

- **There are no ranks.** A node is bought once. Nothing has a `rank` or `max_rank` column.
- **`cost_paid`, not `classless_node.cost`.** Spend is summed from what a character was actually
  charged, so re-pricing a node does not retroactively bankrupt earlier buyers.
- **`granted = 0`** means the character already knew that spell and was never charged. Respec
  must not remove those — that is how you steal a Mage's own Fireball.

The **point budget is derived from level and never stored** —
`(level - FirstLevel + 1) * PerLevel + Bonus` from `mod_classless.conf`. There is deliberately no
`classless_character` table; `docs/PHASE2-BUDGET.md` §5 explains why, and why mirroring the curve
elsewhere is a trap. Spend is exact from SQL; the total is not derivable from SQL at all.

Module SQL must live in `modules/mod-classless/data/sql/db-{world,characters,auth}/` — AzerothCore's
updater matches those directory names by substring, and CI checks it. Anything else is silently
ignored, which is a nasty way to lose a migration.

`tools/gen_trees.py` refuses to emit SQL for any spell it cannot prove exists (via `trainer_spell`
or `spell_ranks`). A node pointing at a non-existent spell takes a player's points and gives
nothing.

## The website

Next.js 15 App Router + TypeScript, six runtime dependencies (`next`, `react`, `react-dom`,
`mysql2`, `marked`, `nodemailer`) — that small a set is deliberate for a credential-handling
surface. Adding one is a decision, not a convenience. `web/README.md` maps
the code; `docs/decisions/0004-website.md` explains the choices.

Four things bite if you don't know them:

- **Never prerender realm data.** Pages reading the database are `force-dynamic`; caching happens
  inside the data layer. A prerendered page bakes in whatever the build machine could see, which
  in a container is nothing.
- **SRP6 must match the core byte for byte.** `src/lib/srp6.ts` is ported from the pinned upstream,
  and its test asserts against a vector captured from the compiled `Acore::Crypto::SRP6`
  (`docs/reference/srp6/testvector.json`). Get the little-endian conversions wrong and registration
  silently creates accounts nobody can log into.
- **The game client's limits are the real limits.** Account names and passwords cap at 16
  characters because the 3.3.5a client cannot send more.
- **Everything is probed, never assumed.** `build.ts` asks `information_schema` which columns
  exist, so the armory renders correctly before and after a module migration, and degrades to an
  honest "not yet" rather than inventing data.

With no `DB_HOST` the site runs in **demo mode** on fixtures and says so on every affected page.

## Conventions

Migrations are dated: `YYYY_MM_DD_NN_description.sql`. Notable decisions get an ADR in
`docs/decisions/`. Docs are treated as code — CI checks that every relative link resolves, and
`SETUP.md` being wrong is a bug, not a stale file.
