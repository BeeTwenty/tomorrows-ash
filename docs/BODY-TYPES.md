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
| Melee AP @80 | 522 | **395** | 45 |
| Ranged AP @80 | 80 | **331** | 45 |
| Feel | Stands in front | Trades blows and casts | Glass, but unrestricted |

Skirmisher moved from Shaman (7) to Hunter (3) — the only chassis triple in
which every race has a body type at all. See [ADR 0008 §10](decisions/0008-body-type-client-patch.md).
§2.1 re-derives what that changed; §2.3 is what it left undone.

> **The anchor tables below are Shaman's, and no longer describe the
> Skirmisher.** They were derived when the chassis was Shaman and have not been
> re-derived for Hunter. `player_class_stats` for class 3 is **stock and
> un-tuned** — see §2.3. Vanguard and Adept are correct.

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

### 2.1 What the Hunter chassis changed

Re-derived against `Entities/Unit/StatSystem.cpp` at the pinned commit rather
than from memory. `Player::UpdateAttackPowerAndDamage` picks a formula by class:

| Formula | Classes |
|---|---|
| `level×3 + Str×2 − 20` | Paladin, Death Knight, Warrior |
| `level×2 + Str + Agi − 20` | **Hunter, Shaman**, Rogue |
| `Str − 10` | Mage, Priest, Warlock |

**Correction (2026-09-02): melee attack power does change.** This section
previously said it did not, on the grounds that Hunter and Shaman share a
formula. They do — but the formula takes Strength and Agility, and those are
properties of the *chassis*, not the branch. Measured against the live table:

| | Str | Agi | `level×2 + Str + Agi − 20` |
|---|---:|---:|---:|
| Shaman (7) | 120 | 74 | 334 |
| **Hunter (3)** | 74 | 181 | **395** |

So melee AP rises about 18%, not zero. The armour claim does hold: both map to
`ITEM_SUBCLASS_ARMOR_MAIL`, so mail proficiency is genuinely untouched. One of
the three costs quoted when the swap was proposed is zero, not two.

**Ranged attack power does change, and by a lot.** That formula is separate:

| Formula | Classes |
|---|---|
| `level×2 + Agi − 10` | Hunter |
| `level + Agi − 10` | Rogue, Warrior |
| `Agi − 10` | everyone else, Shaman included |

**Corrected the same way.** The 224 above was computed with Shaman's 74
Agility against Hunter's formula. Hunter's own Agility is 181, so the figure is
**331** — against 64 for a Shaman-chassis Skirmisher and 80 for the Vanguard.

The mail chassis goes from the *worst* ranged attack power of the three to more
than four times the plate chassis's. Nobody chose that; it arrived with the
class id, and it is larger than the swap's write-up said.

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

### 2.3 The Skirmisher's anchor — approved 2026-09-02

One rule: **the Skirmisher's stat total equals the Adept's at each anchor, and
the whole difference goes to Stamina.** The Adept is the other tuned chassis;
the Vanguard is the untouched reference, so matching it would mean chasing a
number nobody set deliberately.

| level 80 | Str | Agi | Sta | Int | Spi | **total** |
|---|---:|---:|---:|---:|---:|---:|
| Vanguard — Paladin (2) | 151 | 90 | 143 | 98 | 105 | **587** |
| Skirmisher — Hunter (3) | 74 | 181 | **148** *(+20)* | 90 | 97 | **590** |
| Adept — Mage (8) | 55 | 55 | 110 | 190 | 180 | **590** |

| level 60 | Str | Agi | Sta | Int | Spi | **total** |
|---|---:|---:|---:|---:|---:|---:|
| Vanguard | 105 | 65 | 100 | 70 | 75 | **415** |
| Skirmisher | 55 | 125 | **105** *(+15)* | 65 | 70 | **420** |
| Adept | 45 | 45 | 70 | 130 | 130 | **420** |

Stamina rather than Agility on purpose: the chassis already gained 331 ranged
attack power from the swap (§2.1), and the free points go to surviving rather
than compounding a strength it did not ask for. Same reasoning as the Adept's
Stamina bump.

**One consequence worth naming:** this puts the Skirmisher's Stamina slightly
*above* the Vanguard's — 148 against 143 at 80, 105 against 100 at 60, about
50 HP. The plate chassis keeps a large armour lead so it is not a tanking
inversion, but the mail chassis is now marginally the beefier of the two on
paper. It falls out of the rule rather than being chosen; capping Stamina at
the Vanguard's and putting the remainder in Spirit is a one-line change if it
plays badly.

