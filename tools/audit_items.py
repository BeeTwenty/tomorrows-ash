#!/usr/bin/env python3
"""
audit_items.py - what class restrictions on gear mean once classes are gone.

Ashmorrow has three body types, and each one *is* a stock class underneath
(docs/BODY-TYPES.md): Vanguard = Paladin, Skirmisher = Shaman, Adept = Mage.
Every other class is removed at character creation, so `item_template`.
`AllowableClass` is still evaluated - against a class mask that can now only
ever be one of three values.

That has a consequence nobody chose: an item restricted to Warrior, Rogue,
Hunter, Priest, Warlock, Druid or Death Knight is equippable by **no character
on the realm**. It still drops, still fills quest reward pickers, still sits in
vendor lists. This tool measures exactly how much of the item table is in that
state, and emits the SQL that fixes it.

    python3 tools/audit_items.py                # report only
    python3 tools/audit_items.py --emit-sql     # also write the staged migration
    python3 tools/audit_items.py --verify       # re-check a realm the SQL ran on

Nothing here writes to the database. `--emit-sql` writes a file under
modules/mod-classless/data/sql-staged/, which the AzerothCore updater does not
look at; promoting it is a deliberate, separate step (see docs/PHASE3-ITEMIZATION.md).
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ta import load_local, mysql_cmd, REPO, c, ok, warn, info

# Class bits, from ChrClasses: 1 Warrior, 2 Paladin, 4 Hunter, 8 Rogue,
# 16 Priest, 32 Death Knight, 64 Shaman, 128 Mage, 256 Warlock, 1024 Druid.
# Bit 512 is unused in 3.3.5, which is why "all classes" is 1535 and not 2047.
CLASSMASK_ALL_PLAYABLE = 1535

BODY_TYPES = {
    "Vanguard":   (2,   "Paladin", "plate"),
    "Skirmisher": (64,  "Shaman",  "mail"),
    "Adept":      (128, "Mage",    "cloth"),
}
REALM_MASK = 2 | 64 | 128          # 194 - every class that exists on Ashmorrow

# Armor subclasses 7-10 are libram/idol/totem/sigil. Their equip slot is chosen
# in Player::FindEquipSlot by a hardcoded IsClass() call, so clearing
# AllowableClass on them changes nothing at all. Excluded on purpose; see
# docs/PHASE3-ITEMIZATION.md section 4.
RELIC_SUBCLASSES = (7, 8, 9, 10)

ITEM_CLASS_WEAPON, ITEM_CLASS_ARMOR = 2, 4

# The rows the pass touches. Kept in one place so the report, the SQL and the
# verification can never disagree about what "the pass" means.
PASS_WHERE = (
    f"class IN ({ITEM_CLASS_WEAPON},{ITEM_CLASS_ARMOR}) "
    "AND AllowableClass <> -1 "
    f"AND (AllowableClass & {CLASSMASK_ALL_PLAYABLE}) <> {CLASSMASK_ALL_PLAYABLE} "
    f"AND NOT (class = {ITEM_CLASS_ARMOR} AND subclass BETWEEN 7 AND 10)"
)


def query(cfg, sql):
    cmd = mysql_cmd(cfg, cfg["db_world"]) + ["-N", "-B", "-e", sql]
    proc = subprocess.run([str(x) for x in cmd], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"query failed: {proc.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return [line.split("\t") for line in proc.stdout.strip().splitlines() if line.strip()]


def scalar(cfg, sql):
    rows = query(cfg, sql)
    return int(rows[0][0]) if rows else 0


def counts(cfg):
    """The numbers the report and the migration header are built from."""
    n = lambda where: scalar(cfg, f"SELECT COUNT(*) FROM item_template WHERE {where}")
    restricted = "AllowableClass <> -1"
    real = f"{restricted} AND (AllowableClass & {CLASSMASK_ALL_PLAYABLE}) <> {CLASSMASK_ALL_PLAYABLE}"
    dead = f"{restricted} AND (AllowableClass & {REALM_MASK}) = 0"

    return {
        "total":         n("1=1"),
        "restricted":    n(restricted),
        "nominal":       n(f"{restricted} AND (AllowableClass & {CLASSMASK_ALL_PLAYABLE}) = {CLASSMASK_ALL_PLAYABLE}"),
        "real":          n(real),
        "dead":          n(dead),
        "dead_gear":     n(f"{dead} AND class IN ({ITEM_CLASS_WEAPON},{ITEM_CLASS_ARMOR})"),
        "user_8489":     n(f"{restricted} AND class IN ({ITEM_CLASS_WEAPON},{ITEM_CLASS_ARMOR})"),
        "pass":          n(PASS_WHERE),
        "pass_dead":     n(f"{PASS_WHERE} AND (AllowableClass & {REALM_MASK}) = 0"),
        "pass_widened":  n(f"{PASS_WHERE} AND (AllowableClass & {REALM_MASK}) <> 0"),
        "relics":        n(f"class = {ITEM_CLASS_ARMOR} AND subclass BETWEEN 7 AND 10"),
        "glyphs_dead":   n(f"class = 16 AND {dead}"),
        "recipes_dead":  n(f"class = 9 AND {dead}"),
        "other_dead":    n(f"class NOT IN (2,4,9,16) AND {dead}"),
        "race":          n("AllowableRace <> -1"),
    }


def per_body_type(cfg):
    """How much of the restricted gear each body type can equip, before and after."""
    out = []
    for name, (bit, klass, armor) in BODY_TYPES.items():
        before = scalar(cfg, "SELECT COUNT(*) FROM item_template "
                             f"WHERE {PASS_WHERE} AND (AllowableClass & {bit}) <> 0")
        out.append((name, klass, armor, before))
    return out


def armor_budget(cfg):
    """Total stat points by armor class and item level, endgame epics only.

    The question this answers is the one that decides whether the unlock needs
    a rebalance: does removing the class mask hand somebody a bigger stat
    budget? It cannot, if the budget is a function of armor class and item
    level rather than of the class the item used to be locked to.

    Chest is the comparison slot because every armor class has many of them at
    every raid tier. Cloth chests are INVTYPE_ROBE (20), not INVTYPE_CHEST (5)
    - miss that and cloth silently drops out of the comparison entirely.
    """
    return query(cfg, """
        SELECT sub, ItemLevel, n, mean, ROUND(100*sd/NULLIF(mean,0),1) FROM (
          SELECT ELT(subclass+1,'misc','cloth','leather','mail','plate') sub,
                 ItemLevel, COUNT(*) n, ROUND(AVG(s),1) mean, ROUND(STDDEV_SAMP(s),1) sd
          FROM (SELECT subclass, ItemLevel,
                       stat_value1+stat_value2+stat_value3+stat_value4+stat_value5
                     + stat_value6+stat_value7+stat_value8+stat_value9+stat_value10 s
                FROM item_template
                WHERE class = 4 AND subclass BETWEEN 1 AND 4
                  AND InventoryType IN (5, 20) AND Quality = 4 AND ItemLevel >= 219) x
          GROUP BY subclass, ItemLevel HAVING n >= 4) y
        ORDER BY ItemLevel, FIELD(sub,'cloth','leather','mail','plate')""")


def cloth_ceiling(cfg):
    """Best spell power per slot a Vanguard can already reach, vs. what is locked.

    Everyone has cloth proficiency, and spell power is gear-only (BODY-TYPES
    section 1), so "plate body type wears a cloth caster set" is the strategy
    the unlock could plausibly create. It only *creates* it if the open pieces
    are meaningfully worse than the locked ones.
    """
    return query(cfg, """
        SELECT InventoryType, SUM(open), SUM(1-open),
               MAX(CASE WHEN open=1 THEN sp END), MAX(CASE WHEN open=0 THEN sp END)
        FROM (
          SELECT InventoryType,
                 CASE WHEN AllowableClass = -1 OR (AllowableClass & 2) <> 0 THEN 1 ELSE 0 END open,
                 GREATEST(IF(stat_type1=45,stat_value1,0),  IF(stat_type2=45,stat_value2,0),
                          IF(stat_type3=45,stat_value3,0),  IF(stat_type4=45,stat_value4,0),
                          IF(stat_type5=45,stat_value5,0),  IF(stat_type6=45,stat_value6,0),
                          IF(stat_type7=45,stat_value7,0),  IF(stat_type8=45,stat_value8,0),
                          IF(stat_type9=45,stat_value9,0),  IF(stat_type10=45,stat_value10,0)) sp
          FROM item_template
          WHERE class = 4 AND subclass = 1 AND ItemLevel >= 232) x
        GROUP BY InventoryType ORDER BY InventoryType""")


# Armor skill ids, and the proficiency spells that grant the ones nobody starts
# with. Both halves are checked against the database rather than asserted,
# because "plate stays Vanguard-only" is the load-bearing claim of the whole
# pass: if it is wrong, removing the class mask really does collapse the three
# body types into one.
ARMOR_SKILLS = {415: "cloth", 414: "leather", 413: "mail", 293: "plate", 433: "shield"}
PROFICIENCY_SPELLS = {750: "plate", 8737: "mail", 9116: "shield"}


def proficiency_gates(cfg):
    """Who starts with which armor skill, and who can train the rest.

    Returns (start_rows, train_rows).

    Trainer.Type 0 is a class trainer and Trainer.Requirement is then a class
    id, compared against player->getClass() directly in
    Trainer::IsTrainerValidForPlayer (Trainer.cpp:209) - getClass(), not
    IsClass(), so unlike the relic slot there is no script hook in that path.
    A class trainer for a class this realm does not have is unreachable.
    """
    start = query(cfg,
        "SELECT skill, classMask FROM playercreateinfo_skills "
        f"WHERE skill IN ({','.join(str(k) for k in ARMOR_SKILLS)}) ORDER BY skill")
    train = query(cfg,
        "SELECT ts.SpellId, t.Type, t.Requirement FROM trainer t "
        "JOIN trainer_spell ts ON ts.TrainerId = t.Id "
        f"WHERE ts.SpellId IN ({','.join(str(k) for k in PROFICIENCY_SPELLS)}) "
        "GROUP BY ts.SpellId, t.Type, t.Requirement ORDER BY ts.SpellId")
    return start, train


def print_proficiency(cfg):
    start, train = proficiency_gates(cfg)
    start_mask = {int(sk): int(m) for sk, m in start}
    trainable = {}
    for spell, ttype, req in train:
        if int(ttype) == 0:                      # class trainer
            trainable.setdefault(int(spell), set()).add(int(req))

    print(f"     {'':<12}" + "".join(f"{n:<12}" for n in BODY_TYPES))
    for skill, armor in ARMOR_SKILLS.items():
        cells = []
        for name, (bit, _, _) in BODY_TYPES.items():
            klass = bit.bit_length()             # bit 2 -> class 2, 64 -> 7, 128 -> 8
            mask = start_mask.get(skill)
            if mask == 0 or (mask and mask & bit):
                cells.append("start")
            else:
                spell = next((sp for sp, a in PROFICIENCY_SPELLS.items() if a == armor), None)
                cells.append("train @40" if spell and klass in trainable.get(spell, ()) else "-")
        print(f"     {armor:<12}" + "".join(f"{v:<12}" for v in cells))


INVTYPE_NAMES = {1: "head", 3: "shoulder", 5: "chest", 6: "waist", 7: "legs",
                 8: "feet", 9: "wrist", 10: "hands", 16: "back", 20: "robe"}

SQL_HEADER = """--
-- Remove class restrictions from weapons and armor.
--
-- GENERATED by tools/audit_items.py - do not hand-edit; re-run the tool.
--
-- Why: three body types exist on Ashmorrow, each one a stock class underneath
-- (Paladin / Shaman / Mage). AllowableClass is still enforced in
-- Player::CanUseItem (PlayerStorage.cpp:2372), so {dead_gear} weapon and armor
-- rows restricted to classes this realm does not have are equippable by nobody
-- - dead loot that still drops and still fills quest reward pickers.
--
-- What replaces the gate: armor proficiency, which is a skill granted by a
-- spell and is locked to body type (docs/BODY-TYPES.md section 3). Plate stays
-- Vanguard-only because only a Paladin trains Plate Mail, not because the item
-- says so. The class mask was never doing that job; the skill was.
--
-- Rows touched: {rows} - weapons and armor whose stored mask does not already
-- admit all ten stock classes. Relics (armor subclass 7-10) are excluded: their
-- equip slot is chosen by a hardcoded IsClass() in Player::FindEquipSlot, so
-- clearing the mask would change nothing.
--
-- Reversible: classless_item_class_backup keeps the original value of every row
-- this touches. See docs/PHASE3-ITEMIZATION.md section 6 for the rollback.
--

