#!/usr/bin/env python3
"""
gen_trees.py - generate the classless ability tree SQL, verifying every spell.

Every spell id here is checked against the world database before a line of SQL
is emitted. A spell that cannot be proven to exist fails the run rather than
shipping a node that silently does nothing when a player buys it.

Two proofs are accepted:
  trainer_spell  - the spell is trainable, and gives an authoritative ReqLevel
  spell_ranks    - the spell is a member of a rank chain, so it exists

    python3 tools/gen_trees.py            # verify and print a summary
    python3 tools/gen_trees.py --write    # also write the SQL migration

Pricing target (docs/PHASE2-BUDGET.md): the whole pool must cost far more than
a level 80 budget of 71 points, so a maxed character affords 30-50% of it.
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ta import load_local, mysql_cmd, REPO, c

# Cost by tier. 2+3+4+5+6 = 20 points per tree.
TIER_COST = {1: 2, 2: 3, 3: 4, 4: 5, 5: 6}

# (spell_id, display name, fallback level when not trainer-taught)
TREES = [
    (1, "Fire", "Destructive flame. The highest damage, and the least subtlety.", [
        (133,   "Fireball",         1), (2136,  "Fire Blast",     6),
        (2120,  "Flamestrike",     16), (2948,  "Scorch",        22),
        (11113, "Blast Wave",      40),
    ]),
    (2, "Frost", "Cold and control. Slower, safer, relentless.", [
        (116,   "Frostbolt",        4), (122,   "Frost Nova",    10),
        (10,    "Blizzard",        20), (120,   "Cone of Cold",  26),
        (45438, "Ice Block",       30),
    ]),
    (3, "Arcane", "Raw magic, bent to utility as often as to harm.", [
        (1459,  "Arcane Intellect", 1), (5143,  "Arcane Missiles", 8),
        (1449,  "Arcane Explosion",14), (1953,  "Blink",          20),
        (2139,  "Counterspell",    24),
    ]),
    (4, "Holy", "Light and mending. Keeps others upright.", [
        (1243,  "Power Word: Fortitude", 1), (17, "Power Word: Shield", 6),
        (139,   "Renew",            8), (2054,  "Heal",           16),
        (2061,  "Flash Heal",      20),
    ]),
    (5, "Shadow", "Rot, dread and slow ruin.", [
        (589,   "Shadow Word: Pain", 4), (172,  "Corruption",      4),
        (980,   "Curse of Agony",    8), (8092, "Mind Blast",     10),
        (689,   "Drain Life",       14),
    ]),
    (6, "Nature", "Growth, snare and restoration.", [
        (1126,  "Mark of the Wild", 1), (774,   "Rejuvenation",    4),
        (339,   "Entangling Roots", 8), (8936,  "Regrowth",       12),
        (2637,  "Hibernate",       18),
    ]),
    (7, "Sword Mastery", "Weapon craft. Rewards closing the distance.", [
        (78,    "Heroic Strike",    1), (772,   "Rend",            4),
        (6343,  "Thunder Clap",     6), (845,   "Cleave",         20),
        (5308,  "Execute",         24),
    ]),
    (8, "Defense", "Shields, shouts and staying alive.", [
        (6673,  "Battle Shout",     1), (100,   "Charge",          4),
        (72,    "Shield Bash",     12), (6572,  "Revenge",        14),
        (2565,  "Shield Block",    16),
    ]),
    (9, "Stealth", "Shadow and opportunity. Strike from where none look.", [
        (1784,  "Stealth",          1), (53,    "Backstab",        4),
        (1776,  "Gouge",            6), (2983,  "Sprint",         10),
        (8676,  "Ambush",          18),
    ]),
    (10, "Marksmanship", "Range, traps and patience.", [
        (1978,  "Serpent Sting",    4), (3044,  "Arcane Shot",     6),
        (5116,  "Concussive Shot",  8), (2643,  "Multi-Shot",     18),
        (1499,  "Freezing Trap",   20),
    ]),
]


def query(cfg, sql):
    cmd = mysql_cmd(cfg, cfg["db_world"]) + ["-N", "-B", "-e", sql]
    proc = subprocess.run([str(x) for x in cmd], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"query failed: {proc.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return [l.split("\t") for l in proc.stdout.strip().splitlines() if l.strip()]


def verify(cfg):
    """Prove every spell exists. Returns {spell_id: (trainer_level_or_None)}."""
    ids = sorted({sid for _, _, _, nodes in TREES for sid, _, _ in nodes})
    idlist = ",".join(str(i) for i in ids)

    trainable = {int(r[0]): int(r[1]) for r in query(cfg,
        f"SELECT ts.SpellId, MIN(ts.ReqLevel) FROM trainer_spell ts "
        f"JOIN trainer t ON t.Id = ts.TrainerId "
        f"WHERE t.Type = 0 AND ts.SpellId IN ({idlist}) GROUP BY ts.SpellId;")}

    ranked = {int(r[0]) for r in query(cfg,
        f"SELECT DISTINCT spell_id FROM spell_ranks WHERE spell_id IN ({idlist}) "
        f"UNION SELECT DISTINCT first_spell_id FROM spell_ranks WHERE first_spell_id IN ({idlist});")}

    unproven = [i for i in ids if i not in trainable and i not in ranked]
    return trainable, ranked, unproven


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write the SQL migration")
    args = ap.parse_args()
    cfg = load_local()

    trainable, ranked, unproven = verify(cfg)

    if unproven:
        print(c("  FAILED: these spell ids could not be proven to exist:", "red"))
        for i in unproven:
            print(f"    {i}")
        print("\n  Refusing to emit SQL. A node whose spell does not exist takes a")
        print("  player's points and gives them nothing.")
        return 1

    total = 0
    lines = []
    for tree_id, name, desc, nodes in TREES:
        tree_total = 0
        for tier, (sid, label, fallback) in enumerate(nodes, start=1):
            cost = TIER_COST[tier]
            # Prefer the game's own level requirement; fall back to ours only
            # where the spell is not trainer-taught.
            level = trainable.get(sid, fallback)
            node_id = tree_id * 100 + tier
            prev = (tree_id * 100 + tier - 1) if tier > 1 else 0
            src = "trainer" if sid in trainable else "ranks"
            lines.append((node_id, tree_id, sid, label, tier, cost, level, prev, src))
            tree_total += cost
        total += tree_total
        print(f"  {name:<15} {len(nodes)} nodes, {tree_total:>3} pts")

    budget80 = 71
    pct = budget80 / total * 100
    print()
    print(f"  pool total       : {total} points")
    print(f"  level 80 budget  : {budget80} points")
    print(f"  affordable share : {pct:.0f}%", end="  ")
    print(c("in the 30-50% target", "green") if 30 <= pct <= 50 else c("OUTSIDE the 30-50% target", "red"))
    print(f"  levels from game data: {sum(1 for l in lines if l[8]=='trainer')}/{len(lines)}")

    if not args.write:
        print("\n  (dry run - pass --write to emit the migration)")
        return 0

    out = REPO / "modules/mod-classless/data/sql/db-world/2026_08_26_01_classless_trees.sql"
    with out.open("w", encoding="utf-8") as f:
        f.write("-- Tomorrow's Ash - classless ability trees\n--\n")
        f.write("-- GENERATED by tools/gen_trees.py. Edit that, not this file.\n--\n")
        f.write("-- Every spell id below was verified against the world database before\n")
        f.write("-- this file was written: either trainable (trainer_spell, which also\n")
        f.write("-- supplies the level requirement) or a member of a rank chain\n")
        f.write("-- (spell_ranks). The generator refuses to emit SQL otherwise.\n--\n")
        f.write(f"-- Pool total: {total} points against a level 80 budget of {budget80} "
                f"({pct:.0f}% affordable).\n")
        f.write("-- See docs/PHASE2-BUDGET.md for why that ratio matters.\n\n")
        f.write("DELETE FROM `classless_node` WHERE `id` BETWEEN 1 AND 9999;\n")
        f.write("DELETE FROM `classless_tree` WHERE `id` BETWEEN 1 AND 9999;\n\n")

        f.write("INSERT INTO `classless_tree` (`id`, `name`, `description`, `sort_order`) VALUES\n")
        f.write(",\n".join(
            f"  ({t}, '{n}', '{d.replace(chr(39), chr(39)*2)}', {t*10})"
            for t, n, d, _ in TREES) + ";\n\n")

        f.write("INSERT INTO `classless_node`\n")
        f.write("  (`id`, `tree_id`, `spell_id`, `name`, `description`, `tier`, `cost`, "
                "`required_level`, `requires_node`, `sort_order`)\nVALUES\n")
        rows = []
        for node_id, tree_id, sid, label, tier, cost, level, prev, src in lines:
            safe = label.replace("'", "''")
            rows.append(f"  ({node_id}, {tree_id}, {sid}, '{safe}', '', "
                        f"{tier}, {cost}, {level}, {prev}, {tier*10})")
        f.write(",\n".join(rows) + ";\n")

    print(f"\n  wrote {out.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
