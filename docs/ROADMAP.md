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

## Phase 1 — Data-only prototype (next)

Prove the concept end to end with the smallest believable slice.

- Gossip NPC ("Ashmorrow Ability Broker") that teaches a handful of
  deliberately off-class abilities — e.g. *Fireball* to a Warrior,
  *Mortal Strike* to a Mage.
- Module tables (`classless_tree`, `classless_node`) so abilities are **rows,
  not code**.
- Verify what `learnSpell` drags in: rank chains, dependent spells, spec masks
  (see [research §5](CLASS-RESTRICTIONS.md#5-risks-this-investigation-surfaced)).
- Confirm off-class abilities actually *work* — cast, scale, and don't crash —
  rather than merely appearing in the spellbook.

**Exit criteria:** a Warrior casts Fireball, a Mage casts Mortal Strike, both
survive a relog, and we know exactly which spells cascade.

**Risk to watch:** an ability may be silently useless off-class — a Mage's
*Mortal Strike* scaling off attack power the Mage doesn't have. That is the
first real evidence about the balance problem below.

---

## Phase 2 — Skill-point budget

The real system. Blocked on **[the chassis question](#open-questions)**.

- Budget curve by level, config-driven.
- Retire Blizzard talents via `OnPlayerCalculateTalentsPoints` (already wired,
  behind `Classless.SuppressBlizzardTalents`).
- Spend / respec / refund through gossip.
- Migration for characters with spent talent points.
- Tree and node data for the real ability pool.

**Two schema requests from the website**, which is already written against the
[§5 sketch](ARCHITECTURE.md#5-skill-point-budget-phase-2-design-sketch) and
degrades gracefully without them:

- `classless_node.name` — spell names live in the client's DBC files and never
  reach the server database, so without this the armory can only print
  `Ability #133`.
- `classless_node.max_rank` — otherwise a rank cannot be shown as progress.

`web/sql/dev-fixture.sql` writes the expected schema out in full, and
`web/src/lib/build.ts` probes `information_schema` rather than assuming either
column exists.

---

## Phase 3 — Itemization

Removing class restrictions breaks gear assumptions.

- Rewrite `item_template.AllowableClass` as a **generated, reversible**
  migration — tens of thousands of rows, never hand-edited.
- Armor and weapon proficiency: which are bought with skill points, which are
  free.
- Audit stat budgets: plate with spell power, cloth with strength, and the
  class-specific set bonuses that assume a class.

---

## Open questions

Product decisions I need from you. Engineering can't settle these.

### 1. Client version — **blocking Phase 2**

We're on AzerothCore, so players use the **3.3.5a (WotLK) client**. There is no
maintained "AzerothCore Classic" — the repo of that name has been dead since
2017 and has no module system ([ADR 0001](decisions/0001-base-core.md)).

- Happy with 3.3.5a? Optionally add vanilla-content gating (`classic-mode` SQL
  or `mod-individual-progression`).
- Need the **true 1.12 vanilla client**? That means VMaNGOS or CMaNGOS, no
  module system, and a permanent core fork.

### 2. The hidden class chassis — **blocking Phase 2**

A classless character still has a class underneath supplying base stats, attack
power per Strength, mana per Spirit and armor proficiency. **Balance will be
dominated by the hidden class long before the ability pool matters.**

Options, in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-the-unsolved-problem-hidden-class-chassis):

1. One neutral chassis for everyone — cleanest, largest SQL surface, erases flavour.
2. Chassis as a visible choice ("body type") — least work, keeps variety, some
   combos will be strictly better.
3. Runtime normalisation via a hidden aura — flexible, fights the core's scaling.

### 3. Ability UI ambition

Phases 1–3 use gossip menus: universal, works on an unmodified client, plain.
A custom addon panel is much nicer but players must install it. Worth it, and
when?

### 4. Character creation

Class still has to be picked at creation. Do we present it as a **body type**,
hide it behind a neutral label, or leave it as-is for now?
