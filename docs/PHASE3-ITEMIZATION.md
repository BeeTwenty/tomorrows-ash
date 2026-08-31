# Phase 3 — itemization: what class restrictions on gear cost, and the fix

**Status:** shipped. All three decisions in §8 are made and carried out.

- **The 4,746-row pass is applied** — promoted to
  `data/sql/db-world/2026_08_31_00_item_unlock_allowable_class.sql` and run
  through AzerothCore's own updater on this realm.
- **Relics are open** behind `Classless.OpenRelicSlot`, via a module hook.
  `modules/mod-classless/src/ClasslessRelics.cpp`. Compiles, links, loads.
- **Glyphs are out of scope** for now — 246 dead rows, revisited at content
  scoping before launch, not before.

Everything numeric here came out of `acore_world` on this machine and is
reproducible:

```bash
python3 tools/audit_items.py                 # the whole report
python3 tools/audit_items.py --emit-sql      # regenerate the migration
python3 tools/audit_items.py --verify        # check a realm the pass ran on
```

---

## 1. The 8,489 figure is real, and it is the wrong number to act on

`SELECT COUNT(*) FROM item_template WHERE AllowableClass <> -1 AND class IN (2,4)`
returns exactly **8,489**. But that count includes rows whose mask restricts
nothing:

| | rows |
|---|---:|
| `item_template` total | 46,096 |
| carrying a class mask (`AllowableClass <> -1`) | 10,936 |
| …whose mask already admits all ten stock classes | 4,608 |
| …genuinely restrictive | 6,328 |
| weapons + armor carrying any mask — **the 8,489** | 8,489 |
| weapons + armor whose mask is genuinely restrictive | 4,758 |

The 4,608 no-op masks are values like `32767` and `262143` — every bit set,
including bits for classes that do not exist. `AllowableClass` is a **signed**
int where `-1` means "all classes", so those rows read as restricted but behave
as open. Acting on the raw 8,489 would rewrite 3,731 rows for no behavioural
change.

---

## 2. The actual bug is dead loot, and it is bigger than it looks

Ashmorrow has three body types, and each one *is* a stock class underneath
(`docs/BODY-TYPES.md §2`): Vanguard = Paladin (2), Skirmisher = Shaman (7),
Adept = Mage (8). The other seven classes are removed at character creation.

`AllowableClass` is still enforced, in `Player::CanUseItem`
(`PlayerStorage.cpp:2372`):

```cpp
if ((proto->AllowableClass & getClassMask()) == 0 || (proto->AllowableRace & getRaceMask()) == 0)
    return EQUIP_ERR_YOU_CAN_NEVER_USE_THAT_ITEM;
```

`getClassMask()` on this realm can only ever be 2, 64 or 128. So an item
restricted to Warrior, Rogue, Hunter, Priest, Warlock, Druid or Death Knight is
equippable by **no character on the realm**:

| | rows |
|---|---:|
| equippable by no body type | **3,678** |
| …of which weapons and armor | **2,849** |

That gear still drops, still appears in quest reward pickers, still sits in
vendor inventories and loot tables. A player rolls on it, wins it, and cannot
put it on. This is not a balance problem — it is 2,849 pieces of content that
are silently inert.

The rest of the restricted gear is not dead, just narrow: 1,902 rows are usable
by one or two body types and blocked for the others.

---

## 3. The class mask was never doing the job people think it does

This is the finding the whole proposal rests on, so it is worth being exact.

Two independent gates decide whether a character can equip an item:

1. **The class mask** — `AllowableClass`, pure data, checked at
   `PlayerStorage.cpp:2372`.
2. **Proficiency** — a *skill* (`ItemTemplate::GetSkill()`,
   `ItemTemplate.h:782`, maps armor subclass → `SKILL_CLOTH` / `SKILL_LEATHER`
   / `SKILL_MAIL` / `SKILL_PLATE_MAIL` / `SKILL_SHIELD`), checked at
   `PlayerStorage.cpp:2339`. The skill is granted by a spell.

Gate 2 already enforces the body-type armor ladder, entirely on its own. From
`playercreateinfo_skills` and the class trainers:

| | Vanguard | Skirmisher | Adept |
|---|---|---|---|
| cloth | start | start | start |
| leather | start | start | — |
| mail | start | train @40 | — |
| plate | train @40 | — | — |
| shield | start | start | — |

Plate Mail (spell 750) is sold by exactly four trainers, all `Trainer.Type = 0`
(class trainer) with `Requirement` 1 (Warrior) or 2 (Paladin). Mail (8737)
comes from Requirement 3 (Hunter) or 7 (Shaman). And the requirement check is:

