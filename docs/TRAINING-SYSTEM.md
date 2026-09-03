# Training system — mastery points

**Status:** signed off. Schema and the trainer strip are **applied**; the C++
that earns and spends mastery is **not written yet** (§7).

One thing changed under validation and is flagged where it happened: the
per-quest grant is now **capped per character level**, because the measured
quest pool would have blown through the ceiling. The approved targets — ~400
for a focused build, ~800 for a completionist, 1,250 out of reach — are
unchanged; the mechanism that delivers them is fixed.

**Decided by the product owner:** ranks are bought with a **second currency**,
earned by playing rather than by levelling or by paying gold. Skill points buy
*which* abilities; mastery points buy *how strong* they are. Rank 1 still comes
with the tree purchase.

Every number below comes from the live world database. Reproduce with
`tools/gen_trees.py` and the queries quoted inline.

---

## 1. What is actually wrong today

`classless_node` holds one spell per node and `gen_trees.py` picked the rank 1
spell. Fireball is rank 1 at level 80 — about 30 damage where rank 16 does
roughly 900. It is not a bug; it is the data model working as documented, and
it makes every tree unplayable past the low twenties.

| | |
|---|---:|
| nodes | 50 |
| …with a rank chain | **42** |
| rank 2+ purchases available across all chains | **363** |
| chain length: min / median / max | 3 / 9 / 16 |
| ranks with no stock level requirement | **0** |

That last row is the important one: **every rank already carries a level gate
and a price in `trainer_spell`**, so requirement 4 (keep Blizzard's level
pacing) needs nothing invented.

---

## 2. The cost curve: price a rank by its level, not its number

The obvious reading of "early ranks cheap, late ranks expensive" is to charge
by rank ordinal — rank 2 costs 1, rank 14 costs 13. Measured against the real
chains, that goes wrong:

| curve | cheapest chain | median | dearest chain |
|---|---:|---:|---:|
| `cost = rank − 1` (ordinal) | 3 | 36 | **120** (Fireball) |
| `cost = 1 + ⌊level/10⌋` (level gate) | 8 | **50** | 79 (Frostbolt) |

The ordinal curve charges **forty times more** for Fireball than for the
cheapest ability, purely because Fireball has a long chain. But a long chain is
not a luxury — Fireball, Frostbolt and Heroic Strike have long chains precisely
because they are the abilities you press constantly. Charging most for the
workhorse is backwards.

**Price by the rank's stock level requirement instead:**

```
cost = 1 + floor(required_level / 10)
```

| rank available at level | mastery cost |
|---|---:|
| 1–9 | 1 |
| 10–19 | 2 |
| 20–29 | 3 |
| … | … |
| 70–79 | 8 |
| 80 | 9 |

A level-70 rank costs 8 whatever ability it belongs to. That is legible, it
tracks power rather than an ordinal accident, and it uses Blizzard's own
progression as the reference — the same move the tree costs already make.

Full Fireball chain: **77**. Median ability: **50**. Cheapest: 8.

**The curve lives in a table**, not in code, so it is retunable on a live realm
(`docs/ARCHITECTURE.md`, "data over code").

---

## 3. Ultrathink: where mastery points come from

This is the part with no existing data to lean on, so the reasoning matters
more than the numbers.

### The trap to avoid

Ranks are not a power *luxury*. A rank-1 Fireball at level 60 is not a weaker
build — it is a broken one. So if mastery is scarce and ranks are the only way
to stay current, players will feel **forced** to grind, and the classless
promise ("take abilities from anywhere") collapses into "take abilities from
anywhere and they are all useless".

That gives the governing principle:

> **Scarcity must bite on breadth, never on core competence.**
> A player who quests to 80 and does nothing else must be able to keep their
> chosen handful of abilities current. Extra content buys *more* abilities kept
> current — never the difference between working and not working.

### What the budget has to hit

The tree budget at level 80 is 71 points, and the cheapest 25 nodes cost 70 —
so a level-80 character owns **at most 25 of the 50 nodes**. At a median 50
mastery per fully-ranked ability:

| keeping this many abilities fully current | mastery needed |
|---|---:|
| 6 | 300 |
| **8** | **400** |
| 12 | 600 |
| 16 | 800 |
| all 25 owned | 1,250 |

So the design targets are: **~400 from questing alone** (the floor, guarantees
a focused build), **~800 for someone who does everything** (breadth is earned),
and **1,250 out of reach** (nobody maxes everything).

### The sources

**1. Quests — the spine. `+1` per non-repeatable quest whose level is within 5
of the character's, capped at `+5` per character level.**

The cap is the correction validation forced, and it is worth being precise
about why the first version was wrong.

