#!/usr/bin/env python3
"""
spell_cascade.py - what does granting this spell actually drag in?

Before adding an ability to a classless tree, run it through here. AzerothCore's
Player::learnSpell() can recurse into other spells, and a node that silently
grants six extra abilities is a balance hole.

    python3 tools/spell_cascade.py 133 12294
    python3 tools/spell_cascade.py --ranks 133

Reads the world database directly, so it works without a WoW client. The two
cascade sources are both SQL tables:

    spell_ranks     -> SpellMgr::GetNextSpellInChain      (rank chains)
    spell_required  -> SpellMgr::GetSpellsRequiringSpellBounds

What this CANNOT determine without client DBCs: whether a spell is
talent-derived. That comes from Talent.dbc via GetTalentSpellCost(), and it
decides whether the spell is learned per-spec or globally
(Player::GetLearnSpellSpecMask). Spells flagged "SPEC RISK" below need a
runtime check on a server that has client data loaded.
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ta import load_local, mysql_cmd, c  # reuse the CLI's config + connection plumbing


def query(cfg, sql):
    """Run a query against the world DB, return rows as lists of strings."""
    cmd = mysql_cmd(cfg, cfg["db_world"]) + ["-N", "-B", "-e", sql]
    proc = subprocess.run([str(x) for x in cmd], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"query failed: {proc.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return [line.split("\t") for line in proc.stdout.strip().splitlines() if line.strip()]


def chain_for(cfg, spell_id):
    """Return [(spell_id, rank)] for the chain this spell belongs to, or []."""
    rows = query(cfg, f"SELECT first_spell_id FROM spell_ranks WHERE spell_id = {spell_id} LIMIT 1;")
    root = rows[0][0] if rows else None
    if root is None:
        rows = query(cfg, f"SELECT COUNT(*) FROM spell_ranks WHERE first_spell_id = {spell_id};")
        if not rows or rows[0][0] == "0":
            return []
        root = str(spell_id)
    return [(r[0], r[1]) for r in
            query(cfg, f"SELECT spell_id, `rank` FROM spell_ranks WHERE first_spell_id = {root} ORDER BY `rank`+0;")]


def analyse(cfg, spell_id):
    print(c(f"\n=== spell {spell_id} ===", "blue"))

    chain = chain_for(cfg, spell_id)
    if chain:
        pos = next((rank for sid, rank in chain if sid == str(spell_id)), "?")
        print(f"  rank chain      : {len(chain)} ranks, this spell is rank {pos}")
        print(f"                    {', '.join(f'{s}(r{r})' for s, r in chain)}")
        nxt = None
        for i, (sid, _) in enumerate(chain):
            if sid == str(spell_id) and i + 1 < len(chain):
                nxt = chain[i + 1][0]
        if nxt:
            print(f"  next in chain   : {nxt}")
            print(c("  cascade on grant: NONE for a fresh character.", "green"))
            print("                    learnSpell() only recurses into the next rank when it is")
            print("                    ALREADY in m_spells but inactive in the current spec")
            print("                    (Player.cpp:3434-3441). A character who does not know the")
            print("                    higher rank gets exactly this one spell.")
        else:
            print("  next in chain   : none (highest rank)")
    else:
        print("  rank chain      : none - standalone spell")

    reqs = query(cfg, f"SELECT req_spell FROM spell_required WHERE spell_id = {spell_id};")
    if reqs:
        print(f"  requires        : {', '.join(r[0] for r in reqs)}")
    dependents = query(cfg, f"SELECT spell_id FROM spell_required WHERE req_spell = {spell_id};")
    if dependents:
        print(f"  depended on by  : {', '.join(r[0] for r in dependents)}")
        print(c("  cascade on grant: NONE for a fresh character (same already-known rule,", "green"))
        print("                    Player.cpp:3444-3450).")
    if not reqs and not dependents:
        print("  spell_required  : no entries either direction")

    linked = query(cfg, f"SELECT spell_effect, type FROM spell_linked_spell WHERE spell_trigger = {spell_id};")
    if linked:
        print(c(f"  linked spells   : {len(linked)} - fires on cast, review these", "yellow"))
        for eff, typ in linked[:8]:
            print(f"                    effect {eff} (type {typ})")

    # Talent-derived spells are learned per-spec, so they can vanish on a spec
    # switch. We cannot detect that from SQL - it needs Talent.dbc.
    print(c("  SPEC RISK       : undetermined without client DBCs.", "yellow"))
    print("                    If this spell is talent-derived, GetLearnSpellSpecMask()")
    print("                    (Player.cpp:3453) learns it into the ACTIVE SPEC ONLY, and it")
    print("                    disappears when the player switches spec. Verify on a server")
    print("                    with client data before shipping this node.")


def main():
    ap = argparse.ArgumentParser(description="Report what granting a spell drags in.")
    ap.add_argument("spell_ids", nargs="+", type=int)
    ap.add_argument("--ranks", action="store_true", help="only print the rank chain, one per line")
    args = ap.parse_args()
    cfg = load_local()

    if args.ranks:
        for sid in args.spell_ids:
            for s, r in chain_for(cfg, sid):
                print(f"{s}\t{r}")
        return 0

    for sid in args.spell_ids:
        analyse(cfg, sid)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
