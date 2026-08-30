#!/usr/bin/env python3
"""
make_icons.py - generate the launcher's icons.

The mark is the one thing LAUNCHER-DESIGN.md allows to be warm: an ember on
cold graphite, meaning what it means everywhere else in this project - the
realm is alive. There is no game art in it, which is the design position and
also the reason it cannot accidentally infringe anything (ADR 0005, rule 5).

Drawn in code rather than committed as binaries someone would have to trust:
run this and you get exactly what is in the repository.

    python3 launcher/tools/make_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

ICONS = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"

GROUND = (0x14, 0x16, 0x1A)
RING = (0x3A, 0x41, 0x4C)
EMBER = (0xFF, 0x6A, 0x1F)
BONE = (0xE6, 0xE9, 0xEE)


def draw(size):
    """RGBA pixels for one square icon."""
    centre = (size - 1) / 2
    ember_r = size * 0.17
    ring_r = size * 0.40
    bar_half_w = size * 0.20
    bar_y = size * 0.72
    bar_half_h = max(size * 0.022, 0.5)

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx, dy = x - centre, y - centre
            distance = math.hypot(dx, dy)

            colour, alpha = GROUND, 255

            # The ring: a hairline that gives the mark an edge on a dark taskbar.
            if abs(distance - ring_r) < size * 0.012:
                colour = RING

            # The bone bar: the readout strip, abstracted.
            if abs(dy - (bar_y - centre)) < bar_half_h and abs(dx) < bar_half_w:
                colour = BONE

            # The ember, with one pixel of feathering so it is not aliased hard.
            if distance < ember_r:
                colour = EMBER
            elif distance < ember_r + 1:
                blend = ember_r + 1 - distance
                colour = tuple(
                    round(EMBER[i] * blend + GROUND[i] * (1 - blend)) for i in range(3)
                )

            row += bytes((*colour, alpha))
        rows.append(bytes(row))
    return rows


def png(size):
    rows = draw(size)
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(kind, payload):
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def ico(images):
    """A Windows .ico holding PNG-compressed entries, which Vista onward reads."""
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries, blobs = b"", b""
    for size, blob in images:
        entries += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,
            size if size < 256 else 0,
            0,
            0,
            1,
            32,
            len(blob),
            offset,
        )
        blobs += blob
        offset += len(blob)
    return header + entries + blobs


def main():
    ICONS.mkdir(parents=True, exist_ok=True)

    written = []
    for name, size in [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
    ]:
        (ICONS / name).write_bytes(png(size))
        written.append(name)

    (ICONS / "icon.ico").write_bytes(ico([(s, png(s)) for s in (16, 32, 48, 256)]))
    written.append("icon.ico")

    for name in written:
        print(f"{ICONS / name}  {(ICONS / name).stat().st_size} bytes")


if __name__ == "__main__":
    main()
