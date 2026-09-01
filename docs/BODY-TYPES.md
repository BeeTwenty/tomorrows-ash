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
| Underlying class | Paladin (2) | Shaman (7) | Mage (8) |
| Armor | Plate | Mail | Cloth |
| Melee AP @80 | 522 | 334 | 26 |
| Feel | Stands in front | Trades blows and casts | Glass, but unrestricted |

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

Bold = changed from stock. Vanguard is untouched as the reference point.

**Applied 2026-08-31** as `2026_08_31_01_body_type_class_stats.sql`, generated
by `tools/gen_body_types.py`. These two levels are anchors, not the curve: the
generator interpolates every level from no change at level 1, through the
level 60 row, to the level 80 row, and **refuses to emit** unless both anchors
come out exactly and no stat decreases with level. 74 of 80 Skirmisher levels
and 79 of 80 Adept levels differ from stock; `classless_class_stats_backup`
holds every original.

Between approval and that date the table was still stock, so the three body
types were numerically identical to Paladin, Shaman and Mage wearing new
names. Approving numbers and writing the migration had been treated as one
step.

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

**Corrected 2026-08-31.** This section previously said "the other seven classes
are removed from `playercreateinfo`". That was wrong twice over: it names the
worse of the two server-side levers, and it implies something the server cannot
do at all. Neither had been implemented. What follows is what the core actually
supports, verified against it.

### What stops the other seven classes

```ini
# worldserver.conf
CharacterCreating.Disabled.ClassMask = 1341
```

1341 is every playable class except Paladin (2), Shaman (64) and Mage (128):
1535 − 194. `ta.py conf` computes and writes it from `BODY_TYPE_CLASSES` in
`tools/ta.py`, so the number has one source, and
`tools/tests/test_body_types.py` re-runs the core's own expression over all ten
classes rather than restating the number.

The check is `WorldSession::HandleCharCreateOpcode`
(`CharacterHandler.cpp:346`):

```cpp
uint32 classMaskDisabled = sWorld->getIntConfig(CONFIG_CHARACTER_CREATING_DISABLED_CLASSMASK);
if ((1 << (createInfo->Class - 1)) & classMaskDisabled)
    SendCharCreate(CHAR_CREATE_DISABLED);
```

**Deleting `playercreateinfo` rows would also stop creation, and is the wrong
way to do it.** `Player::Create` would find no `PlayerInfo`, return false, and
log `Possible hacking-attempt: Account N tried creating a character ... with an
invalid race/class pair` — for every honest player who picked a class the menu
still offers them. The config path returns a real "disabled" response instead,
is reversible without a migration, and survives a world database re-import.
The rows stay.

### What the server cannot do: the menu

**The creation screen still lists all ten classes, and nothing server-side
changes that.** In 3.3.5a the class list, the race/class combinations and the
class *names* are all read from the client's own `CharBaseInfo.dbc` and
`ChrClasses.dbc`. There is no opcode that sends them — `Opcodes.h` has only
`CMSG_CHAR_CREATE` and `SMSG_CHAR_CREATE`, a request and its answer.

So on a stock client the experience is: pick Warrior, get told character
creation is disabled for that class. That is honest but poor, and there is
exactly one fix:

| Want | Needs |
|---|---|
| Refuse the seven classes | server config — **done** |
| Hide them from the menu | client patch: `CharBaseInfo.dbc` |
| Show "Vanguard" instead of "Paladin" | client patch: `ChrClasses.dbc` |
| New race/body-type combinations (below) | client patch: `CharBaseInfo.dbc` |

That patch is the launcher's job — our own content, distributed by us, which is
[ADR 0005](decisions/0005-client-distribution.md) rule 1 territory rather than
anything reconstructed from Blizzard files. Until it exists the realm is
playable but the menu lies about what it will accept.

### The race problem, which nobody had noticed

Body types are built on real classes, and real classes are not available to
every race. Measured on the world database:

| Races | Body types available |
|---|---|
| Draenei | **all three** |
| Human, Troll, Blood Elf | two |
| Orc, Dwarf, Undead, Tauren, Gnome | one |
| **Night Elf** | **none** |

A Night Elf can be neither Paladin, Shaman nor Mage, so on this realm a Night
Elf cannot be created at all. Most other races are locked to one body type,
which quietly makes race the real character choice and body type a consequence
of it — the opposite of the design.

**Only Draenei can currently make all three**, which is what the Phase 3
playtest should use.

**Decided 2026-08-31: add the rows.** Race is an independent choice, not a
body-type gate. `2026_08_31_02_body_type_race_coverage.sql` adds the 16 missing
pairs, so all ten races now reach all three body types — verified on the realm:

| race | body types |
|---|---|
| all ten | Vanguard, Skirmisher, Adept |

Each new pair starts where its own race starts (a Night Elf Vanguard begins in
Shadowglen), because `playercreateinfo` holds only a position and that position
is a property of the race — every class of a race shares it except the Death
Knight, who starts in Ebon Hold. Action bars are copied from a same-faction
race that already had that class. `classless_createinfo_added` lists every row
added, so the change can be undone.

**This is inert on a stock client, on purpose.** The creation screen will not
offer Night Elf Vanguard until `CharBaseInfo.dbc` lists it, so nothing changes
for a player today. The server accepting a combination the client does not yet
offer costs nothing and means the client patch is the only remaining step.

> **One thing to finish alongside that patch: starting gear.** The starting
> outfit comes from `CharStartOutfit.dbc`, keyed on race/class/gender
> (`Player.cpp:629`). Blizzard's file only has entries for the combinations the
> stock client offers, so a new pair will most likely be created with nothing
> equipped. `Player.cpp:665` then adds anything in `playercreateinfo_item` on
> top, which is the data-only fix — but the item lists have to be read out of
> the extracted DBC first, and there is no client in the build environment to
> read it from. Unverified, and it cannot bite until the client patch makes
> those pairs reachable.

Three body types keeps the menu comprehensible and the balance surface small
enough for one person to tune. A fourth later is a data change, not a rework.

Names — Vanguard / Skirmisher / Adept — are placeholders; say the word if you
want different ones. Note that changing them is a client patch too.

---

## 5. Risks

- **Untested by play.** Nobody has played this. Expect the first real session to
  move the Adept's Stamina again.
- **`player_class_stats` changes affect existing characters** of those classes.
  Free on a fresh realm; a balance patch after launch.
- **Racial modifiers still stack on top** (`player_race_stats`), so a Draenei
  Adept differs from a Gnome one. Existing behaviour and probably desirable, but
  the totals above are a baseline rather than the final spread.
- **The melee gap is intentional but untested at the extremes.** A 20x AP spread
  means Sword Mastery and Stealth are effectively Vanguard/Skirmisher-only
  trees. If that feels bad in play, the fix is stat deltas, not tree changes.
- **Spell crit from Intellect is unquantified.** `GetSpellCritFromIntellect()`
  reads `gtChanceToSpellCrit.dbc`, which needs extracted client data. The Adept
  will crit more than the Vanguard when casting; by how much is a measurement
  for the first play session.
