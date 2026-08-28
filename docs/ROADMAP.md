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
- [x] **Body-type stat deltas approved** — three body types, armor proficiency
      locked to body type. Final numbers in [BODY-TYPES.md](BODY-TYPES.md)
- [x] **Real tree data** — 10 trees, 50 abilities, 200 points (36% affordable at
      level 80, inside the approved 30–50% band). Every spell verified against
      the world DB by `tools/gen_trees.py`, which refuses to emit SQL otherwise.

Details in **[PHASE2-BUDGET.md](PHASE2-BUDGET.md)**. The finding that matters:

Pricing is settled: the pool costs **200 points** against 71 at level 80, so a
maxed character affords **36%** of it. Scarcity is real — points buy depth or
breadth, never both.

**The website already reads this.** The armory renders real builds from
`classless_character_node`, takes points spent from `cost_paid`, and derives
the total budget with the same curve as `ClasslessConfig::BudgetForLevel`. The
"deepest builds" board ranks on those same rows.

One coupling to remember: the budget curve is derived, not stored, so
`CLASSLESS_POINTS_FIRST_LEVEL`, `_PER_LEVEL` and `_BONUS` in `web/.env.local`
must be changed alongside `Classless.Points.*` in `mod_classless.conf`. If
ranks are ever added, `web/src/lib/build.ts` already probes for a `rank` column
and will switch from "bought" to ranked pips on its own.

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

## Phase 4 — The launcher ✅ built, one part declined

A desktop launcher that verifies a player's own 3.3.5a client, writes the
realmlist, installs our patches, and launches the game — natively on Windows,
through Wine or Proton on Linux. It is the *recommended* route, never the only
one: the manual `realmlist.wtf` instructions stay documented forever.

- [x] Legal exposure assessed — [ADR 0005](decisions/0005-client-distribution.md)
- [x] Stack chosen and built — **Tauri 2**, [ADR 0006](decisions/0006-launcher-architecture.md)
- [x] Visual identity built — "Instrument", [LAUNCHER-DESIGN.md](LAUNCHER-DESIGN.md)
- [x] `launcher/core` — detection, tiered verification, config injection,
      patch install, Wine/Proton launch planning. 58 tests, no GUI dependency
- [x] `launcher/ui` — three views, 14 kB, runs in a browser without Tauri
- [x] `tools/ta.py play` — the same behaviour with no window and no Rust
- [x] Website endpoints — manifest, sign-in, account
- [ ] **Client hash manifest** — needs measuring against a real client; the
      launcher says so plainly until it exists
- [ ] **End-to-end test** — nothing here has yet compiled the Tauri shell
      (it needs WebKitGTK) or started a real client. Same blocker as Phase 1
- [ ] **Distribution: unresolved.** The product owner chose to host the client
      ourselves; that part is not built, and [ADR 0005 §10](decisions/0005-client-distribution.md)
      records the disagreement and the three ways out of it

Three findings worth carrying forward:

- **The gossip UI needs nothing injected.** ADR 0003 chose gossip menus so an
  unmodified client would work, and it does. The "patch injection" half of the
  brief is mostly empty, and that is a feature — the update channel exists and
  will report "nothing to install" for most of its life.
- **Auto-login stops at the account name.** The client runs its own SRP6
  handshake; a password could only be filled by writing into the running
  client's memory, which ADR 0005 rule 3 forbids and antivirus engines punish.
- **Verification has to be tiered.** Real 3.3.5a installs differ by locale,
  optional archives and repack history. Byte-exact equality with one reference
  copy would reject most genuine clients.

---

## Decisions made

| # | Question | Decision |
|---|---|---|
| 1 | Client version | **3.3.5a WotLK.** True vanilla would mean permanent core forks against VMaNGOS/CMaNGOS, fighting the maintainability goal. |
| 2 | Hidden class chassis | **Visible "body type"** (option 2). Numbers pending sign-off — [BODY-TYPES.md](BODY-TYPES.md). |
| 3 | Ability UI | **Gossip menus for now.** Revisit a custom addon once there are real players to justify the install friction. |
| 4 | Client distribution | **Unresolved.** Verify-only is built and shipping; self-hosting was chosen and not built — [ADR 0005 §10](decisions/0005-client-distribution.md). |
| 5 | Launcher stack | **Tauri 2** — Rust core, HTML interface. [ADR 0006](decisions/0006-launcher-architecture.md). |

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

### 3. Launcher: how players get a client — **unresolved**

Verify-only plus our own patch channel is built and shipping. Self-hosting the
client was chosen by the product owner and is not built;
[ADR 0005 §10](decisions/0005-client-distribution.md) records that plainly and
sets out the three ways forward. Nothing else in the launcher waits on it.

### 4. Nobody has run the launcher against a real client

`launcher/core` is tested and `ta.py play` was exercised against a synthetic
client, but the Tauri shell has never been compiled (it needs WebKitGTK) and no
real client has been started by either. The same blocker as Phase 1's play test:
it needs your machine and your client.

### 5. The repository has no `LICENSE` file

Noticed while working through ADR 0005. AzerothCore is AGPL-3.0 and the module
inherits it; the website and launcher are not derived from it and could be
anything. One licence across the repo is simpler to explain than three.
