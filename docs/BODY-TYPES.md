# Body types — final

**Status:** approved. Three body types; armor proficiency locked to body type.
**Implements:** chassis as a visible "body type" (option 2).

Numbers are derived from the live `player_class_stats` table and from
AzerothCore's own stat formulas in `Entities/Unit/StatSystem.cpp`. Nothing here
is invented.

---

## 1. Two constraints decided the design

### Warrior, Rogue and Death Knight cannot cast

Base mana at level 80, from the database:

| Class | BaseHP | BaseMana |
|---|---|---|
| Warrior | 8121 | **0** |
| Rogue | 8127 | **0** |
| Death Knight | 8121 | **0** |
| Paladin | 6934 | 4394 |
| Shaman | 6939 | 4396 |
| Mage | 6963 | 3268 |

They run on rage and energy, and the resource system comes from
`ChrClasses.dbc`, which the *client* reads too — not something we can quietly
change server-side.

"Warrior body type" is the most intuitive option on the menu and the one that
cannot use half the ability pool. **All three body types are therefore built on
mana-using classes.**

### Casting is chassis-neutral. Melee is not.

This one inverts the assumption the project started with, so it is worth being
precise. Reading the core:

**Spell power** comes from `SpellBaseDamageBonusDone()`, which sums
`SPELL_AURA_MOD_DAMAGE_DONE` auras — that is, **gear and buffs**. There is no
baseline Intellect-to-spell-power conversion in 3.3.5.

> **An ungeared Vanguard and an ungeared Adept cast Fireball for identical
> damage.** Both have zero spell power. The Warrior-casting-Fireball problem
> the project expected does not exist at baseline; *gear* is what separates
> casters, which is precisely why armor proficiency has to stay locked.

**Melee attack power** is a different story
(`Player::UpdateAttackPowerAndDamage`):

```cpp
Paladin / DK / Warrior : AP = level*3 + Strength*2 - 20
Hunter / Shaman / Rogue: AP = level*2 + Strength + Agility - 20
everyone else          : AP = Strength - 10        // no level term at all
```

At level 80 with no gear:

| Body type | Underlying | Strength | **Attack power** |
|---|---|---|---|
| Vanguard | Paladin | 151 | **522** |
| Skirmisher | Shaman | 120 | **334** |
| Adept | Mage | 36 | **26** |

**A twentyfold gap.** The caster branch has no level term, so an Adept's melee
power barely moves from level 1 to 80.

So the asymmetry runs one way only:

| | Vanguard doing it | Adept doing it |
|---|---|---|
| Casting Fireball | same as anyone | same as anyone |
| Swinging a weapon | 522 AP | 26 AP |

**Melee is chassis-locked; casting is open to everyone.** Balance effort belongs
on the melee side of the pool, and the Adept should never be expected to melee.

---

## 2. The three body types

| | **Vanguard** | **Skirmisher** | **Adept** |
|---|---|---|---|
| Underlying class | Paladin (2) | **Hunter (3)** | Mage (8) |
| Armor | Plate | Mail | Cloth |
| Melee AP @80 | 522 | 334 | 45 |
| Ranged AP @80 | 80 | **224** | 45 |
| Feel | Stands in front | Trades blows and casts | Glass, but unrestricted |

Skirmisher moved from Shaman (7) to Hunter (3) — the only chassis triple in
which every race has a body type at all. See [ADR 0008 §10](decisions/0008-body-type-client-patch.md).
§2.1 below re-derives what that changed, which is less than it looks and one
thing more than expected.

### Level 80 anchor

| Stat | Vanguard | Skirmisher | Adept |
|---|---|---|---|
| BaseHP | 6934 | 6939 | **7100** *(+137)* |
| BaseMana | 4394 | 4396 | **4400** *(+1132)* |
| Strength | 151 | 120 | **55** *(+19)* |
| Agility | 90 | 74 | **55** *(+12)* |
| Stamina | 143 | **130** *(−6)* | **110** *(+51)* |
| Intellect | 98 | 128 | **190** *(+9)* |
| Spirit | 105 | 143 | **180** *(+6)* |
| **Stat total** | **587** | **595** | **590** |

### Level 60 anchor

| Stat | Vanguard | Skirmisher | Adept |
|---|---|---|---|
| BaseHP | 1381 | 1423 | **1400** *(+30)* |
| BaseMana | 1512 | 1520 | **1500** *(+287)* |
| Strength | 105 | 85 | **45** *(+15)* |
| Agility | 65 | 55 | **45** *(+10)* |
| Stamina | 100 | **90** *(−5)* | **70** *(+25)* |
| Intellect | 70 | 90 | **130** *(+5)* |
| Spirit | 75 | 100 | **130** *(+10)* |
| **Stat total** | **415** | **420** | **420** |

Bold = changed from stock. Vanguard is untouched as the reference point. The
migration generates the full 1–80 curve; these two levels are the anchors it is
checked against.

### Why these deltas

**Adept Stamina is the important one** (+51 at 80, +25 at 60). Stock Mage has
59 Stamina against Paladin's 143. Given the Adept already cannot melee at all
(26 AP), a chassis that also dies instantly is not a choice — it is a trap
nobody picks twice.

