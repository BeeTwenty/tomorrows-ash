# Training system — what the first playtest exposed, and what to build

**Status:** proposal. Nothing here is implemented. The two *bugs* found
alongside it are fixed and shipped; this document is about the design gap.

The first playtest reported four things about training. Two were bugs and are
fixed (`ValidateSkillLearnedBySpells`, and the character-creation config never
reaching the realm — see the commit and `BODY-TYPES.md §4`). The other two are
the same design gap seen from two angles, and they need a decision.

---

## 1. What is actually wrong

`classless_node` has **one spell per node**, and `tools/gen_trees.py` picked the
rank 1 spell for each. There is no rank column, by design — `CLAUDE.md §9`
records it as part of the website contract: *"there are no ranks (a node is
bought once)"*.

So a node is an ability, permanently at rank 1. Fireball stays rank 1 at level
80. That is not a bug in the code; it is the data model doing exactly what it
says. It is also unplayable past the low twenties.

Measured on the realm:

| | |
|---|---:|
| nodes | 50 |
| …with a rank chain | **42** |
| …single-rank abilities (Ice Block, Blast Wave, …) | 8 |
| mean chain length | 8.1 |
| longest chains | Fireball, Frostbolt — 16 ranks |

**The data to fix this already exists and needs nothing invented.** Every rank
of every node's chain appears in `trainer_spell` with both a level requirement
and a gold cost, which is where a normal class trainer gets them:

| ability | ranks | top rank at level | full chain cost |
|---|---:|---:|---:|
| Fireball | 16 | 78 | ~72g |
| Frostbolt | 16 | 79 | ~78g |
| Rejuvenation | 15 | 80 | ~68g |
| Heroic Strike | 13 | 76 | ~89g |
| Mind Blast | 13 | 79 | ~64g |

---

## 2. Three ways to do it

### A. Automatic upgrade

Buying the node grants the highest rank the character's level allows, and
levelling up upgrades it. No gold, no second visit.

*For:* simplest to build; the budget stays exactly as priced (200 points);
nothing to forget. *Against:* no gold sink; abilities silently get stronger,
which is the least legible option for a player; nothing to do at a trainer.

### B. Ranks are trained, like a real class *(recommended)*

Buying the node costs points and grants rank 1. Every later rank is bought from
the broker for **its own Blizzard gold cost, gated by its own Blizzard level
requirement**, straight out of `trainer_spell`.

*For:* it is what the report asked for — "train higher ranks the same way a
normal class does, rank-gated by level". Skill points stay the scarce currency
that chooses *which* abilities; gold and level drive *how strong*. Real gold
sink, ~65–90g per ability fully ranked. Uses Blizzard's own pacing, so nothing
is invented and nothing needs balancing. *Against:* more clicks; a returning
player has a backlog of ranks to buy.

### C. Hybrid — automatic, but charged

Ranks arrive on level-up and the gold is deducted, or held as a debt.

*For:* gold sink without clicks. *Against:* charging a player for something
they did not ask for is worse than either A or B, and debt is a whole subsystem.

---

## 3. What B costs to build

**Schema — additive, and deliberately not a change to the existing contract.**
`classless_character_node` keeps its shape, so the website's `cost_paid` join
and its "no ranks" assumption keep working untouched:

```sql
CREATE TABLE classless_character_rank (
  guid      INT UNSIGNED NOT NULL,
  node_id   INT UNSIGNED NOT NULL,
  spell_id  INT UNSIGNED NOT NULL,   -- the rank actually granted
  rank      TINYINT UNSIGNED NOT NULL,
  gold_paid INT UNSIGNED NOT NULL,
  PRIMARY KEY (guid, node_id, rank)
);
```

Ranks are read from `spell_ranks`, levels and prices from `trainer_spell`. No
new tree data, no re-pricing, no change to `classless_node`.

> **Cross-session contract.** `CLAUDE.md §6` makes the classless tables a shared
> contract with the website. This adds a table rather than altering one, so the
> armory keeps working as-is — but the website session should know the table
> exists, because "points spent" and "how far ranked" become different
> questions. Flag before merging.

**Module work:** a rank list in `ClasslessMgr`, a broker menu page per owned
node, gold deduction, and respec removing granted ranks alongside the node.
`granted = 0` still means "already knew it, never charged", so respec must keep
leaving those alone.

---

## 4. The spellbook category, honestly

Reported: broker-taught spells land under **General** rather than Affliction,
Holy, and so on.

The tab a spell appears in is not something the server picks. The 3.3.5a client
builds the spellbook from `SkillLineAbility.dbc` — spell to skill line — and
shows a tab per skill line the character *has*. A Vanguard has no Affliction
skill line, so Corruption has nowhere to go but General.

There is a plausible server-side fix — grant the skill line with the spell, via
`Player::SetSkill` — and it is **unverified**. Whether the client then draws an
"Affliction" tab on a Paladin is a client behaviour, and there is no client in
the build environment to try it in. It is also not free: skill lines feed
several other systems, so this needs to go behind a config flag and be tried in
play before it is trusted.

Worth saying plainly: this one is cosmetic. Everything works from General. It
should be the last of the four to be built, not the first.

**Related and no longer cosmetic:** the reason those spells have no valid skill
line for the character is the same reason
`Player::CheckSkillLearnedBySpell` was deleting them at every login. That is
fixed (`ValidateSkillLearnedBySpells = 0`), and it is worth understanding that
the "General" tab and the deletion were the same underlying fact.

---

## 5. What needs your sign-off

1. **A, B or C.** Recommendation: **B**, and the report already argues for it.
2. **Does gold cost come from `trainer_spell` unchanged, or scaled?** Blizzard's
   numbers assume one class's worth of abilities. A character buying ranks
   across five trees pays five times what a Mage does. Unchanged is the honest
   starting point and a real constraint on breadth — which the budget design
   already wants — but it is a balance call, not a technical one.
3. **The skill-line experiment for the spellbook tab** — try it behind a flag,
   or leave everything in General until there is a client addon?

Nothing here is built. Say which, and it becomes the next phase.
