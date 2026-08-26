#!/usr/bin/env python3
"""
ta.py - Tomorrow's Ash developer CLI.

One entry point for setting up, building and running the Ashmorrow realm on
both Windows and Linux. Standard library only, Python 3.8+.

    python3 tools/ta.py doctor       # check your machine has what it needs
    python3 tools/ta.py bootstrap    # fetch pinned AzerothCore + overlay our module
    python3 tools/ta.py configure    # run cmake configure
    python3 tools/ta.py build        # compile
    python3 tools/ta.py db up        # start MySQL (docker)
    python3 tools/ta.py db init      # create the three databases
    python3 tools/ta.py conf         # render server configs for realm Ashmorrow
    python3 tools/ta.py db realm     # register the Ashmorrow realm row
    python3 tools/ta.py run world    # start worldserver

See SETUP.md for the full walkthrough.
"""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UPSTREAM_JSON = REPO / "upstream.json"

IS_WINDOWS = platform.system() == "Windows"

# Defaults for the Ashmorrow realm. Override per-machine with tools/local.json
# (gitignored) or environment variables - see `load_local()`.
DEFAULTS = {
    "realm_name": "Ashmorrow",
    "realm_address": "127.0.0.1",
    "realm_port": 8085,
    "mysql_host": "127.0.0.1",
    "mysql_port": 3306,
    "mysql_user": "root",
    "mysql_pass": "ashmorrow",
    "db_auth": "acore_auth",
    "db_world": "acore_world",
    "db_characters": "acore_characters",
    "docker_container": "ashmorrow-mysql",
    "mysql_image": "mysql:8.4",
    "website_db_user": "ashweb",
    "website_db_pass": "",
    "build_type": "Release",
    "tools_build": "all",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

class Fail(Exception):
    pass


def c(text, colour):
    if IS_WINDOWS and not os.environ.get("WT_SESSION"):
        return text
    codes = {"red": 31, "green": 32, "yellow": 33, "blue": 34, "grey": 90}
    return f"\033[{codes[colour]}m{text}\033[0m"


def info(msg):
    print(f"{c('==>', 'blue')} {msg}", flush=True)


def ok(msg):
    print(f"{c('  OK', 'green')} {msg}", flush=True)


def warn(msg):
    print(f"{c('  !!', 'yellow')} {msg}", flush=True)


def die(msg):
    raise Fail(msg)


def run(cmd, cwd=None, check=True, env=None, quiet=False):
    """Run a command, streaming output."""
    if not quiet:
        printable = " ".join(str(x) for x in cmd)
        print(f"{c('  $', 'grey')} {c(printable, 'grey')}", flush=True)
    full_env = {**os.environ, **(env or {})}
    proc = subprocess.run([str(x) for x in cmd], cwd=str(cwd) if cwd else None, env=full_env)
    if check and proc.returncode != 0:
        die(f"command failed ({proc.returncode}): {' '.join(str(x) for x in cmd)}")
    return proc.returncode


def capture(cmd, cwd=None):
    proc = subprocess.run([str(x) for x in cmd], cwd=str(cwd) if cwd else None,
                          capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def load_upstream():
    if not UPSTREAM_JSON.exists():
        die(f"missing {UPSTREAM_JSON}")
    return json.loads(UPSTREAM_JSON.read_text(encoding="utf-8"))


def load_local():
    """Layer config: DEFAULTS < tools/local.json < TA_* environment variables."""
    cfg = dict(DEFAULTS)
    local_file = REPO / "tools" / "local.json"
    if local_file.exists():
        try:
            cfg.update(json.loads(local_file.read_text(encoding="utf-8")))
        except json.JSONDecodeError as exc:
            die(f"tools/local.json is not valid JSON: {exc}")
    for key in list(cfg):
        env_key = "TA_" + key.upper()
        if env_key in os.environ:
            raw = os.environ[env_key]
            cfg[key] = int(raw) if isinstance(cfg[key], int) and raw.isdigit() else raw
    return cfg


def acore_dir():
    return REPO / load_upstream().get("checkout_dir", ".acore")


def build_dir():
    return REPO / "build"


def dist_dir():
    return REPO / "dist"


def need(tool, hint):
    path = shutil.which(tool)
    if not path:
        die(f"'{tool}' not found on PATH. {hint}")
    return path


# --------------------------------------------------------------------------
# doctor
# --------------------------------------------------------------------------

def cmd_doctor(args):
    cfg = load_local()
    up = load_upstream()
    print()
    info("Tomorrow's Ash environment check")
    print(f"     repo         : {REPO}")
    print(f"     platform     : {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"     python       : {sys.version.split()[0]}")
    print(f"     upstream pin : {up['base']['name']} @ {up['base']['pinned_commit'][:12]} ({up['base']['pinned_date']})")
    print()

    problems = []

    def check(tool, hint, required=True):
        path = shutil.which(tool)
        if path:
            rc, out, _ = capture([tool, "--version"])
            first = out.splitlines()[0] if out else ""
            ok(f"{tool:<10} {first[:60]}")
        else:
            if required:
                problems.append(f"{tool} missing - {hint}")
                print(f"{c('  XX', 'red')} {tool:<10} MISSING - {hint}")
            else:
                warn(f"{tool:<10} not found (optional) - {hint}")

    check("git", "install Git")
    check("cmake", "install CMake 3.16+")
    check("mysql", "mysql CLIENT binary; AzerothCore needs it to apply SQL updates "
                   "(Linux: apt install mysql-client)")
    check("docker", "needed for `ta.py db up`; skip if you run MySQL natively", required=False)

    if IS_WINDOWS:
        warn("On Windows the compiler comes from Visual Studio - see SETUP.md")
    else:
        check("make", "apt install build-essential", required=False)
        check("ninja", "apt install ninja-build (optional, faster)", required=False)
        if not shutil.which("clang++") and not shutil.which("g++"):
            problems.append("no C++ compiler (clang++ or g++)")
            print(f"{c('  XX', 'red')} no C++ compiler found")
        else:
            ok(f"compiler   {shutil.which('clang++') or shutil.which('g++')}")

    print()
    if acore_dir().exists():
        rc, head, _ = capture(["git", "rev-parse", "HEAD"], cwd=acore_dir())
        state = "matches pin" if head == up["base"]["pinned_commit"] else c("DOES NOT match pin", "yellow")
        ok(f"core checkout present at {acore_dir().name}/ -> {head[:12]} ({state})")
    else:
        warn(f"no core checkout yet - run: python3 tools/ta.py bootstrap")

    print()
    print(f"     realm        : {cfg['realm_name']} @ {cfg['realm_address']}:{cfg['realm_port']}")
    print(f"     mysql        : {cfg['mysql_user']}@{cfg['mysql_host']}:{cfg['mysql_port']}")
    print()

    if problems:
        print(c("  Missing prerequisites:", "red"))
        for p in problems:
            print(f"    - {p}")
        return 1
    ok("environment looks usable")
    return 0


# --------------------------------------------------------------------------
# bootstrap / sync
# --------------------------------------------------------------------------

def overlay_modules(quiet=False):
    """Make our modules visible to AzerothCore's CMake at <core>/modules/<name>.

    AzerothCore discovers modules as subdirectories of its own `modules/` dir
    (top-level CMakeLists.txt: CU_SUBDIRLIST on ${CMAKE_SOURCE_DIR}/modules),
    so our out-of-tree module has to appear there. Preference order:
      1. symlink            - POSIX, and Windows with Developer Mode
      2. directory junction - Windows without elevation (mklink /J)
      3. copy               - last resort; needs `ta.py sync` after every edit
    """
    up = load_upstream()
    core_modules = acore_dir() / "modules"
    if not core_modules.is_dir():
        die(f"{core_modules} not found - run `ta.py bootstrap` first")

    for name in up.get("modules", []):
        src = REPO / "modules" / name
        if not src.is_dir():
            die(f"module source missing: {src}")
        dst = core_modules / name

        if dst.is_symlink() or (IS_WINDOWS and dst.is_dir() and _is_junction(dst)):
            if not quiet:
                ok(f"module '{name}' already linked")
            continue
        if dst.exists():
            shutil.rmtree(dst, ignore_errors=True)
            if dst.exists():
                dst.unlink(missing_ok=True)

        try:
            os.symlink(src, dst, target_is_directory=True)
            if not quiet:
                ok(f"module '{name}' symlinked into core")
            continue
        except (OSError, NotImplementedError):
            pass

        if IS_WINDOWS:
            rc, _, _ = capture(["cmd", "/c", "mklink", "/J", str(dst), str(src)])
            if rc == 0:
                if not quiet:
                    ok(f"module '{name}' junctioned into core")
                continue

        shutil.copytree(src, dst)
        warn(f"module '{name}' COPIED into core (symlink/junction unavailable).")
        warn("  Re-run `python tools/ta.py sync` after editing module sources.")


def _is_junction(path):
    try:
        return bool(os.readlink(str(path)))
    except OSError:
        return False


def cmd_bootstrap(args):
    up = load_upstream()
    base = up["base"]
    target = acore_dir()
    need("git", "install Git and re-run.")

    if target.exists() and args.force:
        info(f"--force: removing existing {target}")
        shutil.rmtree(target, ignore_errors=True)

    if not target.exists():
        info(f"cloning {base['name']} (this downloads ~1 GB, be patient)")
        run(["git", "clone", "--filter=tree:0", base["url"], str(target)])
    else:
        info(f"core checkout exists at {target.name}/ - fetching pinned commit")
        run(["git", "fetch", "origin", base["branch"]], cwd=target, check=False)

    rc, head, _ = capture(["git", "rev-parse", "HEAD"], cwd=target)
    if head != base["pinned_commit"]:
        info(f"checking out pinned commit {base['pinned_commit'][:12]}")
        rc = run(["git", "fetch", "origin", base["pinned_commit"]], cwd=target, check=False)
        run(["git", "checkout", "--detach", base["pinned_commit"]], cwd=target)
    ok(f"core at {base['pinned_commit'][:12]} ({base['pinned_date']})")

    info("overlaying Tomorrow's Ash modules")
    overlay_modules()

    print()
    ok("bootstrap complete")
    print("     next: python3 tools/ta.py configure")
    return 0


def cmd_sync(args):
    info("re-overlaying modules into the core checkout")
    overlay_modules()
    ok("sync complete")
    return 0


# --------------------------------------------------------------------------
# configure / build
# --------------------------------------------------------------------------

def cmd_configure(args):
    cfg = load_local()
    need("cmake", "install CMake 3.16+")
    core = acore_dir()
    if not core.exists():
        die("no core checkout - run `ta.py bootstrap` first")
    overlay_modules(quiet=True)

    bdir = build_dir()
    bdir.mkdir(parents=True, exist_ok=True)

    cmake = [
        "cmake", str(core),
        f"-DCMAKE_INSTALL_PREFIX={dist_dir()}",
        f"-DCMAKE_BUILD_TYPE={args.build_type or cfg['build_type']}",
        f"-DTOOLS_BUILD={args.tools or cfg['tools_build']}",
        "-DSCRIPTS=static",
        "-DMODULES=static",
        "-DWITH_WARNINGS=0",
    ]

    # Generator choice. Ninja is markedly faster than Make for a tree this size;
    # on Windows we let CMake pick the installed Visual Studio generator.
    if args.generator:
        cmake += ["-G", args.generator]
    elif not IS_WINDOWS and shutil.which("ninja"):
        cmake += ["-G", "Ninja"]

    # ccache cuts rebuild time dramatically and is harmless when absent.
    if not IS_WINDOWS and shutil.which("ccache"):
        cmake += [
            "-DCMAKE_C_COMPILER_LAUNCHER=ccache",
            "-DCMAKE_CXX_COMPILER_LAUNCHER=ccache",
        ]

    run(cmake, cwd=bdir)
    ok("configure complete")
    print(f"     next: python3 tools/ta.py build")
    return 0


def module_sources_newer_than_cache(bdir):
    """True if any module source is newer than the CMake cache.

    AzerothCore's CMake globs module sources at CONFIGURE time, so a newly added
    .cpp is invisible to the build until cmake re-runs - and the failure mode is
    a confusing undefined-reference at link, not a missing-file error. Detect it
    instead of letting people lose an hour to it.
    """
    cache = bdir / "CMakeCache.txt"
    if not cache.exists():
        return False
    cache_mtime = cache.stat().st_mtime
    for module in load_upstream().get("modules", []):
        src = REPO / "modules" / module
        for path in src.rglob("*"):
            if path.suffix in (".cpp", ".h", ".cmake") and path.stat().st_mtime > cache_mtime:
                return True
    return False


def cmd_build(args):
    need("cmake", "install CMake")
    bdir = build_dir()
    if not (bdir / "CMakeCache.txt").exists():
        die("not configured - run `ta.py configure` first")

    if module_sources_newer_than_cache(bdir):
        info("module sources changed since configure - re-running cmake")
        info("  (AzerothCore globs module sources at configure time; skipping this")
        info("   produces undefined-reference link errors for any new file)")
        run(["cmake", str(bdir)], cwd=bdir)
    jobs = args.jobs or os.cpu_count() or 4
    info(f"building with {jobs} parallel jobs (this takes a while on first run)")
    run(["cmake", "--build", str(bdir), "--parallel", str(jobs)])
    info("installing into dist/")
    run(["cmake", "--install", str(bdir)], check=False)
    ok("build complete")
    return 0


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

def mysql_available_native():
    return shutil.which("mysql") is not None


def mysql_cmd(cfg, database=None):
    """Build a MySQL client invocation.

    Prefers a native `mysql` client. Falls back to running the client *inside*
    the Docker container, which means a working setup needs no MySQL install
    on the host at all.
    """
    if mysql_available_native():
        cmd = ["mysql", f"-h{cfg['mysql_host']}", f"-P{cfg['mysql_port']}",
               f"-u{cfg['mysql_user']}", f"-p{cfg['mysql_pass']}"]
    else:
        need("docker", "install Docker, or install a native MySQL client")
        cmd = ["docker", "exec", "-i", cfg["docker_container"],
               "mysql", f"-u{cfg['mysql_user']}", f"-p{cfg['mysql_pass']}"]
    if database:
        cmd.append(database)
    return cmd


def mysql_run(cfg, sql, database=None, check=True):
    cmd = mysql_cmd(cfg, database)
    proc = subprocess.run([str(x) for x in cmd], input=sql, text=True, capture_output=True)
    if proc.returncode != 0 and check:
        die(f"mysql failed: {proc.stderr.strip()}")
    return proc.returncode, proc.stdout


def docker_container_state(cfg):
    rc, out, _ = capture(["docker", "inspect", "-f", "{{.State.Status}}", cfg["docker_container"]])
    return out if rc == 0 else None


def cmd_db(args):
    cfg = load_local()
    action = args.action

    if action == "up":
        need("docker", "install Docker Desktop (Windows) or docker.io (Linux)")
        state = docker_container_state(cfg)
        if state == "running":
            ok(f"container '{cfg['docker_container']}' already running")
            return 0
        if state:
            info(f"starting existing container '{cfg['docker_container']}'")
            run(["docker", "start", cfg["docker_container"]])
        else:
            info(f"creating MySQL container '{cfg['docker_container']}'")
            rc = run([
                "docker", "run", "-d",
                "--name", cfg["docker_container"],
                "-e", f"MYSQL_ROOT_PASSWORD={cfg['mysql_pass']}",
                "-p", f"{cfg['mysql_port']}:3306",
                "-v", f"{cfg['docker_container']}-data:/var/lib/mysql",
                cfg["mysql_image"],
                "--max_allowed_packet=64M",
            ], check=False)
            if rc != 0:
                # Docker Hub anonymous pulls are rate limited (HTTP 429), which
                # has nothing to do with your setup being wrong. Say so, and
                # point at the path that does not need a registry at all.
                print()
                warn("could not start the MySQL container.")
                warn("If the error above mentions '429 Too Many Requests', Docker Hub is")
                warn("rate-limiting anonymous pulls. Either `docker login`, or skip Docker:")
                warn("")
                warn("  Linux:   sudo apt install mysql-server")
                warn("  Windows: install MySQL Server 8.x")
                warn("")
                warn("then put the credentials in tools/local.json and use `db init`")
                warn("directly - `db up` is only needed for the Docker route.")
                warn("See SETUP.md section 1, 'Linux without Docker'.")
                return 1
        info("waiting for MySQL to accept connections")
        import time
        for attempt in range(60):
            rc, _ = mysql_run(cfg, "SELECT 1;", check=False)
            if rc == 0:
                ok("MySQL is up")
                return 0
            time.sleep(2)
        die("MySQL did not become ready in 120s - check `docker logs " + cfg["docker_container"] + "`")

    if action == "down":
        need("docker", "install Docker")
        run(["docker", "stop", cfg["docker_container"]], check=False)
        ok("container stopped (data volume kept)")
        return 0

    if action == "status":
        state = docker_container_state(cfg) if shutil.which("docker") else None
        print(f"     container : {cfg['docker_container']} -> "
              f"{state or 'not created (fine if you run MySQL natively)'}")
        rc, out = mysql_run(cfg, "SELECT VERSION();", check=False)
        print(f"     mysql     : {'reachable' if rc == 0 else 'NOT reachable'}")
        if rc == 0:
            for db in (cfg["db_auth"], cfg["db_world"], cfg["db_characters"]):
                rc2, out2 = mysql_run(cfg, f"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='{db}';", check=False)
                count = out2.strip().splitlines()[-1] if rc2 == 0 and out2.strip() else "?"
                print(f"     {db:<20}: {count} tables")
        return 0

    if action == "init":
        info("creating databases and the acore user")
        sql = f"""
CREATE DATABASE IF NOT EXISTS `{cfg['db_auth']}`       DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE DATABASE IF NOT EXISTS `{cfg['db_world']}`      DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE DATABASE IF NOT EXISTS `{cfg['db_characters']}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
"""
        mysql_run(cfg, sql)
        ok("databases created")
        print()
        print("     The three databases are empty on purpose. AzerothCore's built-in")
        print("     updater fills them from .acore/data/sql on the first worldserver")
        print("     start - that import takes several minutes. Just run:")
        print("         python3 tools/ta.py run world")
        return 0

    if action == "website-user":
        # The website is internet-facing and must not hold the game server's
        # credentials. See sql/website/001_website_db_user.sql for the rationale
        # behind each grant.
        user = cfg.get("website_db_user", "ashweb")
        pw = cfg.get("website_db_pass", "")
        if not pw:
            die("set website_db_pass in tools/local.json first (never commit it)\n"
                "  example: {\"website_db_pass\": \"a-long-random-string\"}")
        # Table-level grants require the table to exist, and the schemas stay
        # empty until the first worldserver run imports them.
        rc, out = mysql_run(cfg, f"SHOW TABLES FROM `{cfg['db_auth']}` LIKE 'account';", check=False)
        if rc != 0 or "account" not in out:
            die(f"`{cfg['db_auth']}`.`account` does not exist yet.\n"
                "  The databases are empty until AzerothCore imports them.\n"
                "  Run `python3 tools/ta.py run world` once and let it finish, then retry.")

        info(f"creating least-privilege website user '{user}'")
        sql = f"""
CREATE USER IF NOT EXISTS '{user}'@'%' IDENTIFIED BY '{pw}';
ALTER USER '{user}'@'%' IDENTIFIED BY '{pw}';
GRANT SELECT, INSERT, UPDATE ON `{cfg['db_auth']}`.`account` TO '{user}'@'%';
GRANT SELECT ON `{cfg['db_auth']}`.`realmlist` TO '{user}'@'%';
GRANT SELECT ON `{cfg['db_characters']}`.* TO '{user}'@'%';
GRANT SELECT ON `{cfg['db_world']}`.* TO '{user}'@'%';
FLUSH PRIVILEGES;
"""
        mysql_run(cfg, sql)
        rc, out = mysql_run(cfg, f"SHOW GRANTS FOR '{user}'@'%';")
        print(out)
        ok(f"website user '{user}' created")
        print()
        print("     Put these in your website's .env (see web/.env.example):")
        print(f"       DB_HOST={cfg['mysql_host']}")
        print(f"       DB_PORT={cfg['mysql_port']}")
        print(f"       DB_USER={user}")
        print( "       DB_PASSWORD=<the password you set in tools/local.json>")
        print()
        print("     Note: no DELETE anywhere, and no access to account_access")
        print("     or account_banned - a web compromise cannot grant GM or unban.")
        return 0

    if action == "realm":
        info(f"registering realm '{cfg['realm_name']}'")
        sql = f"""
DELETE FROM `realmlist` WHERE `id` = 1;
INSERT INTO `realmlist`
  (`id`, `name`, `address`, `localAddress`, `localSubnetMask`, `port`, `icon`, `flag`, `timezone`, `allowedSecurityLevel`, `population`, `gamebuild`)
VALUES
  (1, '{cfg['realm_name']}', '{cfg['realm_address']}', '127.0.0.1', '255.255.255.0', {cfg['realm_port']}, 0, 0, 1, 0, 0, 12340);
"""
        mysql_run(cfg, sql, database=cfg["db_auth"])
        rc, out = mysql_run(cfg, "SELECT id, name, address, port FROM realmlist;", database=cfg["db_auth"])
        print(out)
        ok(f"realm '{cfg['realm_name']}' registered")
        return 0

    die(f"unknown db action: {action}")


# --------------------------------------------------------------------------
# server configuration
# --------------------------------------------------------------------------

CONF_TEMPLATES = ["authserver", "worldserver"]


def cmd_conf(args):
    cfg = load_local()
    etc = dist_dir() / "etc"
    if not etc.is_dir():
        die(f"{etc} not found - build and install first (`ta.py build`)")

    conn_world = f"{cfg['mysql_host']};{cfg['mysql_port']};{cfg['mysql_user']};{cfg['mysql_pass']};{cfg['db_world']}"
    conn_char  = f"{cfg['mysql_host']};{cfg['mysql_port']};{cfg['mysql_user']};{cfg['mysql_pass']};{cfg['db_characters']}"
    conn_auth  = f"{cfg['mysql_host']};{cfg['mysql_port']};{cfg['mysql_user']};{cfg['mysql_pass']};{cfg['db_auth']}"

    replacements = {
        "LoginDatabaseInfo": conn_auth,
        "WorldDatabaseInfo": conn_world,
        "CharacterDatabaseInfo": conn_char,
        "DataDir": str((REPO / "data" / "client").as_posix()),
        "SourceDirectory": str(acore_dir().as_posix()),
    }

    # AzerothCore's built-in SQL updater shells out to the `mysql` client to
    # import .sql files. Without it the server starts but silently applies no
    # database updates, so point at it explicitly when we can find one.
    mysql_bin = shutil.which("mysql")
    if mysql_bin:
        replacements["MySQLExecutable"] = str(Path(mysql_bin).as_posix())
    else:
        warn("no `mysql` client on PATH - AzerothCore cannot apply SQL updates.")
        warn("  Linux:   sudo apt install mysql-client")
        warn("  Windows: install MySQL Server (its bin/ contains mysql.exe)")

    for name in CONF_TEMPLATES:
        dist_file = etc / f"{name}.conf.dist"
        target = etc / f"{name}.conf"
        if not dist_file.exists():
            warn(f"{dist_file.name} missing, skipping")
            continue
        if target.exists() and not args.force:
            warn(f"{target.name} already exists (use --force to regenerate)")
            continue
        lines = dist_file.read_text(encoding="utf-8", errors="replace").splitlines()
        out, seen = [], set()
        for line in lines:
            stripped = line.strip()
            replaced = False
            for key, value in replacements.items():
                if stripped.startswith(f"{key} ") or stripped.startswith(f"{key}="):
                    out.append(f'{key} = "{value}"')
                    seen.add(key)
                    replaced = True
                    break
            if not replaced:
                out.append(line)
        target.write_text("\n".join(out) + "\n", encoding="utf-8")
        ok(f"wrote {target.relative_to(REPO)} ({len(seen)} settings applied)")

    # Module configs live in etc/modules/, not etc/ - that is where CMake
    # installs the .dist files and where worldserver looks for them.
    modules_etc = etc / "modules"
    modules_etc.mkdir(parents=True, exist_ok=True)
    for module in load_upstream().get("modules", []):
        for src in (REPO / "modules" / module / "conf").glob("*.conf.dist"):
            shutil.copy2(src, modules_etc / src.name)
            target = modules_etc / src.name.replace(".conf.dist", ".conf")
            if not target.exists() or args.force:
                shutil.copy2(src, target)
            ok(f"module config {src.name} -> etc/modules/")

    print()
    print(f"     Realm name lives in the DATABASE, not these files.")
    print(f"     Run `python3 tools/ta.py db realm` to set it to '{cfg['realm_name']}'.")
    return 0


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

def cmd_run(args):
    binary = "authserver" if args.target == "auth" else "worldserver"
    exe = dist_dir() / "bin" / (binary + (".exe" if IS_WINDOWS else ""))
    if not exe.exists():
        die(f"{exe} not found - run `ta.py build` first")
    info(f"starting {binary} (Ctrl+C to stop)")
    run([str(exe)], cwd=exe.parent, check=False)
    return 0


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        prog="ta.py",
        description="Tomorrow's Ash developer CLI (realm: Ashmorrow)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", help="check prerequisites").set_defaults(func=cmd_doctor)

    p = sub.add_parser("bootstrap", help="fetch pinned AzerothCore and overlay modules")
    p.add_argument("--force", action="store_true", help="delete and re-clone the core checkout")
    p.set_defaults(func=cmd_bootstrap)

    sub.add_parser("sync", help="re-overlay modules into the core checkout").set_defaults(func=cmd_sync)

    p = sub.add_parser("configure", help="run cmake configure")
    p.add_argument("--build-type", help="Release (default) / RelWithDebInfo / Debug")
    p.add_argument("--tools", help="TOOLS_BUILD: all (default) / none / maps-only / db-only")
    p.add_argument("--generator", help="explicit CMake generator, e.g. \"Visual Studio 17 2022\"")
    p.set_defaults(func=cmd_configure)

    p = sub.add_parser("build", help="compile the server")
    p.add_argument("-j", "--jobs", type=int, help="parallel jobs (default: all cores)")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("db", help="database lifecycle")
    p.add_argument("action",
                   choices=["up", "down", "status", "init", "realm", "website-user"])
    p.set_defaults(func=cmd_db)

    p = sub.add_parser("conf", help="render server configs for the Ashmorrow realm")
    p.add_argument("--force", action="store_true", help="overwrite existing .conf files")
    p.set_defaults(func=cmd_conf)

    p = sub.add_parser("run", help="start a server binary")
    p.add_argument("target", choices=["auth", "world"])
    p.set_defaults(func=cmd_run)

    args = parser.parse_args()
    try:
        return args.func(args) or 0
    except Fail as exc:
        print(f"\n{c('ERROR', 'red')}: {exc}\n", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
