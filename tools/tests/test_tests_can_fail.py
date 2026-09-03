"""Every validation test must prove its own detectors can fail.

This exists because the same bug has now shipped four times, in four unrelated
places, and fixing each instance was not converging:

  * a docs-coverage check that matched anywhere in the file, so it passed on
    text that said nothing;
  * a "the server logs no config error" check, run against a server that had
    died before it read any config;
  * an RBAC query written against the wrong column, whose empty result was
    read as proof of absence;
  * a chassis check whose regex looked for `class` where the SQL writes
    `Class`, so it matched nothing and printed "skipped".

The shape is always the same: **a check that cannot fail reports safety.** It
is worse than no check, because no check is visibly absent and a broken one
looks like evidence.

The general fix is not another instance-level fix. It is a standing
requirement: a test that scans, parses or queries anything must also run its
detector against input known to be bad, and say so. This meta-test enforces
that by running each test and requiring a line containing "self-test".

What it can and cannot do
-------------------------
It proves a self-test RAN. It cannot prove the self-test is a good one - that
still takes judgement, and a determined author can satisfy it with a token
line. What it does is make the omission impossible to reach by accident, which
is how all four of the above got in.

    python3 tools/tests/test_tests_can_fail.py
"""

import subprocess
import sys
from pathlib import Path

TESTS = Path("tools/tests")
SELF = Path(__file__).name

# Tests that legitimately have no detector to falsify. Each needs a reason, and
# "I did not get round to it" is not one - the point is that skipping is a
# deliberate, reviewed act rather than a silent default.
EXEMPT = {
    # (none today)
}

fails = []
checked = 0

for path in sorted(TESTS.glob("test_*.py")):
    if path.name == SELF:
        continue
    if path.name in EXEMPT:
        print(f"  {path.name:<38} exempt - {EXEMPT[path.name]}")
        continue

    checked += 1
    proc = subprocess.run([sys.executable, str(path)], capture_output=True, text=True)
    output = proc.stdout + proc.stderr

    if proc.returncode != 0:
        fails.append(f"{path.name}: exits {proc.returncode} - it is failing, fix that first")
        continue

    hits = [line.strip() for line in output.splitlines() if "self-test" in line.lower()]
    if not hits:
        fails.append(
            f"{path.name}: passes, but never demonstrates that it CAN fail.\n"
            f"      Add a case that feeds its detector known-bad input and assert the\n"
            f"      detector fires, printing a line containing 'self-test'."
        )
    else:
        print(f"  {path.name:<38} {len(hits)} self-test(s)")

print()
print(f"checked {checked} validation tests")
print("FAILURES:" if fails else "every validation test proves it can fail")
for f in fails:
    print("  -", f)
sys.exit(1 if fails else 0)