```cpp
// Trainer::IsTrainerValidForPlayer, Trainer.cpp:209
case Type::Class:
case Type::Pet:
    return player->getClass() == GetTrainerRequirement();
```

`getClass()`, not `IsClass()` — so unlike the relic slot (§4) there is no
script hook anywhere in that path. **A Skirmisher can never learn Plate; an
Adept can never learn anything but cloth.** That is a property of the trainer
data and the core, not of any item row.

> **So the fix is removal, not re-tagging.** Nothing needs a body-type column.
> Clearing `AllowableClass` on weapons and armor hands the decision to the
> proficiency gate, which was always the one implementing the design.

---

## 4. What SQL cannot fix: relics

Librams, idols, totems and sigils (armor subclass 7–10, 250 rows) are the one
category where a data change does nothing. Their equip slot is chosen in
`Player::FindEquipSlot` (`PlayerStorage.cpp:220`):

```cpp
case ITEM_SUBCLASS_ARMOR_LIBRAM:
    if (IsClass(CLASS_PALADIN, CLASS_CONTEXT_EQUIP_RELIC))
        slots[0] = EQUIPMENT_SLOT_RANGED;
    break;
```

No matching class → no slot → the item cannot be equipped regardless of what
`AllowableClass` says. They are excluded from the pass, and five of them are
the only weapons/armor still dead after it runs (three Druid idols, two Death
Knight sigils).

**There is a way to open them without touching the core, and it contradicts
something this project wrote down as settled.** `Player::IsClass` is:

```cpp
// Player.cpp:1350
bool Player::IsClass(Classes unitClass, ClassContext context) const
{
    Optional<bool> scriptResult = sScriptMgr->OnPlayerIsClass(this, unitClass, context);
    if (scriptResult != std::nullopt)
        return *scriptResult;
    return (getClass() == unitClass);
}
```

and `ScriptMgr::OnPlayerIsClass` (`ScriptDefines/PlayerScript.cpp:570`) returns
the **first script that returns a value** — including `true`. This is not
`CALL_ENABLED_BOOLEAN_HOOKS`, and it is not veto-only. `CLAUDE.md §3` said
script hooks "can only grant permission by data, never by hook"; that is right
for the boolean hooks and **wrong for this one**. Corrected in place.

`ClassContext` (`UnitDefines.h:231`) has 18 distinct values, so a module can
answer only for `CLASS_CONTEXT_EQUIP_RELIC` and return `{}` for everything else
— leaving stats, talents, pets, graveyards and class trainers untouched. That
is a surgical override, not a blanket "everyone is every class".

**Written**, as `modules/mod-classless/src/ClasslessRelics.cpp`, behind
`Classless.OpenRelicSlot` (default off). It is ~30 lines with a long comment,
and it holds to two rules:

- **It answers for `CLASS_CONTEXT_EQUIP_RELIC` and nothing else.** Every other
  context returns `nullopt`, so stats, talents, pets, taxi, graveyards and
  class trainers all stay on stock behaviour. The armor ladder in §3 is
  untouched — `Trainer::IsTrainerValidForPlayer` does not consult this hook at
  all, it compares `getClass()` directly.
- **It only ever answers `true`.** Returning `false` would invent a restriction
  the core never asked for.

There are exactly nine `CLASS_CONTEXT_EQUIP_RELIC` call sites in the core, all
in `PlayerStorage.cpp`: five in `FindEquipSlot`, four in
`CanRollForItemInLFG`. Both loosen together, deliberately — being able to equip
a relic you may not roll on would be worse than either alone.

**The client-side risk is real and untested.** The server will now hand out
`EQUIPMENT_SLOT_RANGED` for a libram to any body type, but the 3.3.5a client
decides for itself how to draw that slot, and for a Mage it is a ranged-weapon
slot rather than a relic slot. Whether the client lets a player drag an idol
into it is not something this environment can answer. §9 step 6 is the test.
Note also that a relic occupies the ranged slot, so for a Skirmisher or Adept
it costs a wand or a bow.

---

## 5. The pass

```sql
UPDATE item_template SET AllowableClass = -1
WHERE class IN (2,4)
  AND AllowableClass <> -1
  AND (AllowableClass & 1535) <> 1535
  AND NOT (class = 4 AND subclass BETWEEN 7 AND 10);
```

`1535` is every playable class bit — bit 512 is unused in 3.3.5, which is why
it is not 2047.

