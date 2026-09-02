#!/usr/bin/env python3
"""
gen_body_types.py - turn the approved body-type design into SQL.

docs/BODY-TYPES.md was approved and then not implemented; this exists so that
cannot happen quietly again. Everything it emits is derived from the live world
database and checked against the approved anchors before a line of SQL is
written, the same way tools/gen_trees.py refuses to emit a node for a spell it
cannot prove exists.

Two migrations, independent of each other:

  stats   player_class_stats for the three body types, as a full 1-80 curve
          anchored exactly on the approved level 60 and level 80 rows.

  races   playercreateinfo rows so every race can be every body type. Approved
          2026-08-31: race should be an independent choice, not a body-type
          gate. Invisible on a stock client until CharBaseInfo.dbc is patched
          (docs/BODY-TYPES.md section 4) - the server accepting a combination
          the client will not offer costs nothing and is the right shape.

    python3 tools/gen_body_types.py             # verify and print
    python3 tools/gen_body_types.py --write     # also write to data/sql-staged/
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ta import load_local, mysql_cmd, REPO, c, ok, warn, info, BODY_TYPE_CLASSES

STAGED = REPO / "modules" / "mod-classless" / "data" / "sql-staged"

# --------------------------------------------------------------------------
# the approved numbers
#
# docs/BODY-TYPES.md section 2, verbatim. These are anchors, not the curve:
# the generator interpolates every other level and must reproduce these two
# rows exactly, or it refuses to emit.
# --------------------------------------------------------------------------

STAT_COLUMNS = ["BaseHP", "BaseMana", "Strength", "Agility", "Stamina", "Intellect", "Spirit"]

APPROVED = {
    # class: {level: {column: approved value}}
    2: {},                                     # Vanguard: the reference, untouched
    7: {60: {"Stamina": 90},
        80: {"Stamina": 130}},
    8: {60: {"BaseHP": 1400, "BaseMana": 1500, "Strength": 45, "Agility": 45,
             "Stamina": 70, "Intellect": 130, "Spirit": 130},
        80: {"BaseHP": 7100, "BaseMana": 4400, "Strength": 55, "Agility": 55,
             "Stamina": 110, "Intellect": 190, "Spirit": 180}},
}

# Alliance races. Sourced from the core rather than memory: SpellMgr.h:520 has
# ICC_RACEMASK_ALLIANCE = 1101, which is Human(1) + Dwarf(4) + Night Elf(8)
# + Gnome(64) + Draenei(1024) as race bits 1 << (id - 1).
RACEMASK_ALLIANCE = 1101

RACE_NAMES = {1: "Human", 2: "Orc", 3: "Dwarf", 4: "Night Elf", 5: "Undead",
              6: "Tauren", 7: "Gnome", 8: "Troll", 10: "Blood Elf", 11: "Draenei"}

CLASS_DEATH_KNIGHT = 6      # starts in Ebon Hold, never a position donor


def query(cfg, sql):
    cmd = mysql_cmd(cfg, cfg["db_world"]) + ["-N", "-B", "-e", sql]
    proc = subprocess.run([str(x) for x in cmd], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"query failed: {proc.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return [line.split("\t") for line in proc.stdout.strip().splitlines() if line.strip()]


def is_alliance(race):
    return bool(RACEMASK_ALLIANCE & (1 << (race - 1)))


# --------------------------------------------------------------------------
# stats
# --------------------------------------------------------------------------

def interpolate(delta_60, delta_80, level):
    """Delta at a level, piecewise linear through (1, 0), (60, d60), (80, d80).

    Zero at level 1 is deliberate rather than incidental: the approved table
    changes nothing at level 1, and all three body types already share the same
    level 1 Stamina. Starting the curve anywhere else would invent a difference
    the design never asked for.
    """
    if level <= 1:
        return 0.0
    if level <= 60:
        return delta_60 * (level - 1) / 59.0
    return delta_60 + (delta_80 - delta_60) * (level - 60) / 20.0


def stock_curve(cfg):
    """{class: {level: {column: value}}} straight from the realm."""
    rows = query(cfg, "SELECT Class, Level, " + ", ".join(STAT_COLUMNS) +
                      " FROM player_class_stats WHERE Class IN (2,7,8) ORDER BY Class, Level")
    out = {}
    for row in rows:
        class_id, level = int(row[0]), int(row[1])
        out.setdefault(class_id, {})[level] = {
            col: int(value) for col, value in zip(STAT_COLUMNS, row[2:])
        }
    return out


def build_stats(stock):
    """The full curve, plus the problems found while building it."""
    curve, problems = {}, []

    for class_id, anchors in APPROVED.items():
        if not anchors:
            continue
        if class_id not in stock:
            problems.append(f"class {class_id} has no player_class_stats rows")
            continue

        deltas = {}
        for column, target in anchors[80].items():
            d80 = target - stock[class_id][80][column]
            d60 = anchors[60].get(column, target) - stock[class_id][60][column] \
                if column in anchors[60] else d80
            deltas[column] = (d60, d80)

        levels = {}
        for level in sorted(stock[class_id]):
            values = dict(stock[class_id][level])
            for column, (d60, d80) in deltas.items():
                values[column] = max(0, values[column] + round(interpolate(d60, d80, level)))
            levels[level] = values
        curve[class_id] = levels

        # The anchors are the whole point. Interpolation that misses them is a
        # bug, not a rounding detail.
        for level, expected in anchors.items():
            for column, target in expected.items():
                got = levels[level][column]
                if got != target:
                    problems.append(
                        f"class {class_id} level {level} {column}: generated {got}, approved {target}")

        # Stock curves never go backwards; the generated one must not either,
        # or a character would lose a stat by levelling up.
        for column in STAT_COLUMNS:
            series = [levels[l][column] for l in sorted(levels)]
            for i in range(1, len(series)):
                if series[i] < series[i - 1]:
                    problems.append(
                        f"class {class_id} {column} drops at level {sorted(levels)[i]}: "
                        f"{series[i - 1]} -> {series[i]}")
                    break

    return curve, problems


def emit_stats(curve, stock):
    lines = ["""--
