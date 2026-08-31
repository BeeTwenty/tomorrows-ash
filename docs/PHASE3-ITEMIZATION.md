# Phase 3 — itemization: what class restrictions on gear cost, and the fix

**Status:** investigated and measured. The mechanical pass is generated,
verified against a copy of the live world table, and **staged, not applied.**
Three things need a decision before anything goes wide — section 7.

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

**Not written.** It is module C++ rather than SQL, and it is a design question
(should a Vanguard who bought Druid abilities carry an idol?) rather than a bug
fix. Section 7.

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

Generated by `tools/audit_items.py --emit-sql` into

```
modules/mod-classless/data/sql-staged/item_unlock_allowable_class.sql
```

**`sql-staged/` is not `data/sql/`.** AzerothCore's updater only reads
`data/sql/db-{world,characters,auth}/`, so nothing in this file runs on a
server start. Promoting it is one deliberate move:

```bash
git mv modules/mod-classless/data/sql-staged/item_unlock_allowable_class.sql \
       modules/mod-classless/data/sql/db-world/2026_08_31_00_item_unlock.sql
```

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

**What is not verified:** nobody has equipped anything. There is no client in
this environment, so the server cannot start
(`Failed to find map files for starting areas`). The proficiency ladder in §3
is proven from trainer data and from the core's own comparison, not from a
character standing at a trainer. The playtest check is in §8.

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

## 8. What needs your sign-off

**1. Apply the mechanical pass to all 4,746 rows?**
Recommended: yes. It is reversible, idempotent, verified against a copy of the
real table, and the armor ladder that actually implements the body-type design
is untouched by it. Say go and it moves from `sql-staged/` into the module's
migration directory.

**2. Relics — open them, or leave them class-dead?**
250 rows. Opening them needs a module `OnPlayerIsClass` hook scoped to
`CLASS_CONTEXT_EQUIP_RELIC` (§4). Arguments both ways: a character who spent
points on Paladin abilities has a real case for a libram; but relics buff
specific spells, so an unowned one is dead weight rather than a gain. My
recommendation is **yes, scoped to the relic context only** — it is ~30 lines
and it removes the last inert gear category. It is the only part of Phase 3
that is C++ rather than data.

**3. Glyphs — 246 rows dead on this realm.**
Glyphs are a separate system with their own slots and their own relationship to
whether a character owns the spell being glyphed. I have not investigated them
and am not proposing anything yet. Worth a look after the pass, or worth
declaring out of scope for launch.

**Not asking about:** `AllowableRace` (all races still exist — no reason to
touch it), recipes, and consumables.

---

## 9. Playtest checklist

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
6. Any character equips a libram → still impossible until decision 2 is made.