**Ranged attack power stays**, re-approved at the corrected 331 (§2.1). A mail
chassis with real ranged power is a coherent niche, and the same argument that
carried at 224 carries at 331.

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
CharacterCreating.Disabled.ClassMask = 1401
```

1401 is every playable class except Paladin (2), Hunter (4) and Mage (128):
1535 − 134. `ta.py conf` computes and writes it from `BODY_TYPE_CLASSES` in
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

### The classmask does not apply to GMs

`HandleCharCreateOpcode` only consults it when the account lacks RBAC
permission 15 (`CharacterHandler.cpp:344`):

```cpp
if (!HasPermission(rbac::RBAC_PERM_SKIP_CHECK_CHARACTER_CREATION_CLASSMASK))
{
    uint32 classMaskDisabled = sWorld->getIntConfig(CONFIG_CHARACTER_CREATING_DISABLED_CLASSMASK);
    if ((1 << (createInfo->Class - 1)) & classMaskDisabled)
        SendCharCreate(CHAR_CREATE_DISABLED);
}
```

Stock AzerothCore attaches that permission to `Role: Sec Level Moderator`
(194), and the roles nest — Administrator (192) → Gamemaster (193) →
Moderator (194) → Player (195). So **every account at gmlevel 1 or above
skips the check entirely**, while a gmlevel 0 player is blocked correctly.

On a realm run by its owner that is the worst possible split: the config is
right, the startup log says restricted, and the one account doing the testing
is the one the restriction does not apply to.

`data/sql/db-auth/2026_09_01_00_classless_creation_rbac.sql` removes the link,
so nobody skips it. `classless_rbac_backup` holds the removed row. The module
re-checks at startup and says so if it ever comes back.

### Verified in play

**2026-09-01, on the live realm, by a person at a client** — not by reading a
config or a log:

| attempted | result |
|---|---|
| Warrior (class 1, disabled) | refused |
| Paladin (class 2, Vanguard) | created |

Both halves matter. A restriction that refuses everything is not working
either. This is the first claim in the project confirmed by playing rather
than by loading.

Getting there took three wrong answers, all of the same shape — verifying a
thing that was next to the thing that mattered:

1. The value was right in the repo; the deployed config was never rewritten.
2. The deployed config was then right; **but the check is skipped for any
   account at gmlevel 1+**, which is every account an owner tests with.
3. Between those, a claim that RBAC had been ruled out — from a query written
   against the wrong column, whose empty result was read as proof.

### Confirming it is actually in effect

Two files can both be called `worldserver.conf`. On Windows
`ConfigMgr::GetConfigPath()` returns the *relative* `"configs/"`
(`Config.cpp:709`), so the one a server reads is chosen by the directory it was
launched from — and an MSBuild build leaves a second copy under
`build/bin/<Config>/configs/` on every build. A realm can be configured and
still run stock.

So do not trust the file. Ask the server:

```
[Classless] Config in effect: C:\...\dist\configs\worldserver.conf
[Classless] Character creation is limited to the three body types (CharacterCreating.Disabled.ClassMask = 1401).
```

Both lines are in `Server.log` next to the binary. The second is replaced by a
`CHARACTER CREATION IS NOT RESTRICTED` error naming every wrongly-creatable
class when it is not in effect. `ta.py doctor` lists every copy on disk with
its values; `ta.py conf` writes all of them.

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
pairs, so **the server** accepts all thirty race/body-type combinations.

> **Corrected 2026-09-01.** This section previously said "all ten races now
> reach all three body types — verified on the realm", with a table of ten
> races. That was a server-side fact written as a player-facing claim, and a
> playtest found it immediately: a Human still cannot select Skirmisher, and
> the client says *"You must choose a different race to be this class"*.
>
> **The client refuses before the server is ever contacted.** The creation
> screen is built from `CharBaseInfo.dbc` and the 3.3.5a client validates
> locally, so no `CMSG_CHAR_CREATE` is sent and no server-side change — these
> rows included — can affect it. The migration is correct and currently
> invisible.
>
> `tools/check_client_combos.py` reads the extracted DBC and prints, per race,
> which pairs the client will offer against which the server accepts. That is
> the only honest way to check this claim, and it needs extracted client data
> to run.

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
