# Roadmap

Phases are delivered one at a time, each ending in a written report. Nothing
below is a commitment to a date.

---

## Phase 0 — Foundation ✅ complete

- [x] Choose a base core on evidence ([ADR 0001](decisions/0001-base-core.md))
- [x] Repository structure and upstream pin ([ADR 0002](decisions/0002-repo-layout.md))
- [x] Cross-platform tooling (`tools/ta.py`)
- [x] Server builds in the cloud sandbox
- [x] Realm named **Ashmorrow**
- [x] Map how class restrictions are enforced ([research](CLASS-RESTRICTIONS.md))
- [x] `SETUP.md` for Windows and Linux
- [x] `mod-classless` skeleton — registers, compiles, changes nothing
- [x] Public website in `web/` ([ADR 0004](decisions/0004-website.md)) — landing,
      accounts, armory, rankings, realm status, wiki, patch notes

**Key finding:** zero core C++ modifications are needed. See the research doc.

---

## Phase 1 — Data-only prototype ✅ built, play test pending

- [x] `classless_tree` / `classless_node` tables — abilities are rows, not code
- [x] Ashmorrow Ability Broker gossip NPC (entry 900000)
- [x] GM commands for testing (`.classless trees/list/learn/status/reload`)
- [x] Prototype data: 5 trees, 10 deliberately off-class abilities
- [x] `tools/spell_cascade.py` — what does granting a spell drag in?
- [x] Verified loading in a live server: `[Classless] Loaded 5 trees, 10 abilities`
- [ ] **In-game play test — blocked on client data (needs your WoW client)**

Findings in **[PHASE1-FINDINGS.md](PHASE1-FINDINGS.md)**. Headlines:

- **Cascades are a non-issue.** Both recursion branches in `learnSpell` require
  the spell to be *already known*, so granting an ability to someone who does
  not have a higher rank drags in nothing. Phase 2 needs no cascade accounting.
- **Nothing gates ability level — anywhere.** Zero level checks in the whole
  learn path, and no level gate at cast time either. Our `required_level`
  column is the only thing stopping a level 1 character casting rank 12
  Fireball.
- **Spec masks unresolved** — needs `Talent.dbc`, so it needs your client.
  Mortal Strike is in the prototype specifically as that test case.

---

## Phase 2 — Skill-point budget ⏳ mechanism built

The budget mechanism is independent of the body-type numbers, so it was built
while those await sign-off.

- [x] Budget curve by level, config-driven and **derived, never stored** — so
      re-tuning re-prices the realm with no migration
- [x] Cost enforcement, with saturating arithmetic for over-budget characters
- [x] Respec that refunds points and removes only spells **we** granted
- [x] Gossip shows the budget and offers respec; `.classless points` / `respec`
- [x] Blizzard talent suppression wired (still defaulted off)
- [ ] **Body-type stat deltas** — blocked on [BODY-TYPES.md](BODY-TYPES.md) sign-off
- [x] **Real tree data** — 10 trees, 50 abilities, 200 points (36% affordable at
      level 80, inside the approved 30–50% band). Every spell verified against
      the world DB by `tools/gen_trees.py`, which refuses to emit SQL otherwise.

Details in **[PHASE2-BUDGET.md](PHASE2-BUDGET.md)**. The finding that matters:

Pricing is settled: the pool costs **200 points** against 71 at level 80, so a
maxed character affords **36%** of it. Scarcity is real — points buy depth or
breadth, never both.

**What the website needs from this phase.** Its armory already reads the
Phase 1 tables and renders real builds. Two things would light up display it
already contains:

- A **rank** column on `classless_character_node`, if ranks arrive. The armory
  falls back to "bought" without one and switches to ranked pips the moment it
  appears.
- **`classless_character`** (`points_total`, `points_spent`). It gives the
  spend bar an unspent remainder and turns on the "deepest builds" ranking,
  which currently explains that it is waiting for exactly this.

Neither is assumed: `web/src/lib/build.ts` probes `information_schema` first,
so adding them is a behaviour change rather than a coordinated release.

---

## Phase 3 — Itemization

Removing class restrictions breaks gear assumptions.

- Rewrite `item_template.AllowableClass` as a **generated, reversible**
  migration — never hand-edited. Measured scope on the current world DB:
  **10,936 class-restricted items**, of which **8,489 are armor or weapons**
  (the rest are consumables and quest items). 35,160 items are already
  unrestricted (`-1`).
  Note `AllowableClass` is signed and `-1` means "all classes".
- Armor and weapon proficiency: which are bought with skill points, which are
  free.
- Audit stat budgets: plate with spell power, cloth with strength, and the
  class-specific set bonuses that assume a class.

---

## Decisions made

| # | Question | Decision |
|---|---|---|
| 1 | Client version | **3.3.5a WotLK.** True vanilla would mean permanent core forks against VMaNGOS/CMaNGOS, fighting the maintainability goal. |
| 2 | Hidden class chassis | **Visible "body type"** (option 2). Numbers pending sign-off — [BODY-TYPES.md](BODY-TYPES.md). |
| 3 | Ability UI | **Gossip menus for now.** Revisit a custom addon once there are real players to justify the install friction. |

## Open questions

### 1. Body-type numbers — **blocking Phase 2**

Concrete stat deltas are in **[BODY-TYPES.md](BODY-TYPES.md)** and need your
approval. Two sub-decisions in there matter as much as the numbers:

- **Three body types or all ten classes?** (I recommend three.)
- **Is armor proficiency purchasable?** If it is, the three body types collapse
  into one, because proficiency is just a spell.

### 2. Rank progression — the next authoring pass

Rank chains run to 16 entries and a node grants exactly one rank. Either a node
per useful rank, or one node whose rank scales with level. I lean towards
scaling. Detail in [PHASE1-FINDINGS.md §7](PHASE1-FINDINGS.md).