| | rows |
|---|---:|
| rows the pass clears | **4,746** |
| …dead loot brought back | 2,844 |
| …widened for at least one body type | 1,902 |

Generated by `tools/audit_items.py --emit-sql`, written first into
`data/sql-staged/` — which AzerothCore's updater does not read — and promoted
after sign-off to

```
modules/mod-classless/data/sql/db-world/2026_08_31_00_item_unlock_allowable_class.sql
```

where the updater picks it up on the next world server start. Regenerating it
is always safe: the tool writes to `sql-staged/`, never over the applied file.

Deliberately **not** touched:

| | rows | why |
|---|---:|---|
| relics | 250 | hardcoded `IsClass`, §4 |
| glyphs dead on this realm | 246 | own system, §7 |
| recipes dead on this realm | 462 | teach class spells |
| everything else dead | 121 | consumables, quest items |
| `AllowableRace <> -1` | 5,102 | every race still exists; untouched on purpose |

---

## 6. Verification

Run against a byte-copy of the live `item_template` (46,096 rows), not a
fixture:

| check | result |
|---|---|
| rows the `UPDATE` changed | 4,746 — matches the predicted count exactly |
| rows still matching the predicate afterwards | 0 |
| backup rows captured | 4,746 |
| weapons/armor still dead afterwards | 5 — all relics, as designed |
| second run (idempotency) | 0 further changes, backup still 4,746 |
| rollback restores originals | 0 rows differ from the pre-pass snapshot |

Rollback is one statement:

```sql
UPDATE item_template i
  JOIN classless_item_class_backup b USING (entry)
   SET i.AllowableClass = b.AllowableClass;
```

The backup table is created by the migration itself and populated with
`INSERT IGNORE`, so re-running can never overwrite a genuine original with an
already-unlocked `-1`.

### Applied for real, through the updater

The migration was then applied to this machine's `acore_world` and the world
server started against it:

```
>> Applying update "2026_08_31_00_item_unlock_allowable_class.sql" '8845448'...
>> Applied 1 query. Containing 756 new and 2196 archived updates.
```

That run came *after* a manual application of the same file, i.e. the updater
executed it a second time — and the state afterwards is still correct: 4,746
backup rows, none of them poisoned to `-1`, 0 rows matching the predicate.
Idempotency is proven through the real path, not only by hand.

Realm state after the pass, from `tools/audit_items.py --verify`:

| | before | after |
|---|---:|---:|
| rows carrying a class mask | 10,936 | 6,190 |
| equippable by no body type | 3,678 | 834 |
| …of which weapons and armor | 2,849 | **5** |

The five are the relics — three Druid idols and two Death Knight sigils — and
they are what §4 exists for. The remaining 829 are the glyphs, recipes and
consumables excluded by decision.

### The relic hook

Built and linked into `worldserver` on this machine:

```
$ nm -C worldserver | grep ClasslessRelicScript
W ClasslessRelicScript::OnPlayerIsClass(Player const*, Classes, ClassContext)
```

and loaded at runtime with the setting live:

```
[Classless] Enabled. Budget: 1 point(s)/level from level 10, +0 bonus.
            SuppressBlizzardTalents=false OpenRelicSlot=true
[Classless] Loaded 10 trees, 50 abilities
```

before the server hit the expected client-data wall. No errors on the way.

**What is not verified:** nobody has equipped anything. There is no client in
this environment, so the server cannot get past
`Failed to find map files for starting areas`. The proficiency ladder in §3 is
proven from trainer data and from the core's own comparison, not from a
character standing at a trainer, and the relic hook is proven to load, not to
work. The playtest checklist is in §9.

---

## 7. Does the unlock need a stat rebalance? Measured: no

The worry is that removing the class mask hands some body type a bigger stat
budget than it was itemized for. It cannot, if the budget is a function of
armor class and item level rather than of the class an item used to be locked
to. That is testable.

Total stat points on epic chests, by armor class and item level — note that
cloth chests are `INVTYPE_ROBE` (20), not `INVTYPE_CHEST` (5); miss that and
cloth vanishes from the comparison:

| ilvl | cloth | leather | mail | plate |
|---:|---:|---:|---:|---:|
| 232 | 448 | 469 | 483 | 428 |
| 245 | 506 | 549 | 565 | 478 |
| 258 | 574 | 623 | 653 | 545 |
| 264 | 606 | 653 | 657 | 558 |
| 277 | 695 | 749 | 753 | 641 |

