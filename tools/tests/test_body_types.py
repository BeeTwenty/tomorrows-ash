"""Character creation is limited to the three body types.

The value in worldserver.conf is one number, and a wrong number fails quietly
in the worst possible way: the realm accepts a class it was supposed to refuse,
or refuses one it was supposed to allow, and nobody finds out until a player
hits it.

So the test evaluates the core's own expression rather than restating the
number. CharacterHandler.cpp:346 is:

    uint32 classMaskDisabled = sWorld->getIntConfig(CONFIG_CHARACTER_CREATING_DISABLED_CLASSMASK);
    if ((1 << (createInfo->Class - 1)) & classMaskDisabled)
        SendCharCreate(CHAR_CREATE_DISABLED);

    python3 tools/tests/test_body_types.py
"""

import sys
from pathlib import Path
sys.path.insert(0, "tools")
import ta

# 3.3.5a class ids. 10 does not exist; Druid is 11, which is why the "all
# classes" mask is 1535 (bit 512 unused) rather than 2047.
CLASSES = {1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest",
           6: "Death Knight", 7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid"}

ALLOWED = set(ta.BODY_TYPE_CLASSES.values())

fails = []
mask = ta.disabled_classmask()

# --- 1. the core's own check, run over every class ---
refused, permitted = [], []
for class_id, name in CLASSES.items():
    if (1 << (class_id - 1)) & mask:          # CharacterHandler.cpp:346
        refused.append(name)
    else:
        permitted.append(name)

expected_permitted = sorted(CLASSES[c] for c in ALLOWED)
if sorted(permitted) != expected_permitted:
    fails.append(f"permitted {sorted(permitted)}, expected {expected_permitted}")
else:
    print(f"1. creation permitted   -> {', '.join(sorted(permitted))}")
    print(f"   creation refused     -> {', '.join(sorted(refused))}")

# --- 2. the mask covers every class that exists, and invents none ---
if mask | ta.body_type_classmask() != ta.CLASSMASK_ALL_PLAYABLE:
    fails.append("disabled + allowed does not cover exactly the playable classes")
elif mask & ta.body_type_classmask():
    fails.append("a class is both allowed and disabled")
else:
    print(f"2. mask partitions      -> {mask} disabled + "
          f"{ta.body_type_classmask()} allowed = {ta.CLASSMASK_ALL_PLAYABLE}")

# --- 3. bit 512 is never set: no such class in 3.3.5 ---
if mask & 512:
    fails.append("bit 512 set, but no class 10 exists in 3.3.5")
else:
    print("3. no phantom class     -> bit 512 (class 10) left clear")

# --- 4. the three body types are the ones the docs say ---
# Cheap, but this is the mapping every other document depends on, and a typo
# here would silently re-point a body type at the wrong chassis.
if ta.BODY_TYPE_CLASSES != {"Vanguard": 2, "Skirmisher": 3, "Adept": 8}:
    fails.append(f"body type mapping changed: {ta.BODY_TYPE_CLASSES}")
else:
    print("4. body type mapping    -> Vanguard=Paladin(2), Skirmisher=Hunter(3), Adept=Mage(8)")

# --- 5. BODY-TYPES.md agrees with the code ---
doc = (Path("docs") / "BODY-TYPES.md").read_text(encoding="utf-8")
if f"ClassMask = {mask}" not in doc and f"ClassMask` = {mask}" not in doc:
    fails.append(f"docs/BODY-TYPES.md does not name the mask value {mask}")
else:
    print(f"5. docs agree           -> BODY-TYPES.md names ClassMask = {mask}")

print()
print("FAILURES:" if fails else "all body-type tests passed")
for f in fails:
    print("  -", f)
sys.exit(1 if fails else 0)
