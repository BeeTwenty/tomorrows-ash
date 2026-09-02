"""Module chat and log formatting must use fmt placeholders, not printf.

ChatHandler::PSendSysMessage forwards to Acore::StringFormat (Chat.h:140), and
LOG_* do the same. Those are fmt: the placeholder is {}, and a %s is printed
literally with the arguments silently dropped.

That is not a compile error and not a crash. It ships, and the player sees

    [Ashmorrow] You are playing as: %s (%s armor). %s

which is exactly what reached a playtest. Every GM command in the module had
the same bug for weeks; nobody noticed because nobody ran them.

    python3 tools/tests/test_format_strings.py
"""

import re
import sys
from pathlib import Path

SRC = Path("modules/mod-classless/src")

# Calls whose first argument is an fmt format string.
FMT_CALLS = ("PSendSysMessage", "SendSysMessage", "PGetParseString",
             "LOG_INFO", "LOG_ERROR", "LOG_WARN", "LOG_DEBUG", "LOG_TRACE", "LOG_FATAL")

# %s %u %d %i %f %x %lu etc. Escaped %% pairs are stripped BEFORE scanning
# rather than skipped with a lookahead: "100%% done" would otherwise match
# "% d" as a space-flagged %d, which the self-test below caught.
PRINTF = re.compile(r"%[-+ #0]*[\d.*]*(?:hh|h|ll|l|j|z|t|L)?[diouxXeEfgGaAcspn]")


def printf_placeholders(literal):
    return PRINTF.findall(literal.replace("%%", ""))

fails = []
checked = 0

for path in sorted(SRC.glob("*.cpp")) + sorted(SRC.glob("*.h")):
    text = path.read_text(encoding="utf-8")
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not any(call in line for call in FMT_CALLS):
            continue
        # Only look inside the string literals on this line.
        for literal in re.findall(r'"((?:[^"\\]|\\.)*)"', line):
            checked += 1
            found = printf_placeholders(literal)
            if found:
                fails.append(f"{path}:{lineno}: printf placeholder {found} in an fmt call\n"
                             f"    {line.strip()[:100]}")

print(f"checked {checked} format literals across {len(list(SRC.glob('*.cpp')))} sources")

# Prove the check can actually fail, rather than passing because it matches
# nothing. This is the mistake that produced two false 'verified' reports.
probe = 'handler->PSendSysMessage("You are playing as: %s (%s armor).", a, b);'
if not printf_placeholders(re.findall(r'"((?:[^"\\]|\\.)*)"', probe)[0]):
    fails.append("self-test: the detector does not catch a known-bad line")
else:
    print("self-test               -> a known-bad line is caught")

literal_percent = 'LOG_INFO("x", "100%% done {}", n);'
if printf_placeholders(re.findall(r'"((?:[^"\\]|\\.)*)"', literal_percent)[1]):
    fails.append("self-test: %% (a literal percent) was wrongly flagged")
else:
    print("self-test               -> a literal %% is not flagged")

print()
print("FAILURES:" if fails else "all format strings use fmt placeholders")
for f in fails:
    print("  -", f)
sys.exit(1 if fails else 0)