**Adept mana to parity** (+1132 at 80). Stock Mage has the *least* mana of any
caster, which only made sense alongside Mage mana-efficiency talents we are not
carrying over.

**Skirmisher Stamina trimmed** (−6): equalises the stat totals and pays for
mail plus the best mana pool already being the safest all-round pick.

Totals land at **587 / 595 / 590** — near-identical budgets. The differentiator
is armor and distribution, which is a real choice, not one chassis being
numerically better.

### 2.1 What the Hunter chassis changed

Re-derived against `Entities/Unit/StatSystem.cpp` at the pinned commit rather
than from memory. `Player::UpdateAttackPowerAndDamage` picks a formula by class:

| Formula | Classes |
|---|---|
| `level×3 + Str×2 − 20` | Paladin, Death Knight, Warrior |
| `level×2 + Str + Agi − 20` | **Hunter, Shaman**, Rogue |
| `Str − 10` | Mage, Priest, Warlock |

**Melee attack power does not change.** Hunter and Shaman are the same arm of
the same branch, so the Skirmisher's 334 at 80 and 240 at 60 are the numbers
either way. `CanUseItem`'s armour test pairs them too — both map to
`ITEM_SUBCLASS_ARMOR_MAIL` — so mail proficiency is likewise untouched. Two of
the three costs quoted when the swap was proposed turn out to be zero.

**Ranged attack power does change, and by a lot.** That formula is separate:

| Formula | Classes |
|---|---|
| `level×2 + Agi − 10` | Hunter |
| `level + Agi − 10` | Rogue, Warrior |
| `Agi − 10` | everyone else, Shaman included |

At 80 with 74 Agility that is **224 for a Hunter-chassis Skirmisher against 64
for a Shaman-chassis one** — and against 80 for the Vanguard. The mail chassis
goes from the *worst* ranged attack power of the three to nearly three times the
plate chassis's. Nobody chose that; it arrived with the class id.

Whether it should stay is a live question, not a settled one:

- **Keep it.** It gives the middle chassis an identity beyond "the compromise",
  and "trades blows" arguably covers a bow.
- **Neutralise it.** `OnPlayerIsClass` can answer the ranged branch as Shaman
  would — the same hook the pet decision uses, about thirty lines — so the swap
  becomes a pure availability change with no balance tail.

Not implemented either way. The swap was approved on availability grounds, and
this is a separate decision.

### 2.2 Correction: the Adept's melee attack power

The table above said 26. That was `Str − 10` computed against **stock** Mage
Strength (36), not the Adept's own 55, and the Adept's Strength is one of the
numbers this document changes. The right figure is **45**.

It matters mainly to §5's claim of a "20× AP spread": 522 ÷ 45 is **11.6×**, not
20×. The design point survives — an Adept still cannot melee — but the gap it
rests on is about half as wide as stated.

---

## 3. Armor proficiency is locked to body type

**Not purchasable. Not in any tree. No exceptions.**

Armor proficiency is granted by a spell, so it *could* be sold from a tree. It
must not be. Section 1 shows why: casting is chassis-neutral, so if an Adept
could buy Plate, every character would take the best offensive tree and wear
plate, and the three body types would collapse into one.

Armor is the mechanism that makes the choice cost something. It stays fixed at
character creation.

The same logic applies to anything else that would erase the distinction —
weapon skills that grant AP, or spells conferring proficiency. New nodes should
be checked against this rule before authoring.

---

## 4. Character creation

Three options. The other seven classes are removed from `playercreateinfo`.

Three keeps the menu comprehensible and the balance surface small enough for one
person to actually tune. A fourth later is a data change, not a rework.

Names — Vanguard / Skirmisher / Adept — are placeholders; say the word if you
want different ones.

---

## 5. Risks

- **The Skirmisher chassis carries hunter pet machinery, and it is turned off.**
  `Classless.Chassis.HunterPets = 0` answers `CLASS_CONTEXT_PET` as "no", so
  taming fails and the stable master declines. Before the swap nobody on this
  realm could tame anything; leaving it off keeps the swap to an availability
  change. If pets should exist here they belong in the trees, for every body
  type — a pet only Skirmishers have is a class wearing a different word.

- **Untested by play.** Nobody has played this. Expect the first real session to
  move the Adept's Stamina again.
- **`player_class_stats` changes affect existing characters** of those classes.
  Free on a fresh realm; a balance patch after launch.
- **Racial modifiers still stack on top** (`player_race_stats`), so a Draenei
  Adept differs from a Gnome one. Existing behaviour and probably desirable, but
  the totals above are a baseline rather than the final spread.
- **The melee gap is intentional but untested at the extremes.** An 11.6x AP
  spread (§2.2 — it was quoted as 20x from a stale figure) means Sword Mastery
  and Stealth are effectively Vanguard/Skirmisher-only trees. If that feels bad
  in play, the fix is stat deltas, not tree changes.
- **Spell crit from Intellect is unquantified.** `GetSpellCritFromIntellect()`
  reads `gtChanceToSpellCrit.dbc`, which needs extracted client data. The Adept
  will crit more than the Vanguard when casting; by how much is a measurement
  for the first play session.
