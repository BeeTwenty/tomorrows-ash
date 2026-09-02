#!/usr/bin/env python3
"""
check_client_combos.py - which race/class pairs will the CLIENT actually offer?

The server and the client disagree about this, and only one of them is visible
to a player. `playercreateinfo` decides what the server will accept; the 3.3.5a
client builds its creation screen from its own CharBaseInfo.dbc and refuses
locally, without ever sending CMSG_CHAR_CREATE. So a race/class pair can be
present on the server, correct in every migration, and still produce

    "You must choose a different race to be this class"

That is not the server failing. It is the client never asking.

This reads the extracted DBC and reports, per race, which body types the client
will offer against which the server accepts - the two halves that have to agree
before a claim about race coverage means anything to a player.

    python3 tools/check_client_combos.py
    python3 tools/check_client_combos.py --dbc /path/to/CharBaseInfo.dbc

Needs extracted client data (`ta.py extract`). Without it, says so and stops
rather than guessing.
"""

import argparse
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ta import load_local, mysql_cmd, REPO, c, ok, warn, info, BODY_TYPE_CLASSES

RACE_NAMES = {1: "Human", 2: "Orc", 3: "Dwarf", 4: "Night Elf", 5: "Undead",
              6: "Tauren", 7: "Gnome", 8: "Troll", 10: "Blood Elf", 11: "Draenei"}


def read_char_base_info(path):
    """Every (race, class) pair the client will offer.

    CharBaseInfo.dbc is the odd one out among the DBCs: a standard 20-byte WDBC
    header followed by two-byte records, one uint8 race and one uint8 class.
    Read the record size from the header rather than assuming 2, so a wrong
    file fails loudly instead of returning plausible nonsense.
    """
    data = Path(path).read_bytes()
    if len(data) < 20 or data[:4] != b"WDBC":
        raise ValueError(f"{path}: not a WDBC file (magic is {data[:4]!r})")

    record_count, field_count, record_size, string_size = struct.unpack("<4I", data[4:20])
    expected = 20 + record_count * record_size + string_size
    if len(data) != expected:
        raise ValueError(f"{path}: header says {expected} bytes, file is {len(data)}")
    if record_size < 2:
        raise ValueError(f"{path}: record size {record_size} is too small for a race/class pair")

    pairs = set()
    for i in range(record_count):
        offset = 20 + i * record_size
        pairs.add((data[offset], data[offset + 1]))
    return pairs, record_count, field_count, record_size


def server_pairs(cfg):
    cmd = mysql_cmd(cfg, cfg["db_world"]) + [
        "-N", "-B", "-e", "SELECT race, class FROM playercreateinfo"]
    proc = subprocess.run([str(x) for x in cmd], capture_output=True, text=True)
    if proc.returncode != 0:
        warn(f"could not read playercreateinfo: {proc.stderr.strip()}")
        return None
    return {(int(r.split("\t")[0]), int(r.split("\t")[1]))
            for r in proc.stdout.strip().splitlines() if r.strip()}


def default_dbc():
    return REPO / "data" / "client" / "dbc" / "CharBaseInfo.dbc"


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dbc", help="path to CharBaseInfo.dbc (default: data/client/dbc/)")
    args = p.parse_args()

    path = Path(args.dbc) if args.dbc else default_dbc()
    if not path.is_file():
        warn(f"{path} not found.")
        info("This needs extracted client data: python3 tools/ta.py extract --client PATH")
        info("Without it, what the client offers cannot be checked - only what the")
        info("server accepts, which is the half that is not visible to a player.")
        return 2

    try:
        client, count, fields, size = read_char_base_info(path)
    except ValueError as exc:
        warn(str(exc))
        return 1

    print()
    print(c("  Race/body-type coverage: client vs server", "blue"))
    print(f"  {path}")
    print(f"  {count} records, {fields} fields, {size} bytes each")
    print()

    server = server_pairs(load_local())

    header = f"     {'race':<11}" + "".join(f"{n:<14}" for n in BODY_TYPE_CLASSES)
    print(header)
    blocked = []
    for race in sorted(RACE_NAMES):
        cells = ""
        for name, class_id in BODY_TYPE_CLASSES.items():
            in_client = (race, class_id) in client
            in_server = server is None or (race, class_id) in server
            if in_client and in_server:
                cells += f"{'playable':<14}"
            elif in_server and not in_client:
                cells += f"{'CLIENT BLOCKS':<14}"
                blocked.append((race, name))
            elif in_client and not in_server:
                cells += f"{'no server row':<14}"
            else:
                cells += f"{'-':<14}"
        print(f"     {RACE_NAMES[race]:<11}{cells}")

    print()
    if blocked:
        warn(f"{len(blocked)} race/body-type pairs the server accepts and the client will not offer.")
        warn("The creation screen reads CharBaseInfo.dbc; no server change reaches it.")
        warn("Only a client patch makes these selectable - docs/BODY-TYPES.md section 4.")
    else:
        ok("client and server agree on every race/body-type pair")
    return 0


if __name__ == "__main__":
    sys.exit(main())
