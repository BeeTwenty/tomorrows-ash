"""The committed migrations have to be built for the body types we actually have.

`BODY_TYPE_CLASSES` in tools/ta.py is the single source of truth for which
three stock classes the body types are built on. Two of the migrations under
`data/sql/db-world/` are *generated* from it by `tools/gen_body_types.py`, and
one names it by hand. Change the constant and those files do not change with
it — they sit in the tree, correct-looking, describing the previous decision.

That is not a hypothetical. Skirmisher moved from Shaman (7) to Hunter (3) on
2026-09-02 (docs/decisions/0008-body-type-client-patch.md section 10), after the
race-coverage migration had already been generated for Shaman. Nothing in the
repository noticed. The realm would have accepted Shamans, the patched client
would have offered Hunters, and the first symptom would have been a player
picking a body type that does not exist on the server.

Regenerating needs a live world database, which is why this reports rather than
fixes:

    python3 tools/gen_body_types.py --write     # then move from sql-staged/

    python3 tools/tests/test_migrations_match_chassis.py

NOT WIRED INTO CI YET, on purpose. It currently fails, because the race-coverage
migration really is stale — and adding a red step to tell everyone something
already known, while blocking every other build, costs more than it says. The
line below belongs in `.github/workflows/ci.yml` beside the other
`tools/tests/*` steps, in the same change that regenerates the migration:

      - name: Migrations match the body types
        run: python tools/tests/test_migrations_match_chassis.py
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, "tools")
import ta

SQL = Path("modules/mod-classless/data/sql/db-world")
ALLOWED = set(ta.BODY_TYPE_CLASSES.values())
NAMES = {1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest",
         6: "Death Knight", 7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid"}

fails = []


def describe(ids):
    return ", ".join(f"{NAMES.get(i, '?')}({i})" for i in sorted(ids))


# --- 1. the race-coverage migration only adds body-type classes -------------
#
# Every row it inserts is a race/class pair the realm will accept. A pair whose
# class is not a body type is a pair no player can ever reach, because character
# creation refuses that class outright (test_body_types.py, check 1).
coverage = SQL / "2026_08_31_02_body_type_race_coverage.sql"
if not coverage.is_file():
    print(f"1. race coverage        -> {coverage.name} absent, nothing to check")
else:
    pairs = {
        (int(race), int(cls))
        for race, cls in re.findall(
            r"classless_createinfo_added`\s*\(`race`,\s*`class`\)\s*VALUES\s*\((\d+),\s*(\d+)\)",
            coverage.read_text(encoding="utf-8"),
        )
    }
    if not pairs:
        fails.append(f"{coverage.name}: no inserted pairs found — has its shape changed?")
    else:
        stale = sorted({cls for _, cls in pairs} - ALLOWED)
        if stale:
            fails.append(
                f"{coverage.name} adds rows for {describe(stale)}, which "
                f"{'is' if len(stale) == 1 else 'are'} not a body type. "
                f"The body types are {describe(ALLOWED)}. "
                f"Regenerate: python3 tools/gen_body_types.py --write"
            )
        else:
            print(f"1. race coverage        -> {len(pairs)} pairs, all body types")

# --- 2. the stats migration only tunes body-type classes -------------------
stats = SQL / "2026_08_31_01_body_type_class_stats.sql"
if not stats.is_file():
    print(f"2. class stats          -> {stats.name} absent, nothing to check")
else:
    text = stats.read_text(encoding="utf-8")
    touched = {int(c) for c in re.findall(r"player_class_stats`[^;]*?`class`\s*=\s*(\d+)", text, re.S)}
    touched |= {int(c) for c in re.findall(r"VALUES\s*\((\d+),\s*\d+,", text)}
    stale = sorted(touched - ALLOWED) if touched else []
    if stale:
        fails.append(
            f"{stats.name} writes stats for {describe(stale)}, which "
            f"{'is' if len(stale) == 1 else 'are'} not a body type. "
            f"Regenerate: python3 tools/gen_body_types.py --write"
        )
    elif touched:
        print(f"2. class stats          -> {describe(touched)}")
    else:
        print("2. class stats          -> no class ids found, skipped")

# --- 3. the body-type name table names the same three ----------------------
names = SQL / "2026_09_01_01_classless_body_type.sql"
if not names.is_file():
    print(f"3. body type names      -> {names.name} absent, nothing to check")
else:
    listed = {
        int(cls): name
        for cls, name in re.findall(r"\((\d+),\s*'([A-Za-z]+)'", names.read_text(encoding="utf-8"))
    }
    if set(listed) != ALLOWED:
        fails.append(
            f"{names.name} names {describe(set(listed))}, "
            f"but the body types are {describe(ALLOWED)}"
        )
    else:
        wrong = {
            cls: got
            for cls, got in listed.items()
            if ta.BODY_TYPE_CLASSES.get(got) != cls
        }
        if wrong:
            fails.append(f"{names.name} maps {wrong}, which disagrees with BODY_TYPE_CLASSES")
        else:
            print(f"3. body type names      -> {', '.join(f'{n}={c}' for c, n in sorted(listed.items()))}")

# --- 4. the launcher recipe keeps the same three ---------------------------
#
# The client half of the same decision. If these two ever disagree the screen
# offers body types the realm refuses, which is the failure the whole patch
# exists to avoid.
recipe = Path("launcher/recipes/body-types.json")
if not recipe.is_file():
    print("4. launcher recipe      -> absent, nothing to check")
else:
    import json

    keep = set(json.loads(recipe.read_text(encoding="utf-8"))["char_base_info"]["keep_classes"])
    if keep != ALLOWED:
        fails.append(
            f"{recipe} keeps {describe(keep)} but the realm's body types are {describe(ALLOWED)}"
        )
    else:
        print(f"4. launcher recipe      -> {describe(keep)}")

print()
print("FAILURES:" if fails else "migrations agree with the body types")
for f in fails:
    print("  -", f)
sys.exit(1 if fails else 0)
