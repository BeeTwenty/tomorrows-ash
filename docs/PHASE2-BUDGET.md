# Phase 2 — the skill-point budget

**Status:** mechanism built and verified loading. Costs are placeholders and the
budget is not yet a real constraint — see §4.

The budget is what replaces the class kit: instead of a Warrior being a Warrior,
a character is whatever their points bought.

---

## 1. The budget is derived, never stored

```
total     = (level - Points.FirstLevel + 1) * Points.PerLevel + Points.Bonus
spent     = sum of cost_paid over owned nodes
available = max(0, total - spent)
```

Nothing stores a running total. Re-tuning the curve in config re-prices every
character on the realm immediately, with no migration and no reconciliation
pass.

Defaults mirror Blizzard's talent shape — 1 point per level from level 10 — so
a level 80 character has 71 points.

**Over-budget characters are not force-respecced.** If the curve is tuned
downward below what someone already spent, `available` saturates to 0: they keep
everything, they simply cannot buy more until they respec or gain levels.
`.classless points` says so explicitly rather than showing a nonsense number.
(The saturation is deliberate — an unguarded `total - spent` on unsigned types
would read as roughly four billion available points.)

---

## 2. Respec must not steal abilities

The obvious implementation of respec — remove every spell we have a row for —
is wrong, and wrong in a way that silently destroys player characters.

A Mage who buys the Fire tree already knows Fireball. If respec calls
`removeSpell(133)`, it takes away an ability the Mage earned as a Mage, not one
we sold them.

Two guards:

**`classless_character_node.granted`** records whether we actually taught the
spell or the character already had it. Respec only removes what we granted.

**`CanLearn` refuses to sell a spell the character already knows**
(`LearnCheck::AlreadyKnowsSpell`). Charging points for something they already
have is pure waste, and it is also how the bookkeeping above gets muddied in the
first place. The menu shows those nodes greyed as "already yours".

**Known edge case:** a character buys a node, then later learns the same spell
from a trainer. Respec still removes it, because from our records we granted it.
Narrow, and it needs the classless system and normal trainers to overlap on one
spell. Worth revisiting if trainers stay enabled on the live realm.

---

## 3. Why `cost_paid` rather than the node's current cost

Spend is summed from what each purchase actually cost at the time, not from
today's price list. Re-pricing a node therefore applies to new purchases only.

The alternative — always summing current costs — means raising a node's price
retroactively pushes everyone who already bought it over budget. That is a
support problem on a public realm, and players reasonably expect that what they
paid is what they paid.

---

## 4. Pool pricing — resolved

The prototype's ten nodes cost 20 points against 71 at level 80, so the budget
constrained nothing. Real tree data now replaces it, priced to the approved
target:

| | |
|---|---|
| Trees | 10 |
| Abilities | 50 |
| **Pool cost** | **200 points** |
| Budget at level 80 | 71 points |
| **Affordable share** | **36%** — inside the approved 30–50% band |

Costs escalate by tier (2 / 3 / 4 / 5 / 6), so every tree costs 20 points to
complete and no tree is cheaper to rush than another. Each node requires the one
below it, so points buy depth or breadth but never both.

The direction was set deliberately: start tight and loosen through
`Classless.Points.PerLevel` if playtesting says so, rather than start loose and
have to claw power back from live characters.

### Every spell is verified

`tools/gen_trees.py` generates the migration and **refuses to emit SQL** if any
spell id cannot be proven to exist in the world database. Two proofs count:

- **`trainer_spell`** — the spell is trainable, and supplies an authoritative
  `ReqLevel` which becomes the node's `required_level`. 47 of 50 nodes.
- **`spell_ranks`** — the spell is a member of a rank chain, so it exists. Used
  for the 3 starting abilities no trainer teaches (Fireball, Heroic Strike,
  Blast Wave), whose levels are ours.

This matters because a node pointing at a non-existent spell takes a player's
points and silently gives them nothing. Re-run after any edit:

```bash
python3 tools/gen_trees.py            # verify, print the economics
python3 tools/gen_trees.py --write    # regenerate the migration
```

### Known limitation: the pool tops out at level 40

Abilities are drawn from trainer data, and the ones chosen sit between levels 1
and 40. Past level 40 a character earns points but unlocks no *new* tiers — the
remaining choice is which trees to broaden into.

That is a coherent design (points are the constraint, not levels), but it means
levels 40–80 currently offer no fresh ability tiers. Extending the trees upward
with higher spell ranks is the obvious next authoring pass, and the generator
makes it a data change.

## 5. Retiring Blizzard talents

`Classless.SuppressBlizzardTalents = 1` zeroes the talent budget through
`OnPlayerCalculateTalentsPoints`, emptying the built-in talent frame with no
core modification.

It is still **defaulted off**. It is now *safe* to enable — the replacement
exists — but enabling it on a realm with existing characters strands whatever
they already spent in the Blizzard tree. That needs a migration (refund plus
`.reset talents`) before it goes on anywhere real.

---

## 6. What is verified, and what is not

**Verified:** migration applies, config parses and logs the curve, module loads,
budget arithmetic checked against the curve, all symbols linked.

**Not verified — needs client data:** actually spending points, actually
respeccing, the gossip budget display, and the money cost path. The server
cannot start past `Failed to find map files` without extracted client data.

Test checklist additions for when you have a client:

```
.classless points              expect (level - 9) points at defaults
.classless learn 101           expect 1 point spent
.classless points              expect one fewer available
.classless learn 102           expect refusal below level 40
.classless respec              expect the spell gone and points back
.classless status              expect no red "MISSING FROM SPELLBOOK"

The one that matters most:
  on a MAGE, buy the Fire tree node for Fireball -> expect "already yours",
  refused. Then confirm the Mage still has Fireball after .classless respec.
  That is the ability-theft guard in §2.
```
