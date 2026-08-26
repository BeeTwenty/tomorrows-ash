# Tomorrow's Ash — architecture

**Realm:** Ashmorrow
**Base core:** AzerothCore (WotLK 3.3.5a), pinned in `upstream.json`
**Guiding constraint:** stay mergeable with upstream forever. Every design
choice below is downstream of that.

---

## 1. Repository model: overlay, not fork

`tomorrows-ash` does **not** contain AzerothCore's git history. It contains
only what we wrote, plus an exact upstream commit pin:

```
tomorrows-ash/
├── upstream.json              pinned AzerothCore commit  <-- the whole upstream contract
├── tools/ta.py                fetch, build, db, run  (Windows + Linux)
├── modules/mod-classless/     our AzerothCore module (C++ + SQL + conf)
├── realm/ashmorrow/           realm-specific data and config
├── web/                       public website (separate service, own lifecycle)
├── docs/                      research, decisions, roadmap
└── .acore/                    fetched at bootstrap, GITIGNORED, never committed
```

`tools/ta.py bootstrap` clones AzerothCore at the pinned commit into `.acore/`
and links `modules/mod-classless` into `.acore/modules/` so AzerothCore's CMake
discovers it (it globs subdirectories of `<core>/modules`, see
`.acore/CMakeLists.txt:72`).

Linking preference, in order: symlink → Windows directory junction (`mklink /J`,
needs no admin rights) → plain copy. If it falls back to copy, `ta.py sync`
re-copies after edits; the tool tells you when that happens.

**Why not fork AzerothCore's history?**

| | Fork the core | Overlay (chosen) |
|---|---|---|
| Repo size | ~1 GB+ | a few MB |
| Upstream bump | `git merge upstream/master`, resolve conflicts across a tree you don't own | edit one SHA in `upstream.json` |
| "How much have we diverged?" | hard to answer | **exactly what's in this repo** |
| Contributor onboarding | standard AzerothCore workflow | must learn `ta.py` |
| Core C++ patches | trivial | needs a patch series (we have none — see §2) |

The deciding factor is the last row. The Phase 0 investigation
(`CLASS-RESTRICTIONS.md`) established that **we need zero core patches**, which
removes the only real advantage of forking. If that changes, we add a
`patches/` directory of `git apply`-able diffs and `ta.py bootstrap` applies
them — the model degrades gracefully rather than breaking.

**This is a reversible decision.** Converting overlay → fork later is a
mechanical operation; converting fork → overlay after a year of drift is not.

---

## 2. Zero core modifications

The classless system changes no AzerothCore C++ source. It works because of
three facts established in `CLASS-RESTRICTIONS.md`:

1. `Player::learnSpell()` has **no class check** — any character can be taught
   any spell already.
2. `OnPlayerCalculateTalentsPoints` lets a module set the talent budget to zero,
   retiring the Blizzard talent tree without touching the core.
3. Item class restrictions live in `item_template.AllowableClass` — **SQL**, not
   code.

So the classless system is:
- a **module** for logic and UI, and
- **SQL migrations** for data.

Boolean script hooks (`OnPlayerCanX`) can only **veto**, never grant
(`ScriptMgrMacros.h:76`). Any loosening must therefore come from data or from a
new acquisition path we own — never from a hook. This is the single most
important rule when designing new features here.

---

## 3. We do not reuse Blizzard's talent frame

The 3.3.5a client draws the talent window from its own local DBCs, keyed to the
character's class. A Warrior client will not render a Frost tree no matter what
the server permits. Patching the server here achieves nothing without also
shipping a custom client MPQ that every player must install.

For a server that intends to be **publicly playable**, "install our client
patch" is a serious adoption tax. So:

| Phase | Ability UI | Client requirement |
|---|---|---|
| 1–3 | **NPC gossip menus** + chat commands | none — vanilla client works |
| later (optional) | custom addon panel (AIO) | players install an addon |
| last resort | custom talent trees | players install an MPQ patch |

Gossip is ugly but universal. We start there and earn the right to something
prettier.

---

## 4. Module design rules

`modules/mod-classless` follows three non-negotiable rules:

**Fail-safe by default.** Every hook returns early unless `Classless.Enable` is
`1`. Dropping this module into a stock realm must change nothing. This is what
makes it safe to test against upstream.

**Own your tables.** The website follows this rule too: everything it owns
lives in its own `ashmorrow_web` schema, and it never adds a column to an
AzerothCore table.

Module state lives in module-prefixed tables
(`classless_*`) in the `characters` and `world` databases, applied from
`modules/mod-classless/data/sql/db-{world,characters}/`. AzerothCore's updater
picks these up automatically. We never add columns to core tables.

**Data over code.** Ability trees, costs and prerequisites are *rows*, not
`switch` statements. Rebalancing must not require a recompile — a public server
needs to tune without a maintenance window.

---

## 5. Skill-point budget (Phase 2 design sketch)

Not yet implemented. Recorded here so Phase 1 doesn't paint us into a corner.

```
classless_tree        id, name, description            -- Fire, Frost, Sword Mastery, Stealth...
classless_node        id, tree_id, spell_id, tier, cost, requires_node_id
classless_character    guid, points_total, points_spent -- per character
classless_character_node guid, node_id, rank            -- what they bought
```

The website's armory is already written against this sketch and asks for two
additions — `classless_node.name` and `classless_node.max_rank`
([ADR 0004](decisions/0004-website.md)). Both are optional: it probes for them.

- Budget derives from level (a curve, config-driven), **not** from Blizzard
  talent points, which are suppressed via the hook.
- Respec = delete rows in `classless_character_node`, refund `points_spent`,
  `removeSpell` each granted spell.
- Grants go through `Player::learnSpell()`, which is already unguarded.

**Known trap** (from `CLASS-RESTRICTIONS.md` §5): `learnSpell` auto-learns
rank chains and dependent spells. Every node needs testing for what it drags
in, and spec-mask behaviour must be checked for abilities Blizzard classified
as talents.

---

## 6. The unsolved problem: hidden class chassis

A "classless" character still has a class underneath. Base stats, attack power
per Strength, spell power scaling, mana per Spirit, and armor proficiency all
come from that hidden class via `playercreateinfo_levelstats`,
`player_classlevelstats`, and hardcoded coefficients in
`Player::UpdateAttackPowerAndDamage()`.

A Mage who learns *Mortal Strike* still has a Mage's health, armor and weapon
scaling. **Balance will be dominated by the hidden class long before the
ability pool matters.**

Three ways out, none free:

1. **One chassis for everyone** — normalise every class's stat tables to a
   single neutral profile. Cleanest result, largest SQL surface, erases racial
   and class flavour entirely.
2. **Chassis as a visible choice** — keep classes as "body types" (Warrior =
   tough, Mage = fragile) and let abilities be free. Least work, preserves
   variety, but some chassis+ability combos will be strictly better.
3. **Normalise via auras** — a module-applied hidden aura corrects stats at
   runtime. Flexible and reversible, but adds a permanent aura to every player
   and fights the core's own scaling.

**This is a product decision, not an engineering one**, and it should be made
before Phase 2 because it determines what the skill-point budget is balancing.