-- Body-type stat curves for player_class_stats.
--
-- GENERATED by tools/gen_body_types.py - do not hand-edit; re-run the tool.
--
-- The numbers in docs/BODY-TYPES.md section 2 were approved on 2026-08-26 and
-- never turned into a migration, so until now the three body types were
-- numerically identical to stock Paladin, Shaman and Mage wearing new names.
--
-- Vanguard (Paladin, class 2) is the reference point and is not touched.
-- Skirmisher (Shaman, 7) and Adept (Mage, 8) are moved onto the approved
-- curve: linear from no change at level 1, through the approved level 60 row,
-- to the approved level 80 row. The generator refuses to emit unless both
-- anchors come out exactly and no stat decreases with level.
--
-- Reversible: classless_class_stats_backup keeps every original row.
--

CREATE TABLE IF NOT EXISTS `classless_class_stats_backup` (
  `Class`     TINYINT UNSIGNED NOT NULL,
  `Level`     TINYINT UNSIGNED NOT NULL,
  `BaseHP`    INT UNSIGNED NOT NULL,
  `BaseMana`  INT UNSIGNED NOT NULL,
  `Strength`  INT NOT NULL,
  `Agility`   INT NOT NULL,
  `Stamina`   INT NOT NULL,
  `Intellect` INT NOT NULL,
  `Spirit`    INT NOT NULL,
  PRIMARY KEY (`Class`, `Level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='mod-classless: pre-body-type player_class_stats, so the curve can be undone';

-- INSERT IGNORE so re-running never overwrites a real original with a value
-- this migration itself wrote.
INSERT IGNORE INTO `classless_class_stats_backup`
  (`Class`, `Level`, `BaseHP`, `BaseMana`, `Strength`, `Agility`, `Stamina`, `Intellect`, `Spirit`)
SELECT `Class`, `Level`, `BaseHP`, `BaseMana`, `Strength`, `Agility`, `Stamina`, `Intellect`, `Spirit`
FROM `player_class_stats` WHERE `Class` IN (7, 8);
"""]

    for class_id in sorted(curve):
        name = next(n for n, c_ in BODY_TYPE_CLASSES.items() if c_ == class_id)
        changed = sum(1 for level in curve[class_id]
                      if curve[class_id][level] != stock[class_id][level])
        lines.append(f"\n-- {name} (class {class_id}): {changed} of "
                     f"{len(curve[class_id])} levels differ from stock.")
        for level in sorted(curve[class_id]):
            values = curve[class_id][level]
            if values == stock[class_id][level]:
                continue
            sets = ", ".join(f"`{col}` = {values[col]}" for col in STAT_COLUMNS
                             if values[col] != stock[class_id][level][col])
            lines.append(f"UPDATE `player_class_stats` SET {sets} "
                         f"WHERE `Class` = {class_id} AND `Level` = {level};")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# races
# --------------------------------------------------------------------------

def build_races(cfg):
    """Missing (race, body type) pairs, with a start position and a donor."""
    existing = {(int(r), int(c_)) for r, c_ in
                query(cfg, "SELECT race, class FROM playercreateinfo")}

    # A race's start position is a property of the race, not the class - every
    # class of a race shares it, except the Death Knight, who starts in Ebon
    # Hold. So any non-DK row of that race is a valid donor.
    positions = {}
    for race, map_, zone, x, y, z, o in query(
            cfg, "SELECT race, map, zone, position_x, position_y, position_z, orientation "
                 f"FROM playercreateinfo WHERE class <> {CLASS_DEATH_KNIGHT} ORDER BY race, class"):
        positions.setdefault(int(race), (int(map_), int(zone), x, y, z, o))

    missing, problems = [], []
    for class_id in sorted(BODY_TYPE_CLASSES.values()):
        have = sorted(r for (r, c_) in existing if c_ == class_id)
        for race in sorted(RACE_NAMES):
            if (race, class_id) in existing:
                continue
            if race not in positions:
                problems.append(f"race {race} has no non-death-knight start position")
                continue
            # Prefer a donor on the same faction: starting action bars and any
            # faction-flavoured extras then stay appropriate.
            same = [r for r in have if is_alliance(r) == is_alliance(race)]
            donor = same[0] if same else (have[0] if have else None)
            if donor is None:
                problems.append(f"class {class_id} exists for no race at all")
                continue
            missing.append((race, class_id, positions[race], donor))
    return missing, problems


def emit_races(missing):
    lines = ["""--
-- Every race can be every body type.
--
-- GENERATED by tools/gen_body_types.py - do not hand-edit; re-run the tool.
--
-- Body types are built on real classes, and real classes are not available to
-- every race: only Draenei could be all three, and a Night Elf could be none
-- of them, so could not be created on this realm at all. That made race the
-- real character choice and body type a consequence of it, which is the
-- opposite of the design.
--
-- Approved 2026-08-31: add the rows rather than drop Night Elf.
--
-- A stock client will not OFFER these combinations - the creation screen reads
-- CharBaseInfo.dbc, and no server packet carries that list (docs/BODY-TYPES.md
-- section 4). The server accepting what the client does not yet offer costs
-- nothing and is the right shape for when the client patch ships.
--
-- Start position is copied from the race's own existing rows, so a Night Elf
-- Vanguard starts in Shadowglen like every other Night Elf. Action bars are
-- copied from a same-faction race that already has that class.
--
-- Reversible: every row added here is listed in classless_createinfo_added.
--

CREATE TABLE IF NOT EXISTS `classless_createinfo_added` (
  `race`  TINYINT UNSIGNED NOT NULL,
  `class` TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (`race`, `class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='mod-classless: race/class pairs this realm added, so they can be removed again';
"""]

    for race, class_id, (map_, zone, x, y, z, o), donor in missing:
        name = next(n for n, c_ in BODY_TYPE_CLASSES.items() if c_ == class_id)
        lines.append(f"\n-- {RACE_NAMES[race]} {name} (race {race}, class {class_id}), "
                     f"action bar from {RACE_NAMES[donor]}")
        lines.append("INSERT IGNORE INTO `classless_createinfo_added` (`race`, `class`) "
                     f"VALUES ({race}, {class_id});")
        lines.append(
            "INSERT IGNORE INTO `playercreateinfo` "
            "(`race`, `class`, `map`, `zone`, `position_x`, `position_y`, `position_z`, `orientation`) "
            f"VALUES ({race}, {class_id}, {map_}, {zone}, {x}, {y}, {z}, {o});")
        lines.append(
            "INSERT IGNORE INTO `playercreateinfo_action` (`race`, `class`, `button`, `action`, `type`) "
            f"SELECT {race}, {class_id}, `button`, `action`, `type` FROM `playercreateinfo_action` "
            f"WHERE `race` = {donor} AND `class` = {class_id};")
    return "\n".join(lines) + "\n"


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--write", action="store_true", help="write the migrations to data/sql-staged/")
    args = p.parse_args()

    cfg = load_local()
    stock = stock_curve(cfg)
    curve, stat_problems = build_stats(stock)
    missing, race_problems = build_races(cfg)

    print()
    print(c("  Body types -> SQL", "blue"))
    print()
    print(c("  1. Stat curves", "blue"))
    for class_id in sorted(curve):
        name = next(n for n, c_ in BODY_TYPE_CLASSES.items() if c_ == class_id)
        changed = sum(1 for level in curve[class_id]
                      if curve[class_id][level] != stock[class_id][level])
        print(f"     {name:<11} class {class_id}: {changed} of {len(curve[class_id])} levels change")
    print(f"     Vanguard    class 2: reference point, untouched")
    print()
    print(f"     {'':<12}{'level 1':>22}{'level 60':>22}{'level 80':>22}")
    for class_id in sorted(curve):
        for column in ("Stamina", "BaseMana"):
            cells = ""
            for level in (1, 60, 80):
                was, now = stock[class_id][level][column], curve[class_id][level][column]
                cells += f"{was:>10} ->{now:>9}" if was != now else f"{was:>10} (same)"
            print(f"     class {class_id} {column:<9}{cells}")
    print()

    print(c("  2. Race coverage", "blue"))
    print(f"     {len(missing)} race/body-type pairs to add:")
    for class_id in sorted(BODY_TYPE_CLASSES.values()):
        names = [RACE_NAMES[r] for r, c_, _, _ in missing if c_ == class_id]
        body = next(n for n, v in BODY_TYPE_CLASSES.items() if v == class_id)
        print(f"       {body:<11} + {', '.join(names) if names else '(none needed)'}")
    print()

    problems = stat_problems + race_problems
    if problems:
        for problem in problems:
            warn(f"  {problem}")
        print()
        print(c("  refusing to emit", "red"))
        return 1

    ok("every approved anchor reproduced exactly; no stat decreases with level")

    if args.write:
        STAGED.mkdir(parents=True, exist_ok=True)
        stats_path = STAGED / "body_type_class_stats.sql"
        races_path = STAGED / "body_type_race_coverage.sql"
        stats_path.write_text(emit_stats(curve, stock), encoding="utf-8")
        races_path.write_text(emit_races(missing), encoding="utf-8")
        ok(f"wrote {stats_path.relative_to(REPO)}")
        ok(f"wrote {races_path.relative_to(REPO)}")
        info("staged, not applied. The updater does not read sql-staged/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
