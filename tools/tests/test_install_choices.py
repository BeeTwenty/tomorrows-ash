"""Installer choice tests.

The installer asks questions whose answers become the realm's configuration,
so a wrong answer is a broken install rather than a cosmetic problem. Two of
the bugs these caught would have failed silently: a --db flag storing the menu
label ("MySQL on another machine") instead of the key ("remote"), and
--db-password storing the literal asterisks shown on screen.

    python3 tools/tests/test_install_choices.py
"""

import sys, json, argparse
from unittest import mock
sys.path.insert(0, "tools")
import ta

def run(answers, secrets_, args_kw, docker_up=True):
    """Drive the config questions with scripted answers.

    docker_up is mocked rather than probed: whether this machine happens to be
    running a Docker daemon must not decide whether the choice plumbing is
    correct, and the daemon-down path gets its own test below.
    """
    it = iter(answers)
    sec = iter(secrets_)
    args = argparse.Namespace(db=None, db_host=None, db_port=None, db_user=None,
                              db_password=None, realm_name=None, realm_address=None,
                              realm_port=None, reconfigure=False, **args_kw)
    p = ta.Prompt(assume_yes=False)
    p.interactive = True
    with mock.patch("builtins.input", lambda *a: next(it)), \
         mock.patch("getpass.getpass", lambda *a: next(sec)), \
         mock.patch.object(ta, "docker_available", lambda: docker_up), \
         mock.patch("shutil.which", lambda name: "/usr/bin/" + name):
        return ta.ensure_local_config(p, args)

fails = []

# --- 1. local MySQL, custom everything ---
(ta.REPO / "tools" / "local.json").unlink(missing_ok=True)
cfg, mode = run(["2", "10.0.0.5", "3307", "ashadmin", "Ashmorrow", "192.168.1.50", "8085"],
                ["hunter2"], {})
exp = dict(db_mode="local", mysql_host="10.0.0.5", mysql_port=3307, mysql_user="ashadmin",
           mysql_pass="hunter2", realm_name="Ashmorrow", realm_address="192.168.1.50",
           realm_port=8085)
for k, v in exp.items():
    if cfg.get(k) != v: fails.append(f"local: {k} = {cfg.get(k)!r}, expected {v!r}")
print(f"1. local MySQL          -> mode={mode} host={cfg['mysql_host']}:{cfg['mysql_port']} "
      f"user={cfg['mysql_user']} realm={cfg['realm_address']}:{cfg['realm_port']}")

# --- 2. remote MySQL ---
(ta.REPO / "tools" / "local.json").unlink(missing_ok=True)
cfg, mode = run(["3", "db.homelab.lan", "3306", "acore", "Ashmorrow", "192.168.1.50", "8085"],
                ["s3cret"], {})
if mode != "remote" or cfg["mysql_host"] != "db.homelab.lan":
    fails.append(f"remote: got mode={mode} host={cfg.get('mysql_host')}")
print(f"2. remote MySQL         -> mode={mode} host={cfg['mysql_host']}")

# --- 3. docker, generated password ---
(ta.REPO / "tools" / "local.json").unlink(missing_ok=True)
cfg, mode = run(["1", "3306", "Ashmorrow", "127.0.0.1", "8085"], [""], {})
if mode != "docker": fails.append(f"docker: got mode={mode}")
if len(cfg["mysql_pass"]) < 16: fails.append("docker: password was not generated")
print(f"3. docker (blank pass)  -> mode={mode} generated a {len(cfg['mysql_pass'])}-char password")

# --- 4. flags win over prompts (should ask nothing) ---
(ta.REPO / "tools" / "local.json").unlink(missing_ok=True)
args = argparse.Namespace(db="remote", db_host="10.1.1.1", db_port="3399", db_user="flaguser",
                          db_password="flagpass", realm_name="FlagRealm",
                          realm_address="10.1.1.2", realm_port="9000", reconfigure=False)
p = ta.Prompt(assume_yes=False); p.interactive = True
def boom(*a): raise AssertionError("prompted despite a flag being supplied")
with mock.patch("builtins.input", boom), mock.patch("getpass.getpass", boom):
    cfg, mode = ta.ensure_local_config(p, args)
exp = dict(db_mode="remote", mysql_host="10.1.1.1", mysql_port=3399, mysql_user="flaguser",
           mysql_pass="flagpass", realm_name="FlagRealm", realm_address="10.1.1.2", realm_port=9000)
for k, v in exp.items():
    if cfg.get(k) != v: fails.append(f"flags: {k} = {cfg.get(k)!r}, expected {v!r}")
print(f"4. all flags, no prompt -> mode={mode} host={cfg['mysql_host']}:{cfg['mysql_port']}")

# --- 5. existing file is not clobbered without --reconfigure ---
before = json.loads((ta.REPO / "tools" / "local.json").read_text())
p = ta.Prompt(assume_yes=False); p.interactive = True
with mock.patch("builtins.input", lambda *a: "n"), mock.patch("getpass.getpass", boom):
    cfg, mode = ta.ensure_local_config(p, argparse.Namespace(
        db=None, db_host=None, db_port=None, db_user=None, db_password=None,
        realm_name=None, realm_address=None, realm_port=None, reconfigure=False))
after = json.loads((ta.REPO / "tools" / "local.json").read_text())
if before != after: fails.append("existing config was modified when the user declined")
if mode is not None: fails.append(f"declining reconfigure returned mode={mode}, expected None")
print(f"5. decline reconfigure  -> file unchanged: {before == after}")

# --- 6. invalid choice for a flag is rejected ---
try:
    p = ta.Prompt(assume_yes=True)
    p.choice("x", [("a","A","d"),("b","B","d")], override="nope")
    fails.append("invalid --db value was accepted")
except SystemExit:
    print("6. bad flag value       -> rejected")
except ta.Fail:
    print("6. bad flag value       -> rejected")

# --- 7. choosing Docker with a dead daemon warns and stops ---
(ta.REPO / "tools" / "local.json").unlink(missing_ok=True)
try:
    run(["1", "n"], [""], {}, docker_up=False)   # choose docker, then decline "continue anyway"
    fails.append("dead Docker daemon: expected the installer to stop")
except ta.Fail as exc:
    if "daemon" not in str(exc).lower():
        fails.append(f"dead Docker daemon: unexpected message {exc!r}")
    else:
        print("7. docker daemon down   -> refused, with a message naming the daemon")
except StopIteration:
    fails.append("dead Docker daemon: asked more questions than expected")

print()
print("FAILURES:" if fails else "all choice tests passed")
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