Measured: **5,786 non-repeatable, non-daily quests at levels 1–80 are reachable
by a single Alliance character** (5,589 for Horde) — not the 400–700 I
estimated, which was what a *typical run completes*, a different quantity
entirely. An uncapped `+1` per quest would let a completionist earn several
thousand mastery against the 1,250 that maxes every ability a level-80 can own.
The supply would have overshot the ceiling by more than double: precisely the
outcome the whole design exists to prevent.

**So questing is capped per character level.** The quests are the means, the
level is the pacing. `+5` per level reaches ~400 by level 80 — a focused,
eight-ability build, exactly the approved floor — and questing past the cap
earns nothing, which also removes any reason to farm low-level zones.

This still satisfies "not derived from level alone": levelling grants nothing
by itself. You must do the content; the level only bounds how much of it counts.

**Repeatables and dailies are excluded** (466 daily quests exist). Include them
and dailies become an infinite farm, which destroys the ceiling by a different
route.

**2. First-time dungeon boss kills — `+2` each, outside the cap.**

612 instance encounters are loaded on this realm. A player who runs the
dungeons of their level range as they go earns a few hundred over 1–80. It is
one-time per boss per character, so it rewards *seeing content*, not repeating
it. This is the main breadth lever, and it is the group-play path.

**3. Exploration — `+1` per 10 newly discovered areas.**

Small, solo-friendly, and flavourful. It exists so a player who does not group
still has a path to breadth that is not "quest more".

**4. A weekly — `+5`, once per week.**

The catch-up and retention lever. Someone who returns after a break, or who got
unlucky with groups, closes the gap without grinding. Rate-limited by time, so
it cannot be farmed.

### Why not the alternatives

- **Purchase with gold** — excluded by the owner, and rightly: it would tie
  ability power to the economy and to whoever farms best.
- **Derived from level** — that is just automatic upgrade with extra steps, and
  removes the second axis entirely.
- **Unbounded repeatables** — the ceiling collapses; everyone converges on
  maxing everything, and the choice the whole project is built on disappears.
- **Achievements** — a rich source and a big surface. Worth a later look, not
  worth the balance risk in v1.

### What validation found, and what is still unmeasured

The estimate was checked and it was wrong in the way that mattered — see above.
The fix (a per-level cap) makes the supply **independent of how many quests
exist**, which is the property the design needed all along: it can no longer be
broken by content volume.

Still unmeasured: **how many level-appropriate quests a character actually
completes per level**. If it is reliably above 5, everyone caps out and the
floor is guaranteed. If some levels come up short — a level gained mostly from
dungeons, say — those players fall behind the floor. Nobody has levelled on the
realm yet, so this is open:

```sql
-- once somebody has levelled
SELECT COUNT(*) FROM character_queststatus_rewarded WHERE guid = <yours>;
SELECT source, at_level, SUM(amount) FROM classless_mastery_log
 WHERE guid = <yours> GROUP BY source, at_level ORDER BY at_level;
```

The second query is why `classless_mastery_log` records `at_level`: the cap
should be tuned from where it actually binds, not from a guess. If levels do
come up short, the answer is to raise the cap or let unused cap carry forward
— both are single-row changes.

---

## 4. Schema — additive, and the existing contract is untouched

Nothing about `classless_character_node` or its `cost_paid` column changes, so
the website's spend join and its documented "no ranks" assumption keep working
exactly as they do now.

```sql
-- Earned total. This one MUST be stored: it is a history of events, not a
-- function of level, so unlike the skill-point budget it cannot be derived.
CREATE TABLE classless_character_mastery (
  guid    INT UNSIGNED NOT NULL,
  earned  INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (guid)
);

-- One row per rank bought. `spent` is DERIVED by summing cost_paid here,
-- exactly as points spent is derived from classless_character_node.
CREATE TABLE classless_character_rank (
  guid       INT UNSIGNED     NOT NULL,
  node_id    INT UNSIGNED     NOT NULL,
  rank       TINYINT UNSIGNED NOT NULL,
  spell_id   INT UNSIGNED     NOT NULL,   -- the rank's own spell
  cost_paid  INT UNSIGNED     NOT NULL,   -- price PAID, never the current price
  learned_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guid, node_id, rank)
);

-- Where mastery came from. Audit, plus it is how the weekly is rate-limited.
CREATE TABLE classless_mastery_log (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guid      INT UNSIGNED    NOT NULL,
  source    VARCHAR(32)     NOT NULL,   -- quest | boss | exploration | weekly
  amount    INT             NOT NULL,
  ref_id    INT UNSIGNED    NOT NULL DEFAULT 0,  -- quest/encounter id
  earned_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY (guid, source), KEY (guid, earned_at)
);

-- The curve, as rows. Retunable without a recompile.
CREATE TABLE classless_rank_cost (
  min_level TINYINT UNSIGNED NOT NULL,
  cost      INT UNSIGNED     NOT NULL,
  PRIMARY KEY (min_level)
);

-- The sources, as rows. Same reason.
CREATE TABLE classless_mastery_source (
  source  VARCHAR(32)      NOT NULL,
  amount  INT              NOT NULL,
  enabled TINYINT UNSIGNED NOT NULL DEFAULT 1,
  note    VARCHAR(255)     NOT NULL DEFAULT '',
  PRIMARY KEY (source)
);
```

