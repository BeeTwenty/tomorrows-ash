# Body types — proposed stat deltas for approval

**Status:** awaiting product-owner sign-off. Nothing here is implemented.
**Decision this implements:** chassis as a visible "body type" (option 2).

You asked for actual numbers rather than a strategy name. These are derived from
the live `player_class_stats` table at level 60, not invented.

---

## 1. The constraint that decides the design

Base stats at level 60, straight from the database:

| Class | BaseHP | BaseMana | Str | Agi | Sta | Int | Spi | Stat total |
|---|---|---|---|---|---|---|---|---|
| Warrior | 1689 | **0** | 120 | 80 | 110 | 30 | 45 | 385 |
| Rogue | 1523 | **0** | 80 | 130 | 75 | 35 | 50 | 370 |
| Death Knight | 1689 | **0** | 120 | 80 | 110 | 30 | 45 | 385 |
| Paladin | 1381 | 1512 | 105 | 65 | 100 | 70 | 75 | 415 |
| Shaman | 1423 | 1520 | 85 | 55 | 95 | 90 | 100 | 425 |
| Hunter | 1467 | 1720 | 55 | 125 | 90 | 65 | 70 | 405 |
| Druid | 1483 | 1244 | 65 | 60 | 70 | 100 | 110 | 405 |
| Warlock | 1414 | 1373 | 45 | 50 | 65 | 110 | 115 | 385 |
| Priest | 1397 | 1376 | 35 | 40 | 50 | 120 | 125 | 370 |
| Mage | 1370 | 1213 | 30 | 35 | 45 | 125 | 120 | 355 |

> **Warrior, Rogue and Death Knight have zero mana.** They run on rage and
> energy. A Warrior-chassis character who buys Fireball has no resource to cast
> it with — and the resource system comes from `ChrClasses.dbc`, which the
> *client* also reads, so it is not something we can quietly change server-side.

**This kills the obvious choice.** "Warrior body type" is the most intuitive
option on the menu and it is the one that cannot use half the ability pool.

**Recommendation: build all body types on mana-using classes.** Every discipline
stays castable from every chassis, and we never have to explain why Fire is
greyed out for one of the three options.

---

## 2. Proposed body types

Three chassis, mapped onto existing classes so that character creation, armor
proficiency and the client UI all keep working with no core changes.

| | **Vanguard** | **Skirmisher** | **Adept** |
|---|---|---|---|
| Underlying class | Paladin (2) | Shaman (7) | Mage (8) |
| Armor | Plate | Mail | Cloth |
| Feel | Stands in front | Trades blows and casts | Glass, but hits hardest |

### The numbers (level 60)

| Stat | Vanguard | Skirmisher | Adept |
|---|---|---|---|
| BaseHP | 1381 *(unchanged)* | 1423 *(unchanged)* | **1400** *(+30)* |
| BaseMana | 1512 *(unchanged)* | 1520 *(unchanged)* | **1500** *(+287)* |
| Strength | 105 *(unchanged)* | 85 *(unchanged)* | **45** *(+15)* |
| Agility | 65 *(unchanged)* | 55 *(unchanged)* | **45** *(+10)* |
| Stamina | 100 *(unchanged)* | **90** *(−5)* | **70** *(+25)* |
| Intellect | 70 *(unchanged)* | 90 *(unchanged)* | **130** *(+5)* |
| Spirit | 75 *(unchanged)* | 100 *(unchanged)* | **130** *(+10)* |
| **Stat total** | **415** | **420** | **420** |

Bold = changed from the stock value. Vanguard is deliberately left untouched as
the reference point.

### Why these specific deltas

**Adept +25 Stamina** is the important one. Stock Mage has 45 Stamina against
Paladin's 100. On a classless realm where a Vanguard can learn every Fire
ability anyway, a chassis that dies instantly is not a choice — it is a trap
nobody picks twice. +25 keeps it clearly the squishiest without making it
unplayable.

**Adept +287 BaseMana** brings it to parity (~1500). Stock Mage has the *least*
mana of any caster, which only made sense when Mages had mana-efficiency talents
we are not carrying over.

**Skirmisher −5 Stamina** is a trim, not a nerf: it equalises the stat total at
420 and pays for the fact that mail plus the best mana pool is already the
safest all-round pick.

**Stat totals land at 415/420/420** — near-identical budgets. The differentiator
becomes **armor class and stat distribution**, which is a real choice, rather
than one chassis being numerically better.

---

## 3. What I need you to decide

**a) Three body types, or all ten classes?**

Three means character creation offers three options and the other seven classes
are removed from `playercreateinfo` — a clean, comprehensible menu, and only
three stat lines to balance forever. Ten means more variety but seven more
balance problems, three of which (Warrior/Rogue/DK) cannot cast.

I recommend three. Adding a fourth later is a data change, not a rework.

**b) Is armor proficiency purchasable?**

Armor proficiency is granted by a *spell*, so an Adept could buy Plate from a
tree — and if they can, the three body types collapse into one. Options:

1. **Proficiency is fixed by body type** (recommended) — armor stays the real
   differentiator and the numbers above hold.
2. **Proficiency is purchasable but expensive** — flexible, but expect everyone
   to converge on plate.
3. **Proficiency is purchasable and cheap** — body type becomes cosmetic.

**c) Do you want the names?** Vanguard / Skirmisher / Adept are placeholders.

---

## 4. Risks

- **These are level 60 numbers.** The table is per-level, 1–80. Implementing
  means generating a full curve, which is a scripted migration and reversible.
- **Untested by play.** Nobody has played this. Expect the first real test to
  move Adept's Stamina again.
- **Changing `player_class_stats` affects existing characters** of those
  classes. On a fresh realm that is free; after launch it is a balance patch.
- **Racial stat modifiers still apply** on top (`player_race_stats`), so a Tauren
  Vanguard differs from a Human one. That is existing behaviour and probably
  desirable, but it means the totals above are a baseline, not the final spread.
