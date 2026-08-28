# CLAUDE.md — working notes for AI sessions

Read this before touching anything. It is the list of things that have already
gone wrong, or would, and the invariants that hold the design together.

**Project:** Tomorrow's Ash — a classless WoW private server. Realm: **Ashmorrow**.
**Base:** AzerothCore (WotLK 3.3.5a), pinned in `upstream.json`.

---

## 1. This repo does not contain the game server

`git clone` gives you our work only. The core is **fetched**, not vendored:

```bash
python3 tools/ta.py doctor      # what's missing on this machine
python3 tools/ta.py bootstrap   # clones AzerothCore at the pin into .acore/
python3 tools/ta.py configure && python3 tools/ta.py build
```

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
| Script hooks can grant permissions | **They can only veto.** `CALL_ENABLED_BOOLEAN_HOOKS` returns false if any script says false. Loosening must come from data. |

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

There is a separate session on the website (`web/`, a Next.js app). Coordinate,
do not collide:

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

---

## 7. Where things are

| Path | |
|---|---|
| `modules/mod-classless/` | the module: C++, SQL migrations, config |
| `tools/ta.py` | build / db / run CLI |
| `tools/gen_trees.py` | generates tree SQL, verifies every spell |
| `tools/spell_cascade.py` | what does granting this spell drag in? |
| `docs/CLASS-RESTRICTIONS.md` | how AzerothCore enforces class rules, with file:line |
| `docs/ARCHITECTURE.md` | repo model, module rules |
| `docs/BODY-TYPES.md` | the three body types, final |
| `docs/PHASE2-BUDGET.md` | budget design, respec semantics, pricing |
| `docs/ROADMAP.md` | phase status and open questions |
| `docs/decisions/` | ADRs — read before re-opening a settled question |

Module SQL goes in `modules/mod-classless/data/sql/db-{world,characters,auth}/`
and is applied automatically by AzerothCore's updater. The directory name must
contain `world`, `characters` or `auth` or the migration is silently ignored.

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