> **Note on the "derived, never stored" invariant** (`CLAUDE.md §2`). It still
> holds where it was meant to: *spend* is derived, and the level-based skill
> budget is still computed on every read. Earned mastery is the one thing that
> genuinely cannot be recomputed, because it is a record of what a player did.
> Storing it is not an exception being smuggled in — it is a different kind of
> quantity, and the doc should say so.

**Cross-session contract:** this adds tables, it does not alter any. The
website session should still be told, because "points spent" and "how far
ranked" become different questions and the armory currently answers only the
first.

---

## 5. Rules that fall out of the design

- **Rank 1 is free**, granted by the tree purchase, as today.
- **A rank cannot be bought below its stock level**, even with points in hand.
  All 363 ranks have that data.
- **Ranks must be bought in order** — no skipping to rank 12.
- **Respec refunds mastery** spent on nodes being removed, in full. Mastery is
  earned by playing, and confiscating it for changing your mind would be
  punitive. Points spent on `granted = 0` nodes are still left alone.
- **The broker sells ranks**, on a per-ability page, showing cost, your pool
  and the level gate.

---

## 6. Decisions, now made

**a. The native-class asymmetry — decided: strip the ranks.** A Vanguard *is* a
Paladin, and `Trainer::IsTrainerValidForPlayer` compares `getClass()`
(`Trainer.cpp:209`), so Paladin trainers would sell a Vanguard every Paladin
rank for gold while every other discipline cost scarce mastery.

`2026_09_01_03_mastery_trainer_strip.sql` removes exactly the overlapping
rows — **419 of 6,417**, 402 distinct spells, across 14 trainers: every rank of
every chain a classless node heads. Trainers stay as NPCs and keep selling
everything else. The rule is now identical for all three body types: rank 1
from the tree, ranks 2+ from mastery, no way to buy around it.

Verified on a copy before applying: 419 removed, **0 tree-ability ranks still
sold**, 5,998 rows surviving, idempotent on a second run, and rollback restores
the table exactly. And the check that mattered most — **Plate Mail (spell 750)
is still sold by its 4 trainers**. It is a proficiency spell, not a tree
ability, so the armor ladder that locks plate to the Vanguard
(`BODY-TYPES.md §3`) is untouched. Had the strip caught proficiency spells it
would have quietly dismantled the body-type design.

**b. The weekly ceiling — approved as designed.** `+5`/week is 260 a year, so a
veteran eventually affords everything. Accepted as a reward for time played.

**c. Per-source amounts — validated, and one changed.** See §3: the quest grant
is capped per level because the pool is far larger than the estimate assumed.

---

## 7. What is built, and what is not

**Applied:**

| | |
|---|---|
| `2026_09_01_02_mastery_schema.sql` | the five tables, the cost curve, the sources |
| `2026_09_01_03_mastery_trainer_strip.sql` | 419 trainer rows removed |
| `2026_09_01_01_classless_body_type.sql` | body types as rows (§8) |

**Not written yet — this is the whole runtime half:**

- earning: hooks for quest completion (with the per-level cap), first boss
  kills, exploration, and the weekly
- spending: broker pages per owned ability, showing cost, pool and level gate
- enforcement: ranks bought in order, never below the stock level gate
- respec: refunding mastery for removed nodes, leaving `granted = 0` alone
- `.classless mastery` for inspection

None of it is verifiable without a client anyway. The schema is applied so the
migrations are settled and the shape is fixed; the code is the next phase.

---

## 8. Body type shown in game — shipped

Separate from the above, and already built. The client shows the underlying
class name (Paladin/Shaman/Mage) and nothing server-side can change that
(`BODY-TYPES.md §4`), so the realm now says it out loud instead:

```
[Ashmorrow] You are playing as: Vanguard (plate armor). Stands in front. ...
```

on every login, and in `.classless status`. A character whose class is not one
of the three — a GM's Warrior, or anything made before the creation restriction
worked — gets a warning instead, because nothing in the design applies to it.

The names live in `classless_body_type`, one row per body type, because they
are explicitly placeholders. Renaming Adept is an `UPDATE` and a
`.classless reload`, not a recompile.