Within a cell the spread is **1.3–16%**, and the wide cells are mail — which
carries healer, caster and hunter variants at the same item level, i.e. spread
by *role*, not by class favouritism. Across armor classes the ordering is
stable at every tier: mail ≈ leather > cloth > plate, with plate about 15%
below mail because plate's armor value is paid for out of the same budget.

**Unlocking changes which distribution a character can pick, not how much they
get.** No rebalancing is proposed, and none is needed for the mechanical pass.

### The one strategy worth naming

Everyone has cloth proficiency, and spell power is gear-only
(`BODY-TYPES.md §1`). So "Vanguard wears a full cloth caster set and casts as
hard as an Adept while keeping 522 base attack power" is the exploit-shaped
thing to check. Best spell power per cloth slot at ilvl 232+, already open to a
Paladin versus locked away from one:

| slot | open | locked | best open | best locked |
|---|---:|---:|---:|---:|
| head | 12 | 69 | 186 | 186 |
| shoulder | 12 | 63 | 140 | 150 |
| chest/robe | 29 | 61 | 186 | 195 |
| legs | 21 | 63 | 185 | 195 |
| hands | 21 | 61 | 140 | 150 |
| back | 105 | 0 | 118 | — |

**Every slot already has an open piece within 5% of the best locked one.** A
Vanguard can assemble that set today, before any change. The unlock widens the
selection; it does not create the strategy. Whether Vanguard-in-cloth is
acceptable at all is a body-type question that predates Phase 3 — flagged, not
silently inherited.

---

## 8. Decisions — made

**1. Apply the mechanical pass to all 4,746 rows — approved, done.**
Promoted to `data/sql/db-world/2026_08_31_00_item_unlock_allowable_class.sql`
and applied through the updater (§6).

**2. Relics — approved, written.** `Classless.OpenRelicSlot`, default off,
implemented in `modules/mod-classless/src/ClasslessRelics.cpp` (§4). The
default stays off until somebody has confirmed the client will actually let a
non-relic body type use that slot — the one part of this the server cannot
answer alone.

**3. Glyphs — out of scope.** The 246 dead rows stay dead for now, to be
revisited when final content is scoped before launch rather than as part of
this pass. They are inert, not broken: a glyph nobody can equip changes
nothing about the gear ladder.

**Not touched:** `AllowableRace` (all races still exist), recipes, consumables.

### Open, but not blocking

- **Vanguard in a full cloth spell-power set** is legal, was legal before this
  pass, and stays legal. §7 shows the pass widened the selection rather than
  creating the option. If it plays badly the lever is body-type stats
  (`BODY-TYPES.md §5`), not item rows.
- **`OpenRelicSlot` defaults to 0.** Flip it after playtest step 6.

---

## 9. Playtest checklist

**Create a Draenei.** Body types are built on real classes, and Draenei is the
only race that can be all three — see [BODY-TYPES.md §4](BODY-TYPES.md). Any
other race gives you one or two of them, and Night Elf gives you none. The
client will still list all ten classes; the seven that are not body types are
refused on submit.

Once there is a client, in this order:

1. A **Skirmisher** at 40 visits a Paladin trainer → should not be offered
   Plate Mail. (Proves §3's trainer gate.)
2. A **Skirmisher** loots a plate chest → equips? Must fail with
   *no required proficiency*, **not** *you can never use that item*. The
   error text distinguishes the proficiency gate from the class mask, so it
   tells you which gate stopped it.
3. An **Adept** tries leather → same, must fail on proficiency.
4. A **Vanguard** equips a piece from a set that was Warrior-only → should now
   work, and this is the change the pass makes.
5. A **Vanguard** in a full cloth spell-power set → record actual spell power
   against an Adept in the same set. §7 predicts identical; if it is not,
   `BODY-TYPES.md §1` is wrong and that matters far more than this pass.
6. **The relic test, and the one that decides whether §4 shipped anything
   real.** Set `Classless.OpenRelicSlot = 1`, then have a **Skirmisher** or
   **Adept** try to equip a libram. The server will now offer the ranged slot;
   the question is whether the 3.3.5a client, which draws that slot as a
   ranged-weapon slot for non-relic classes, lets the player put an idol in
   it. If it refuses, the hook is correct and unusable, and the honest fix is
   to leave the setting off rather than pretend otherwise.
7. With the setting on, confirm a **Vanguard** and a libram still behave
   exactly as before — the hook returns "no opinion" when the class already
   matches, so nothing about the stock path should have changed.