CREATE TABLE IF NOT EXISTS `classless_item_class_backup` (
  `entry`                INT UNSIGNED NOT NULL,
  `AllowableClass`       INT          NOT NULL,
  `backed_up_at`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='mod-classless: pre-unlock AllowableClass, so the pass can be undone';

-- Snapshot first. INSERT IGNORE so re-running never overwrites a real original
-- with an already-unlocked -1.
INSERT IGNORE INTO `classless_item_class_backup` (`entry`, `AllowableClass`)
SELECT `entry`, `AllowableClass` FROM `item_template`
WHERE {where};

UPDATE `item_template` SET `AllowableClass` = -1
WHERE {where};
"""


def emit_sql(counts_):
    target = REPO / "modules" / "mod-classless" / "data" / "sql-staged"
    target.mkdir(parents=True, exist_ok=True)
    path = target / "item_unlock_allowable_class.sql"
    path.write_text(
        SQL_HEADER.format(where=PASS_WHERE, rows=counts_["pass"], dead_gear=counts_["dead_gear"]),
        encoding="utf-8")
    return path


def report(cfg, args):
    n = counts(cfg)

    print()
    print(c("  Ashmorrow item audit - class restrictions on gear", "blue"))
    print(f"  world database: {cfg['db_world']} on {cfg['mysql_host']}")
    print(f"  body types    : " + ", ".join(
        f"{name} = {k} (bit {b})" for name, (b, k, _) in BODY_TYPES.items()))
    print()

    print(c("  1. What the class mask actually says", "blue"))
    print(f"     item_template rows                      {n['total']:>7}")
    print(f"     with a class mask (AllowableClass <> -1) {n['restricted']:>6}")
    print(f"       ...mask already admits all 10 classes  {n['nominal']:>6}   (a no-op mask)")
    print(f"       ...genuinely restrictive               {n['real']:>6}")
    print()
    print(f"     weapons + armor with any mask            {n['user_8489']:>6}   <- the 8,489 figure")
    print()

    print(c("  2. What that costs this realm", "blue"))
    print(f"     equippable by NO body type (dead loot)   {n['dead']:>6}")
    print(f"       ...of which weapons and armor          {n['dead_gear']:>6}")
    print()

    print(c("  3. The pass", "blue"))
    print(f"     rows it clears                           {n['pass']:>6}")
    print(f"       ...dead loot brought back              {n['pass_dead']:>6}")
    print(f"       ...widened for at least one body type  {n['pass_widened']:>6}")
    print("     reach per body type, before the pass:")
    for name, klass, armor, before in per_body_type(cfg):
        print(f"       {name:<11} ({klass:<7}, {armor:<7}) {before:>6} of {n['pass']}")
    print()
    print("     deliberately excluded:")
    print(f"       relics, libram/idol/totem/sigil        {n['relics']:>6}   hardcoded IsClass, SQL cannot fix")
    print(f"       glyphs dead on this realm              {n['glyphs_dead']:>6}   own system, needs a decision")
    print(f"       recipes dead on this realm             {n['recipes_dead']:>6}   teach class spells")
    print(f"       everything else dead                   {n['other_dead']:>6}")
    print(f"       AllowableRace rows                     {n['race']:>6}   every race still exists; untouched")
    print()

    if args.budget:
        print(c("  4. Does the unlock move anyone's stat budget?", "blue"))
        print("     Total stat points on epic chests, by armor class and item level.")
        print(f"     {'armor':<8} {'ilvl':>5} {'n':>4} {'mean':>8} {'spread':>8}")
        for sub, ilvl, cnt, mean, cv in armor_budget(cfg):
            print(f"     {sub:<8} {ilvl:>5} {cnt:>4} {mean:>8} {cv + '%':>8}")
        print()

        print(c("  5. The cloth-on-a-Vanguard question", "blue"))
        print("     Best spell power per cloth slot at ilvl 232+, already open to a")
        print("     Paladin vs. locked away from one.")
        print(f"     {'slot':<9} {'open':>5} {'locked':>7} {'best open':>10} {'best locked':>12}")
        for inv, open_n, locked_n, best_open, best_locked in cloth_ceiling(cfg):
            name = INVTYPE_NAMES.get(int(inv), f"type{inv}")
            print(f"     {name:<9} {open_n:>5} {locked_n:>7} {best_open:>10} "
                  f"{(best_locked if best_locked != 'NULL' else '-'):>12}")
        print()

        print(c("  6. What gates armor once the class mask is gone", "blue"))
        print("     Armor proficiency, from playercreateinfo_skills and the class trainers.")
        print_proficiency(cfg)
        print("     Plate is sold only by Warrior and Paladin class trainers, and")
        print("     Trainer::IsTrainerValidForPlayer (Trainer.cpp:209) compares")
        print("     player->getClass() directly - no script hook in that path.")
        print()

    if args.verify:
        left = scalar(cfg, f"SELECT COUNT(*) FROM item_template WHERE {PASS_WHERE}")
        backed = scalar(cfg, "SELECT COUNT(*) FROM classless_item_class_backup") \
            if scalar(cfg, "SELECT COUNT(*) FROM information_schema.tables "
                           f"WHERE table_schema='{cfg['db_world']}' "
                           "AND table_name='classless_item_class_backup'") else 0
        if left == 0 and backed:
            ok(f"pass applied: 0 rows left restricted, {backed} originals kept for rollback")
        elif left:
            warn(f"pass not applied (or partly): {left} rows still restricted")
        else:
            warn("0 rows restricted but no backup table - was the pass applied by something else?")

    if args.emit_sql:
        path = emit_sql(n)
        ok(f"wrote {path.relative_to(REPO)}")
        info("staged, not applied. The AzerothCore updater does not read sql-staged/.")
        info("To apply: see docs/PHASE3-ITEMIZATION.md section 5.")

    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--emit-sql", action="store_true", help="write the staged migration")
    p.add_argument("--verify", action="store_true", help="check whether the pass has been applied")
    p.add_argument("--no-budget", dest="budget", action="store_false",
                   help="skip the stat-budget measurements")
    args = p.parse_args()
    return report(load_local(), args)


if __name__ == "__main__":
    sys.exit(main())
