"""The CharBaseInfo.dbc reader, proven against a file built by hand.

There is no client in the build environment, so the parser is checked against a
synthetic WDBC with known contents - including deliberately malformed ones, so
a wrong file fails loudly instead of returning plausible nonsense. That matters
here more than usual: a parser that silently returns an empty set would report
"the client blocks everything", which looks like a finding rather than a bug.

    python3 tools/tests/test_charbaseinfo.py
"""

import struct
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, "tools")
from check_client_combos import read_char_base_info

fails = []


def build(pairs, record_size=2, magic=b"WDBC", string_size=0, lie_about_count=None):
    count = lie_about_count if lie_about_count is not None else len(pairs)
    out = magic + struct.pack("<4I", count, 2, record_size, string_size)
    for race, klass in pairs:
        rec = bytes([race, klass]) + bytes(record_size - 2)
        out += rec
    return out + bytes(string_size)


def write(data):
    handle = tempfile.NamedTemporaryFile(suffix=".dbc", delete=False)
    handle.write(data)
    handle.close()
    return handle.name


# --- 1. a normal file round-trips ---
# The stock Alliance Paladin set: Human, Dwarf, Draenei, Blood Elf(Horde).
stock = {(1, 2), (3, 2), (11, 2), (10, 2), (1, 8), (7, 8), (2, 7)}
pairs, count, fields, size = read_char_base_info(write(build(sorted(stock))))
if pairs != stock:
    fails.append(f"round-trip lost pairs: got {sorted(pairs)}")
elif count != len(stock) or size != 2:
    fails.append(f"header misread: count={count} size={size}")
else:
    print(f"1. round-trip           -> {len(pairs)} pairs read back exactly")

# --- 2. a wider record size still reads race/class from the first two bytes ---
pairs, _, _, size = read_char_base_info(write(build(sorted(stock), record_size=8)))
if pairs != stock:
    fails.append("record_size 8 misparsed")
else:
    print(f"2. wider records        -> race/class still read, record_size={size}")

# --- 3. not a DBC at all ---
try:
    read_char_base_info(write(b"NOPE" + bytes(64)))
    fails.append("a non-WDBC file was accepted")
except ValueError as exc:
    print(f"3. wrong magic          -> refused ({str(exc).split(':')[-1].strip()[:40]})")

# --- 4. truncated file: header promises more than exists ---
try:
    read_char_base_info(write(build(sorted(stock), lie_about_count=99)))
    fails.append("a truncated file was accepted")
except ValueError as exc:
    print("4. truncated file       -> refused")

# --- 5. a record too small to hold a race/class pair ---
try:
    read_char_base_info(write(b"WDBC" + struct.pack("<4I", 1, 1, 1, 0) + b"\x01"))
    fails.append("a 1-byte record size was accepted")
except ValueError:
    print("5. record size 1        -> refused")

# --- 6. an empty but valid file reads as empty, and does NOT throw ---
# This is the case that would masquerade as a finding, so it must be explicit.
pairs, count, _, _ = read_char_base_info(write(b"WDBC" + struct.pack("<4I", 0, 2, 2, 0)))
if pairs or count:
    fails.append("an empty file did not read as empty")
else:
    print("6. empty but valid      -> reads as empty, no exception")

print()
print("FAILURES:" if fails else "all CharBaseInfo parser tests passed")
for f in fails:
    print("  -", f)
sys.exit(1 if fails else 0)
