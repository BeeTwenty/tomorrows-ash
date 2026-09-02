#!/usr/bin/env python3
"""
ta.py - Tomorrow's Ash developer CLI.

One entry point for setting up, building and running the Ashmorrow realm on both
Windows and Linux. Standard library only, Python 3.8+.

    python3 tools/ta.py install          # everything: deps, core, build, db, configs
    python3 tools/ta.py install --client /path/to/WoW-3.3.5a   # ...and client data

That is the whole setup. The individual steps below still exist for when
something needs doing on its own:

    doctor                 check this machine has what it needs
    bootstrap              fetch pinned AzerothCore, overlay our modules
    configure / build      cmake, then compile
    extract --client PATH  map/vmap/mmap/DBC data from your own WoW client
    db up|init|realm       database lifecycle and realm registration
    conf                   render server configs
    run auth|world         start a server
    web / play             the website, and pointing a client at the realm

See SETUP.md for the full walkthrough.
"""

import argparse
import json
import os
import platform
import re
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
    "db_web": "ashmorrow_web",
    "web_port": 3000,
    "web_db_user": "ash_web",
    "web_db_pass": "",
    "site_url": "http://localhost:3000",
    "db_admin": "ashmorrow_admin",
    "admin_port": 3010,
    "admin_db_user": "ash_admin",
    "admin_db_pass": "",
    "admin_url": "http://127.0.0.1:3010",
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

def find_mysql_client():
    """Locate the `mysql` client binary, on PATH or in the usual install dirs.

    AzerothCore's SQL updater shells out to this to import .sql files, so a
    realm cannot be set up without it. On Windows it ships with MySQL Server but
    lands in Program Files and is almost never added to PATH, which made the
    installer refuse to run on a machine that had everything it needed.
    """
    found = shutil.which("mysql")
    if found:
        return found

    candidates = []
    if IS_WINDOWS:
        for root in (os.environ.get("ProgramFiles", r"C:\Program Files"),
                     os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
                     "C:\\"):   # a raw string cannot end in a backslash
            base = Path(root)
            if not base.is_dir():
                continue
            # MySQL Server 8.x, MariaDB, and the XAMPP/Laragon bundles.
            candidates += list(base.glob("MySQL/MySQL Server */bin/mysql.exe"))
            candidates += list(base.glob("MariaDB */bin/mysql.exe"))
            candidates += list(base.glob("xampp/mysql/bin/mysql.exe"))
            candidates += list(base.glob("laragon/bin/mysql/*/bin/mysql.exe"))
    elif platform.system() == "Darwin":
        candidates += [Path("/opt/homebrew/opt/mysql-client/bin/mysql"),
                       Path("/usr/local/opt/mysql-client/bin/mysql"),
                       Path("/opt/homebrew/bin/mysql"),
                       Path("/usr/local/mysql/bin/mysql")]
    else:
        candidates += [Path("/usr/bin/mysql"), Path("/usr/local/bin/mysql"),
                       Path("/usr/local/mysql/bin/mysql")]

    for candidate in sorted(candidates, reverse=True):   # prefer newer versions
        if candidate.is_file():
            return str(candidate)
    return None


def mysql_client_hint():
    """Platform-correct advice for installing the client."""
    if IS_WINDOWS:
        return ("comes with MySQL Server 8.x - https://dev.mysql.com/downloads/installer/ - "
                "or add its bin\\ folder to PATH if already installed")
    if platform.system() == "Darwin":
        return "brew install mysql-client"
    return "sudo apt install mysql-client (or mariadb-client)"


BOOST_MIN_WINDOWS = (1, 78)
BOOST_MIN_POSIX = (1, 74)


def read_boost_version(root):
    """Parse boost/version.hpp under `root`. Returns (major, minor) or None."""
    header = Path(root) / "boost" / "version.hpp"
    if not header.is_file():
        return None
    try:
        text = header.read_text(errors="replace")
    except OSError:
        return None
    m = re.search(r"#define\s+BOOST_VERSION\s+(\d+)", text)
    if not m:
        return None
    raw = int(m.group(1))                 # e.g. 107800 -> 1.78.0
    return (raw // 100000, (raw // 100) % 1000)


def find_boost():
    """Locate a Boost installation and its version.

    Checks the environment variables AzerothCore and CMake actually honour, in
    the order they take effect, then the conventional Windows location. Returns
    (root, (major, minor)) or (None, None).

    `Boost_ROOT` is the spelling deps/boost/CMakeLists.txt reads explicitly on
    Windows; CMake's own find also accepts BOOST_ROOT and BOOSTROOT.
    """
    roots = []
    for var in ("Boost_ROOT", "BOOST_ROOT", "BOOSTROOT"):
        value = os.environ.get(var)
        if value:
            roots.append((var, value))

    if IS_WINDOWS:
        for candidate in sorted(Path("C:/local").glob("boost_*"), reverse=True):
            roots.append(("C:/local", str(candidate)))
    else:
        for candidate in ("/usr/include", "/usr/local/include", "/opt/homebrew/include"):
            roots.append(("system", candidate))

    for source, root in roots:
        version = read_boost_version(root)
        if version:
            return (root, version, source)
    return (None, None, None)


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

    # Not fatal here on purpose. It is not needed to fetch or compile anything,
    # and failing before a 20-60 minute build for something wanted at the end of
    # it wastes the operator's evening - they can install it while that runs.
    mysql_client = find_mysql_client()
    if mysql_client:
        rc, out, _ = capture([mysql_client, "--version"])
        first = out.splitlines()[0] if out else ""
        ok(f"{'mysql':<10} {first[:60]}")
        if not shutil.which("mysql"):
            print(f"             found off PATH at {mysql_client}")
    else:
        warn(f"{'mysql':<10} not found - {mysql_client_hint()}")
        print("             Needed before the FIRST SERVER START, not to build.")

    check("docker", "needed for `ta.py db up`; skip if you run MySQL natively", required=False)

    # Boost is the dependency that most often stops a Windows build, and it
    # does so only at cmake configure time - after the fetch, and after the
    # operator has waited. Check it here, where it costs a second.
    boost_root, boost_version, boost_source = find_boost()
    boost_min = BOOST_MIN_WINDOWS if IS_WINDOWS else BOOST_MIN_POSIX
    if boost_version and boost_version >= boost_min:
        ok(f"{'boost':<10} {boost_version[0]}.{boost_version[1]} at {boost_root}")
    elif boost_version:
        problems.append(
            f"Boost {boost_version[0]}.{boost_version[1]} is too old; "
            f"{boost_min[0]}.{boost_min[1]}+ is required")
        print(f"{c('  XX', 'red')} {'boost':<10} {boost_version[0]}.{boost_version[1]} at {boost_root} "
              f"- too old, need {boost_min[0]}.{boost_min[1]}+")
        if boost_source in ("Boost_ROOT", "BOOST_ROOT", "BOOSTROOT"):
            print(f"             (found via the {boost_source} environment variable)")
        else:
            print(f"             (found by searching {boost_source})")
    else:
        problems.append(f"Boost {boost_min[0]}.{boost_min[1]}+ not found")
        print(f"{c('  XX', 'red')} {'boost':<10} not found - need {boost_min[0]}.{boost_min[1]}+")
        if IS_WINDOWS:
            print("             Install the prebuilt msvc-14.3 binaries, then set")
            print("             Boost_ROOT to the install folder and reopen PowerShell.")
        else:
            print("             sudo apt install libboost-all-dev")

    if IS_WINDOWS:
        warn("On Windows the compiler comes from Visual Studio 2022 - see SETUP.md section 3")
        openssl_roots = [Path(r"C:/Program Files/OpenSSL-Win64"),
                         Path(r"C:/Program Files/OpenSSL"),
                         Path(r"C:/OpenSSL-Win64")]
        found_ssl = next((r for r in openssl_roots if r.is_dir()), None)
        if found_ssl:
            ok(f"{'openssl':<10} {found_ssl}")
        else:
            warn(f"{'openssl':<10} not found in the usual places - see SETUP.md section 3")
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

    report_deployed_configs()

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

def stale_cache_entries(bdir):
    """Cached PATH/FILEPATH entries that point at something no longer on disk.

    CMake's cache wins over the environment: once a failed configure has stored
    Boost_INCLUDE_DIR=C:/local/boost_1_66_0, uninstalling that Boost and setting
    Boost_ROOT at a newer one changes nothing - the next configure re-reads the
    dead path, fails to parse a version out of the missing headers and reports
    the nonsense 'Found unsuitable version "0.0.0"'. Detect that and say so
    instead of letting an operator chase an environment variable that was
    already correct.

    Returns a list of (variable, value) pairs.
    """
    cache = bdir / "CMakeCache.txt"
    if not cache.exists():
        return []
    stale = []
    for line in cache.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^([A-Za-z0-9_\-\.]+):(PATH|FILEPATH)=(.*)$", line.strip())
        if not m:
            continue
        var, value = m.group(1), m.group(3).strip()
        if not value or value.endswith("NOTFOUND"):
            continue
        if not Path(value).is_absolute():
            continue
        if not Path(value).exists():
            stale.append((var, value))
    return stale


def clear_cmake_cache(bdir, why):
    """Remove the cache so the next configure re-discovers everything."""
    cache = bdir / "CMakeCache.txt"
    if cache.exists():
        cache.unlink()
    shutil.rmtree(bdir / "CMakeFiles", ignore_errors=True)
    warn(f"cleared the CMake cache in {bdir} - {why}")


def cmd_configure(args):
    cfg = load_local()
    need("cmake", "install CMake 3.16+")
    core = acore_dir()
    if not core.exists():
        die("no core checkout - run `ta.py bootstrap` first")
    overlay_modules(quiet=True)

    bdir = build_dir()
    bdir.mkdir(parents=True, exist_ok=True)

    if args.clean:
        clear_cmake_cache(bdir, "--clean was given")
    else:
        stale = stale_cache_entries(bdir)
        if stale:
            for var, value in stale[:6]:
                warn(f"  cached {var} points at {value}, which no longer exists")
            if len(stale) > 6:
                warn(f"  ...and {len(stale) - 6} more")
            clear_cmake_cache(bdir, "it referenced paths that are gone")

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
    build_type = getattr(args, "build_type", None)

    # Visual Studio is a multi-config generator. CMAKE_BUILD_TYPE is ignored
    # by it, so Release/Debug/RelWithDebInfo must be selected explicitly with
    # --config at build and install time. Single-config generators (Ninja,
    # Makefiles) do not need this, but accepting --config there is harmless.
    if IS_WINDOWS:
        build_type = build_type or load_local().get("build_type", "Release")

    info(f"building {build_type or 'configured'} with {jobs} parallel jobs "
         "(this takes a while on first run)")

    build_cmd = ["cmake", "--build", str(bdir), "--parallel", str(jobs)]
    install_cmd = ["cmake", "--install", str(bdir)]

    if build_type:
        build_cmd += ["--config", build_type]
        install_cmd += ["--config", build_type]

    run(build_cmd)
    info("installing into dist/")
    run(install_cmd)
    ok("build complete")
    return 0


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

def mysql_available_native():
    """A usable `mysql` client, on PATH or in a standard install directory.

    PATH alone is not enough: the Windows MySQL installer does not add its bin/
    to PATH, so `doctor` would find the client at
    C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe and report OK while
    every actual query fell through to the Docker branch and died with
    "'docker' not found" - on a machine that had deliberately chosen native
    MySQL and had no Docker at all.
    """
    return find_mysql_client() is not None


def mysql_cmd(cfg, database=None):
    """Build a MySQL client invocation.

    Prefers a native `mysql` client. Falls back to running the client *inside*
    the Docker container, which means a working setup needs no MySQL install
    on the host at all.
    """
    # An empty `-p` makes the client prompt for a password and hang forever in
    # a script, so the flag is only passed when there is a password to pass.
    password = [f"-p{cfg['mysql_pass']}"] if cfg["mysql_pass"] else []

    client = find_mysql_client()
    if client:
        cmd = [client, f"-h{cfg['mysql_host']}", f"-P{cfg['mysql_port']}",
               f"-u{cfg['mysql_user']}"] + password
    elif cfg.get("db_mode", "docker") != "docker":
        # The operator chose a MySQL they run themselves. Telling them to
        # install Docker at this point is advice for a setup they did not pick.
        die(f"no `mysql` client found. {mysql_client_hint()}")
    else:
        need("docker", "install Docker, or install a native MySQL client")
        cmd = ["docker", "exec", "-i", cfg["docker_container"],
               "mysql", f"-u{cfg['mysql_user']}"] + password
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
                warn("See SETUP.md section 2, 'Linux without Docker'.")
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

# --------------------------------------------------------------------------
# body types
#
# Three body types, each built on a stock class (docs/BODY-TYPES.md 2). Every
# other class is refused at character creation.
#
# The lever is CharacterCreating.Disabled.ClassMask in worldserver.conf, NOT
# deleting playercreateinfo rows. Both stop creation, but they fail at
# different points and only one of them fails politely:
#
#   classmask       -> WorldSession::HandleCharCreateOpcode (CharacterHandler.cpp:346)
#                      returns CHAR_CREATE_DISABLED, which the client shows as a
#                      real message. Config, so it is reversible without a
#                      migration and survives a world database re-import.
#   delete the rows -> Player::Create finds no PlayerInfo, returns false, and
#                      logs "Possible hacking-attempt" for every honest player
#                      who picked a hidden class. The client just says failed.
#
# Neither one removes anything from the creation SCREEN. In 3.3.5a that list is
# drawn from the client's own CharBaseInfo.dbc and ChrClasses.dbc; there is no
# opcode for it (Opcodes.h has only CMSG/SMSG_CHAR_CREATE, a request and its
# answer). Hiding or renaming needs a client patch - the launcher's job.
# --------------------------------------------------------------------------

# Body type -> the class id it is built on.
# Skirmisher is Hunter (3), not Shaman (7). Paladin x Hunter x Mage is the only
# chassis triple in which every race has a body type at all - Night Elf has none
# under Paladin/Shaman/Mage. Approved 2026-09-02; the other five combinations
# are counted in docs/decisions/0008-body-type-client-patch.md section 10.
#
# Everything server-side derives from this line: the creation class mask, the
# generated stats and race-coverage migrations, and check_client_combos.py.
# Changing it makes the committed migrations stale - tools/tests/test_body_types.py
# says so rather than letting the realm quietly offer the wrong chassis.
BODY_TYPE_CLASSES = {"Vanguard": 2, "Skirmisher": 3, "Adept": 8}

# Bit 512 is unused in 3.3.5, which is why "all classes" is 1535 and not 2047.
CLASSMASK_ALL_PLAYABLE = 1535


def body_type_classmask():
    """Bits for the classes a body type is built on."""
    mask = 0
    for class_id in BODY_TYPE_CLASSES.values():
        mask |= 1 << (class_id - 1)
    return mask


def disabled_classmask():
    """Value for CharacterCreating.Disabled.ClassMask: everything else."""
    return CLASSMASK_ALL_PLAYABLE & ~body_type_classmask()


CONF_TEMPLATES = ["authserver", "worldserver"]


def find_deployed_configs(name):
    """Every copy of <name>.conf that a launched server could end up reading.

    On Windows ConfigMgr::GetConfigPath() returns the RELATIVE string
    "configs/" (Config.cpp:709), so the file a server reads is decided by the
    directory it was launched from - not by the install prefix. An MSBuild
    build also drops a second copy under build/bin/<Config>/configs/ on every
    build (ConfigInstall.cmake), which nothing in this repo used to touch.

    So "the config is correct" is not a property of one file. Find them all.
    """
    seen, out = set(), []
    for root in (dist_dir(), build_dir()):
        if not root.is_dir():
            continue
        for path in root.rglob(f"{name}.conf"):
            resolved = path.resolve()
            if resolved not in seen:
                seen.add(resolved)
                out.append(path)
    return sorted(out)


# The keys whose value decides whether this realm behaves like Ashmorrow or
# like stock AzerothCore. Checked against every config copy on disk, because
# editing the wrong copy is indistinguishable from not editing at all.
AUDITED_CONF_KEYS = {
    "CharacterCreating.Disabled.ClassMask": "character creation limited to the body types",
    "ValidateSkillLearnedBySpells":         "off-class spells survive a login",
}


def report_deployed_configs():
    """Show every worldserver.conf on disk and whether it says what we think.

    A realm ran a whole playtest unrestricted because the value was right in
    one file and stock in the one the server actually read. On Windows
    ConfigMgr::GetConfigPath() is the relative "configs/" (Config.cpp:709), so
    which file that is depends on where the server was launched from.
    """
    expected = {
        "CharacterCreating.Disabled.ClassMask": str(disabled_classmask()),
        "ValidateSkillLearnedBySpells": "0",
    }
    configs = find_deployed_configs("worldserver")

    if not configs:
        warn("no worldserver.conf found yet - run `ta.py conf` after a build")
        print()
        return

    print(f"     worldserver.conf copies found: {len(configs)}")
    bad = 0
    for path in configs:
        launched_from = path.parent.parent
        print(f"       {path.relative_to(REPO)}")
        print(f"         read by a server launched from {launched_from.relative_to(REPO) or '.'}/")
        for key, want in expected.items():
            got = read_conf_value(path, key)
            if got == want:
                print(f"         {c('OK', 'green')}   {key} = {got}")
            else:
                bad += 1
                print(f"         {c('BAD', 'red')}  {key} = {got if got is not None else '(missing)'}"
                      f"  (expected {want}) - {AUDITED_CONF_KEYS[key]}")
    if bad:
        warn(f"{bad} setting(s) wrong. Run `ta.py conf` to fix every copy, then restart.")
        warn("The server logs which file it read: look for '[Classless] Config in effect:'")
    print()


def conf_keys(path):
    """The setting names a config file defines, in order."""
    keys = []
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("[") or "=" not in stripped:
            continue
        keys.append(stripped.split("=", 1)[0].strip())
    return keys


def add_missing_module_keys(dist_file, target):
    """Append settings the .dist has and the deployed config does not.

    Values are never changed - an operator's tuning is theirs. But a key added
    to the module after their config was written would otherwise never appear,
    and the only symptom is one line at startup:

        > Config: Missing property Classless.OpenRelicSlot in config file ...

    which is easy to miss in a thousand lines of boot log, and leaves the
    setting silently on its compiled-in default.
    """
    have = set(conf_keys(target))
    missing = [k for k in conf_keys(dist_file) if k not in have]
    if not missing:
        return []

    dist_lines = dist_file.read_text(encoding="utf-8", errors="replace").splitlines()
    block = ["", "#", "# Added by `ta.py conf`: present in the shipped .dist but missing here.",
             "# Values are the shipped defaults; existing settings above were not touched.",
             "#"]
    for key in missing:
        for line in dist_lines:
            stripped = line.strip()
            if stripped.startswith(f"{key} ") or stripped.startswith(f"{key}="):
                block.append(stripped)
                break
    with target.open("a", encoding="utf-8") as handle:
        handle.write("\n".join(block) + "\n")
    return missing


def apply_conf_keys(lines, replacements):
    """Rewrite the managed keys in a config file, leaving every other line alone.

    Returns (new_lines, {key: (old_value, new_value)}) for the keys that
    actually changed, so callers can say what they did rather than claiming a
    file is correct without looking.
    """
    out, changed = [], {}
    for line in lines:
        stripped = line.strip()
        for key, value in replacements.items():
            if stripped.startswith(f"{key} ") or stripped.startswith(f"{key}="):
                old = stripped.split("=", 1)[1].strip().strip('"') if "=" in stripped else ""
                new = f'{key} = "{value}"'
                if old != str(value):
                    changed[key] = (old, str(value))
                out.append(new)
                break
        else:
            out.append(line)
            continue
    return out, changed


def read_conf_value(path, key):
    """The value a running server would read for one key, or None if absent.

    Mirrors Config.cpp: last-write-wins is NOT how it works - IsDuplicateOption
    keeps the first - and every '"' is stripped from the value (Config.cpp:327).
    """
    if not Path(path).is_file():
        return None
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or stripped.startswith("["):
            continue
        if "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        if name.strip() == key:
            return value.strip().replace('"', "")
    return None


def cmd_conf(args):
    cfg = load_local()
    etc = dist_dir() / ("configs" if IS_WINDOWS else "etc")
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
        # Quoting is fine for a number: Config.cpp:327 strips every '"' from a
        # value before parsing it.
        "CharacterCreating.Disabled.ClassMask": str(disabled_classmask()),

        # MUST be 0 on a classless realm. Player::_LoadSpells calls
        # CheckSkillLearnedBySpell on every login (PlayerStorage.cpp:6610), and
        # that asks GetSkillRaceClassInfo whether the spell's skill line is
        # valid for the character's race and class. Every off-class ability the
        # broker sells fails that test, so with this on, purchased spells are
        # DELETED from character_spell at the next login - silently, apart from
        # one LOG_ERROR. Off-class spells are the entire point of this realm,
        # so the guard is wrong here.
        "ValidateSkillLearnedBySpells": "0",
    }

    # AzerothCore's built-in SQL updater shells out to the `mysql` client to
    # import .sql files. Without it the server starts but silently applies no
    # database updates, so point at it explicitly when we can find one.
    mysql_bin = find_mysql_client()
    if mysql_bin:
        replacements["MySQLExecutable"] = str(Path(mysql_bin).as_posix())
    else:
        warn("no `mysql` client found - AzerothCore cannot apply SQL updates.")
        warn(f"  {mysql_client_hint()}")

    for name in CONF_TEMPLATES:
        dist_file = etc / f"{name}.conf.dist"
        target = etc / f"{name}.conf"
        if not dist_file.exists():
            warn(f"{dist_file.name} missing, skipping")
            continue
        # An existing config is NOT skipped. It used to be, and that is how a
        # realm ended up running with CharacterCreating.Disabled.ClassMask = 0
        # for a whole playtest: the repo grew a new managed setting, `ta.py
        # conf` refused to touch the deployed file, and nothing said so. Only
        # the keys ta.py owns are rewritten; every hand edit elsewhere in the
        # file survives. --force still regenerates from the .dist.
        source = dist_file if (args.force or not target.exists()) else target
        lines = source.read_text(encoding="utf-8", errors="replace").splitlines()
        out, changed = apply_conf_keys(lines, replacements)
        target.write_text("\n".join(out) + "\n", encoding="utf-8")

        if source is dist_file:
            ok(f"wrote {target.relative_to(REPO)} from {dist_file.name}")
        elif changed:
            ok(f"updated {target.relative_to(REPO)} - {len(changed)} setting(s) were stale:")
            for key, (old_value, new_value) in changed.items():
                shown_old = old_value if len(old_value) < 40 else old_value[:37] + "..."
                shown_new = new_value if len(new_value) < 40 else new_value[:37] + "..."
                print(f"       {key}: {shown_old or '(empty)'} -> {shown_new}")
        else:
            ok(f"{target.relative_to(REPO)} already correct")

        # Every other copy on disk gets the same keys. Writing only the one
        # under dist/ is how a realm can be "configured" and still run on
        # stock settings: on Windows the server resolves "configs/" against
        # its working directory, and an MSBuild build leaves a second copy in
        # the build tree that a double-clicked worldserver.exe reads instead.
        for other in find_deployed_configs(name):
            if other.resolve() == target.resolve():
                continue
            other_lines = other.read_text(encoding="utf-8", errors="replace").splitlines()
            other_out, other_changed = apply_conf_keys(other_lines, replacements)
            other.write_text("\n".join(other_out) + "\n", encoding="utf-8")
            if other_changed:
                warn(f"also updated {other.relative_to(REPO)} "
                     f"({len(other_changed)} stale) - a server launched from "
                     f"{other.parent.parent.relative_to(REPO)} reads THIS file, not dist/")

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
                continue

            # The deployed config is the operator's: their tuning stays. Only
            # settings that did not exist when they configured are appended.
            added = add_missing_module_keys(src, target)
            if added:
                ok(f"module config {target.name}: added {len(added)} new setting(s)")
                for key in added:
                    print(f"       {key}")
            else:
                ok(f"module config {target.name} has every setting the module defines")

    print()
    print(f"     Character creation is limited to the three body types:")
    for name, class_id in BODY_TYPE_CLASSES.items():
        print(f"       {name:<11} = class {class_id}")
    print(f"     CharacterCreating.Disabled.ClassMask = {disabled_classmask()} refuses the rest.")
    print(f"     The client still SHOWS all ten - that list is in its own DBCs,")
    print(f"     not something the server sends. See docs/BODY-TYPES.md section 4.")
    print()
    print(f"     Realm name lives in the DATABASE, not these files.")
    print(f"     Run `python3 tools/ta.py db realm` to set it to '{cfg['realm_name']}'.")
    return 0


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# one-shot installer
# --------------------------------------------------------------------------

APT_PACKAGES = [
    "git", "cmake", "make", "clang", "ccache", "ninja-build",
    "libboost-all-dev", "libssl-dev", "libmysqlclient-dev",
    "libreadline-dev", "libbz2-dev", "libncurses-dev",
    "mysql-client",
]


def step(number, total, title):
    print()
    print(c(f"[{number}/{total}] {title}", "blue"))
    print(c("-" * (len(title) + 8), "grey"))


_UNSET = object()


class Prompt:
    """Interactive questions with non-interactive fallbacks.

    Every question can be answered three ways, in priority order: a command-line
    flag, an answer typed at the prompt, or the default. That means the same
    installer serves someone setting up their first realm and a scripted rebuild
    on a machine with no terminal, without maintaining two code paths.
    """

    def __init__(self, assume_yes):
        self.assume_yes = assume_yes
        # A piped stdin cannot answer questions; fall back to defaults rather
        # than raising EOFError halfway through an install.
        self.interactive = sys.stdin is not None and sys.stdin.isatty()
        if assume_yes:
            self.interactive = False

    def _auto(self, question, shown, why, value=_UNSET):
        """Report an answer we did not have to ask for, and return it.

        `shown` is what the operator sees, `value` is what the caller gets. They
        differ whenever displaying the real answer would be wrong - a password
        must print as asterisks, and a menu prints a human label while the
        caller needs the key behind it.
        """
        print(f"     {question} {c(str(shown), 'yellow')}  ({why})")
        return shown if value is _UNSET else value

    def confirm(self, question, default=True, override=None):
        if override is not None:
            return self._auto(question, "yes" if override else "no", "from flag")
        if not self.interactive:
            return self._auto(question, "yes" if default else "no", "default")
        suffix = "[Y/n]" if default else "[y/N]"
        while True:
            try:
                answer = input(f"     {question} {suffix} ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                print()
                return default
            if not answer:
                return default
            if answer in ("y", "yes"):
                return True
            if answer in ("n", "no"):
                return False
            print(f"       please answer y or n")

    def text(self, question, default="", override=None, allow_empty=False):
        if override is not None:
            return self._auto(question, override, "from flag")
        if not self.interactive:
            return self._auto(question, default or "(empty)", "default", value=default)
        shown = f" [{default}]" if default else ""
        while True:
            try:
                answer = input(f"     {question}{shown}: ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return default
            answer = answer or default
            if answer or allow_empty:
                return answer
            print("       a value is required")

    def secret(self, question, override=None, generate=False):
        """Ask for a password without echoing it. Can generate one instead."""
        if override is not None:
            return self._auto(question, "*" * 8, "from flag", value=override)
        if not self.interactive:
            import secrets
            value = secrets.token_urlsafe(18) if generate else ""
            return self._auto(question, "generated" if generate else "(empty)",
                              "default", value=value)
        import getpass
        while True:
            try:
                answer = getpass.getpass(f"     {question}"
                                         f"{' (blank to generate one)' if generate else ''}: ")
            except (EOFError, KeyboardInterrupt):
                print()
                answer = ""
            if answer:
                return answer
            if generate:
                import secrets
                value = secrets.token_urlsafe(18)
                print(f"       generated a random password")
                return value
            print("       a password is required")

    def choice(self, question, options, default=0, override=None):
        """options is [(key, label, description)]. Returns the chosen key."""
        keys = [o[0] for o in options]
        if override is not None:
            if override not in keys:
                die(f"{override!r} is not one of: {', '.join(keys)}")
            label = next(o[1] for o in options if o[0] == override)
            return self._auto(question, label, "from flag", value=override)
        if not self.interactive:
            return self._auto(question, options[default][1], "default",
                              value=keys[default])

        print()
        print(f"     {question}")
        for index, (key, label, description) in enumerate(options):
            marker = c("*", "green") if index == default else " "
            print(f"       {marker} {index + 1}) {c(label, 'yellow')}")
            for line in description.splitlines():
                print(f"            {line}")
        while True:
            try:
                answer = input(f"     choose 1-{len(options)} [{default + 1}]: ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return keys[default]
            if not answer:
                return keys[default]
            if answer.isdigit() and 1 <= int(answer) <= len(options):
                return keys[int(answer) - 1]
            if answer.lower() in keys:
                return answer.lower()
            print(f"       enter a number from 1 to {len(options)}")


def local_ip_guess():
    """Best guess at this machine's LAN address.

    Opening a UDP socket to a public address does not send anything; it just
    makes the OS pick the interface it would route through. Used to offer a
    sensible realm address, because the default of 127.0.0.1 is the single most
    common cause of "I can log in but the realm shows offline".
    """
    import ipaddress
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 9))
            found = sock.getsockname()[0]
        finally:
            sock.close()
    except OSError:
        return None

    # Only offer something a player could actually connect to. Loopback is the
    # bug this exists to avoid, and a container can hand back link-local or
    # documentation-range addresses that would be worse than no suggestion.
    try:
        addr = ipaddress.ip_address(found)
    except ValueError:
        return None
    if addr.is_loopback or addr.is_link_local or addr.is_unspecified:
        return None
    if addr in ipaddress.ip_network("192.0.2.0/24"):      # TEST-NET-1
        return None
    return found


def confirm(question, assume_yes):
    """Kept for the older call sites that predate the Prompt class."""
    return Prompt(assume_yes).confirm(question)


def docker_available():
    """True only if the Docker daemon actually answers, not merely installed."""
    if not shutil.which("docker"):
        return False
    rc, _, _ = capture(["docker", "info", "--format", "{{.ServerVersion}}"])
    return rc == 0


def choose_database(prompt, args, cfg):
    """Decide where MySQL lives, and record it in tools/local.json.

    Three genuinely different situations, and guessing wrong wastes real time:
    a throwaway container, a service already on this box, or a database
    somewhere else entirely (the common homelab case, where the realm and the
    website are not the same machine).
    """
    mode = prompt.choice(
        "Where should the databases live?",
        [
            ("docker", "Docker container",
             "Easiest. Creates a MySQL 8.4 container we manage for you.\n"
             "Needs Docker installed and able to pull images."),
            ("local", "MySQL already on this machine",
             "Use a MySQL/MariaDB service you have installed.\n"
             "You will be asked for its credentials."),
            ("remote", "MySQL on another machine",
             "Point at a database server elsewhere on your network.\n"
             "The realm needs low latency to it - same LAN, not the internet."),
        ],
        # The CLI being installed is not the same as the daemon running - a
        # stopped daemon is common, and defaulting to Docker there sends people
        # down a path that cannot work.
        default=0 if docker_available() else 1,
        override=args.db,
    )

    if mode == "docker":
        if not shutil.which("docker"):
            die("Docker is not installed. Install it, or re-run and choose another option.")
        if not docker_available():
            warn("Docker is installed but its daemon is not responding.")
            print("       Start it (`sudo systemctl start docker`, or Docker Desktop)")
            print("       and re-run, or re-run and choose another option.")
            if not prompt.confirm("Continue anyway?", default=False):
                die("Docker daemon unavailable")
        cfg["mysql_host"] = "127.0.0.1"
        cfg["mysql_port"] = int(prompt.text("Port to publish MySQL on", "3306",
                                            override=args.db_port))
        cfg["mysql_user"] = "root"
        cfg["mysql_pass"] = prompt.secret("Password for the container's root user",
                                          override=args.db_password, generate=True)
        return mode

    cfg["mysql_host"] = prompt.text(
        "Database host", "127.0.0.1" if mode == "local" else "",
        override=args.db_host)
    cfg["mysql_port"] = int(prompt.text("Database port", "3306", override=args.db_port))
    cfg["mysql_user"] = prompt.text("Database user (needs CREATE DATABASE)", "root",
                                    override=args.db_user)
    cfg["mysql_pass"] = prompt.secret(f"Password for {cfg['mysql_user']}",
                                      override=args.db_password)
    return mode


def choose_realm(prompt, args, cfg):
    """Realm identity, and the address players are redirected to after login."""
    cfg["realm_name"] = prompt.text("Realm name", cfg.get("realm_name", "Ashmorrow"),
                                    override=args.realm_name)

    guess = local_ip_guess()
    print()
    print("     The realm address is what the client is redirected to AFTER login.")
    print("     127.0.0.1 works only for playing on this same machine. If anyone")
    print("     else will connect, use this machine's LAN address instead - this")
    print("     is the usual cause of 'login works but the realm shows offline'.")
    if guess:
        print(f"     This machine looks like {c(guess, 'yellow')} on your network.")

    cfg["realm_address"] = prompt.text("Realm address", guess or "127.0.0.1",
                                       override=args.realm_address)
    cfg["realm_port"] = int(prompt.text("World server port", "8085", override=args.realm_port))
    return cfg


def ensure_local_config(prompt, args):
    """Build tools/local.json from the answers, without clobbering existing ones.

    The shipped defaults exist so the tooling runs in a throwaway sandbox. A
    real install should not use them, and asking somebody to invent a password
    by hand is how installs end up with 'password'.
    """
    local = REPO / "tools" / "local.json"
    existing = {}
    if local.exists():
        try:
            existing = json.loads(local.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            die(f"tools/local.json is not valid JSON: {exc}")
        ok(f"{local.relative_to(REPO)} already exists")
        if not prompt.confirm("Reconfigure it?", default=False, override=args.reconfigure or None):
            return existing, None

    cfg = dict(existing)
    mode = choose_database(prompt, args, cfg)
    choose_realm(prompt, args, cfg)

    # Service passwords the operator never types; generated unless already set.
    import secrets
    for key in ("website_db_pass", "web_db_pass"):
        cfg.setdefault(key, secrets.token_urlsafe(18))

    cfg["db_mode"] = mode
    local.write_text(json.dumps(cfg, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print()
    ok(f"wrote {local.relative_to(REPO)}")
    warn("that file holds your passwords, is gitignored, and is the only copy.")
    return cfg, mode


def install_linux_packages(assume_yes):
    if IS_WINDOWS or not shutil.which("apt-get"):
        return False
    missing = [pkg for pkg in ("cmake", "git") if not shutil.which(pkg)]
    have_boost = Path("/usr/include/boost/version.hpp").exists()
    have_mysql = Path("/usr/include/mysql/mysql.h").exists()
    if not missing and have_boost and have_mysql:
        ok("build dependencies already present")
        return True

    print("     The build needs Boost, OpenSSL, MySQL headers and a compiler.")
    if not confirm("Install them with apt-get?", assume_yes):
        warn("skipping - install them yourself, then re-run")
        return False

    sudo = [] if os.geteuid() == 0 else ["sudo"]
    env = {"DEBIAN_FRONTEND": "noninteractive"}
    run(sudo + ["apt-get", "update", "-qq"], check=False, env=env)
    rc = run(sudo + ["apt-get", "install", "-y"] + APT_PACKAGES, check=False, env=env)
    if rc != 0:
        warn("apt-get reported problems; continuing, the build will say if something is missing")
    return True


def cmd_install(args):
    """Take a fresh clone to a running realm, asking about the choices that matter."""
    prompt = Prompt(args.yes)

    print()
    print(c("  Tomorrow's Ash - installing realm Ashmorrow", "blue"))
    print(f"  repo: {REPO}")
    if args.yes:
        print("  non-interactive (--yes): taking defaults for anything not passed as a flag")
    elif not prompt.interactive:
        print("  stdin is not a terminal: taking defaults for anything not passed as a flag")

    total = 7 if args.client else 6

    # 1 -----------------------------------------------------------------
    step(1, total, "Prerequisites")
    if not IS_WINDOWS:
        install_linux_packages(args.yes)
    else:
        print("     On Windows the compiler comes from Visual Studio 2022, and")
        print("     Boost/OpenSSL/MySQL are installed by hand - see SETUP.md section 3.")
    if cmd_doctor(argparse.Namespace()) != 0:
        die("prerequisites are missing - see above, then re-run")

    # 2 -----------------------------------------------------------------
    step(2, total, "How do you want this set up?")
    cfg, db_mode = ensure_local_config(prompt, args)
    if db_mode is None:
        db_mode = cfg.get("db_mode", "docker")

    build_type = prompt.choice(
        "Build type",
        [
            ("Release", "Release", "Fastest server, smallest build. Use this to play."),
            ("RelWithDebInfo", "Release with debug info",
             "Same speed, keeps symbols so crashes are diagnosable.\nLarger build directory."),
            ("Debug", "Debug", "Slow. Only for tracking down a specific bug."),
        ],
        default=0,
        override=args.build_type,
    )
    want_tools = prompt.confirm(
        "Build the client-data extractors?", default=True,
        override=(False if args.no_tools else None))
    if not want_tools:
        print("       skipping them shortens the build, but you will need them")
        print("       later unless you already have extracted client data.")

    # 3 -----------------------------------------------------------------
    step(3, total, "Fetching AzerothCore at the pinned commit")
    if acore_dir().exists():
        ok("core checkout already present")
        cmd_sync(argparse.Namespace())
    else:
        print("     Downloads roughly 1 GB.")
        cmd_bootstrap(argparse.Namespace(force=False))

    # 4 -----------------------------------------------------------------
    step(4, total, "Building the server")
    if args.skip_build:
        warn("skipped (--skip-build)")
    else:
        binary = dist_dir() / ("worldserver.exe" if IS_WINDOWS else "worldserver")
        if binary.exists() and not args.rebuild:
            ok("worldserver already built - pass --rebuild to force")
        else:
            print(f"     {build_type} build, first run takes 20-60 minutes and about 15 GB.")
            cmd_configure(argparse.Namespace(
                build_type=build_type,
                tools="all" if want_tools else "none",
                generator=args.generator,
                clean=False))
            cmd_build(argparse.Namespace(
                jobs=args.jobs,
                build_type=build_type))

    # 5 -----------------------------------------------------------------
    step(5, total, "Database")
    cfg = load_local()
    rc, _ = mysql_run(cfg, "SELECT 1;", check=False)

    if rc != 0 and db_mode == "docker":
        print("     Starting the MySQL container.")
        if cmd_db(argparse.Namespace(action="up")) != 0:
            return 1
        rc, _ = mysql_run(cfg, "SELECT 1;", check=False)

    if rc != 0:
        warn(f"cannot reach MySQL at {cfg['mysql_host']}:{cfg['mysql_port']} "
             f"as {cfg['mysql_user']}.")
        if db_mode == "local":
            print("     Install and start it, then re-run - everything above is done:")
            print("       Linux:   sudo apt install mysql-server")
            print("       Windows: the MySQL 8.x installer")
        else:
            print("     Check the host, port, credentials and that the server allows")
            print("     remote connections (bind-address) and the firewall permits it.")
            print("     Fix tools/local.json, then re-run.")
        return 1

    ok(f"MySQL reachable at {cfg['mysql_host']}:{cfg['mysql_port']}")

    # Enforced here rather than at step 1: it is not needed to fetch or compile
    # anything, so blocking the build on it wastes an evening. But the server
    # cannot import its ~800 MB of SQL without it, so it must exist by now.
    if not find_mysql_client():
        warn("the `mysql` client binary is still missing.")
        print(f"     {mysql_client_hint()}")
        print()
        print("     AzerothCore shells out to it to import its SQL. Without it the")
        print("     server starts and silently applies no database updates.")
        print("     Everything above is done; install it and re-run.")
        return 1

    cmd_db(argparse.Namespace(action="init"))

    # 6 -----------------------------------------------------------------
    step(6, total, "Server configuration")
    cmd_conf(argparse.Namespace(force=args.reconfigure))

    # 7 -----------------------------------------------------------------
    if args.client:
        step(7, total, "Client data")
        cmd_extract(argparse.Namespace(client=args.client,
                                       skip_mmaps=args.skip_mmaps, jobs=args.jobs))

    # done ---------------------------------------------------------------
    print()
    print(c("  Installed.", "green"))
    print()
    print(f"  Realm     {cfg['realm_name']} at {cfg['realm_address']}:{cfg['realm_port']}")
    print(f"  Database  {cfg['mysql_user']}@{cfg['mysql_host']}:{cfg['mysql_port']} ({db_mode})")
    print()

    if not args.client:
        print("  One thing is left, and it needs your own WoW 3.3.5a client:")
        print()
        print(c("     python3 tools/ta.py extract --client /path/to/WoW-3.3.5a", "yellow"))
        print()
        print("  The server cannot start without it - it exits at")
        print("  'Failed to find map files for starting areas'. Add --skip-mmaps to")
        print("  defer the multi-hour pathfinding step and play sooner.")
        print()

    print("  Then, in two terminals:")
    print(c("     python3 tools/ta.py run auth", "yellow"))
    print(c("     python3 tools/ta.py run world", "yellow"))
    print()
    print("  The first world start imports ~800 MB of SQL and looks frozen for")
    print("  several minutes. That happens once.")
    print()
    print("  Finally, register the realm and make an account:")
    print(c("     python3 tools/ta.py db realm", "yellow"))
    print("     (then in the worldserver console) account create <user> <pass>")
    print()
    return 0


# --------------------------------------------------------------------------
# client data extraction
# --------------------------------------------------------------------------

# Ordered because each step consumes the previous one's output. Run from the
# client directory; every extractor writes into its working directory.
EXTRACT_STEPS = [
    ("map_extractor",    [],                        ["dbc", "maps"], "DBC and map data", "~10 min"),
    ("vmap4_extractor",  [],                        ["Buildings"],   "line-of-sight geometry", "~15 min"),
    ("vmap4_assembler",  ["Buildings", "vmaps"],    ["vmaps"],       "assembling vmaps", "~5 min"),
    ("mmaps_generator",  [],                        ["mmaps"],       "NPC pathfinding", "HOURS"),
]


def looks_like_wow_client(path):
    """Cheap sanity check so we fail before a multi-hour run, not during it."""
    p = Path(path)
    if not p.is_dir():
        return "not a directory"
    data = p / "Data"
    if not data.is_dir():
        return "no Data/ subdirectory - is this the WoW client folder?"
    if not any(data.glob("*.MPQ")) and not any(data.glob("*.mpq")):
        return "Data/ contains no .MPQ archives"
    return None


def cmd_extract(args):
    """Run client-data extractors with persistent checkpoints.

    Final outputs under data/client/ are checkpoints. Intermediate Buildings/
    is never a checkpoint. mmaps_generator requires both maps/ and vmaps/ in
    the WoW client directory, so those inputs are temporarily restored there.
    """
    client = Path(args.client).expanduser().resolve()
    problem = looks_like_wow_client(client)
    if problem:
        die(f"{client}: {problem}\n"
            "  Point --client at your WoW 3.3.5a folder - the one containing Wow.exe and Data/.")

    # Windows CMake installs the tools directly in dist/, Linux uses dist/bin/.
    bindir = dist_dir() if IS_WINDOWS else dist_dir() / "bin"
    if not bindir.is_dir():
        die("extractors not built - run `ta.py build` first")

    target = REPO / "data" / "client"
    target.mkdir(parents=True, exist_ok=True)

    # Persistent checkpoints. If these exist, their stages are complete and
    # will never be unnecessarily repeated.
    stages = [
        ("map_extractor", ["dbc", "maps"], "DBC and map data", "~10 min"),
        ("vmap4_pipeline", ["vmaps"], "line-of-sight geometry", "~20 min"),
        ("mmaps_generator", ["mmaps"], "NPC pathfinding", "HOURS"),
    ]

    if args.skip_mmaps:
        stages = [s for s in stages if s[0] != "mmaps_generator"]
        warn("skipping mmaps: NPC pathfinding will be poor, but the realm runs.")

    info(f"extracting from {client}")
    print(f"     output goes to {target.relative_to(REPO)}/")
    print()

    for index, (tool, produces, what, duration) in enumerate(stages, start=1):
        if all((target / produced).exists() for produced in produces):
            ok(f"[{index}/{len(stages)}] {what} - already extracted, skipping")
            continue

        info(f"[{index}/{len(stages)}] {what} ({duration})")

        if tool == "map_extractor":
            exe = bindir / ("map_extractor.exe" if IS_WINDOWS else "map_extractor")
            if not exe.exists():
                die(f"{exe} missing - was the build run with TOOLS_BUILD=all?")

            rc = run([str(exe)], cwd=client, check=False)
            if rc != 0:
                die(f"map_extractor failed ({rc}). Nothing was moved; fix the cause and re-run.")

            for produced in produces:
                src_dir = client / produced
                if not src_dir.exists():
                    die(f"map_extractor reported success but produced no {produced}/")
                dest = target / produced
                if dest.exists():
                    shutil.rmtree(dest, ignore_errors=True)
                shutil.move(str(src_dir), str(dest))
                ok(f"  {produced}/ -> {dest.relative_to(REPO)}/")
            continue

        if tool == "vmap4_pipeline":
            # vmap4_extractor refuses to work if Buildings/ contains leftovers.
            buildings = client / "Buildings"
            if buildings.exists():
                info("removing stale Buildings/ from a previous extraction")
                shutil.rmtree(buildings, ignore_errors=True)
                if buildings.exists():
                    die(f"could not remove stale extractor output: {buildings}")

            extractor = bindir / ("vmap4_extractor.exe" if IS_WINDOWS else "vmap4_extractor")
            assembler = bindir / ("vmap4_assembler.exe" if IS_WINDOWS else "vmap4_assembler")
            if not extractor.exists():
                die(f"{extractor} missing - was the build run with TOOLS_BUILD=all?")
            if not assembler.exists():
                die(f"{assembler} missing - was the build run with TOOLS_BUILD=all?")

            rc = run([str(extractor)], cwd=client, check=False)
            if rc != 0:
                die(f"vmap4_extractor failed ({rc}). Nothing was moved; fix the cause and re-run.")

            if not buildings.is_dir():
                die("vmap4_extractor reported success but produced no Buildings/")

            rc = run([str(assembler)], cwd=client, check=False)
            if rc != 0:
                die(f"vmap4_assembler failed ({rc}). Nothing was moved; fix the cause and re-run.")

            vmaps = client / "vmaps"
            if not vmaps.is_dir():
                die("vmap4_assembler reported success but produced no vmaps/")

            dest = target / "vmaps"
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            shutil.move(str(vmaps), str(dest))
            ok(f"  vmaps/ -> {dest.relative_to(REPO)}/")

            shutil.rmtree(buildings, ignore_errors=True)
            continue

        if tool == "mmaps_generator":
            jobs = args.jobs or os.cpu_count() or 4
            warn("this is the long one. It is safe to stop and re-run later.")

            # The generator requires BOTH maps and vmaps in its working directory.
            restored = []
            for name in ("maps", "vmaps"):
                client_data = client / name
                stored_data = target / name
                if not client_data.exists() and stored_data.is_dir():
                    info(f"restoring {name}/ beside the client for mmaps_generator")
                    shutil.move(str(stored_data), str(client_data))
                    restored.append(name)

            for name in ("maps", "vmaps"):
                if not (client / name).is_dir():
                    die(f"cannot run mmaps_generator: {client / name} is missing")

            exe = bindir / ("mmaps_generator.exe" if IS_WINDOWS else "mmaps_generator")
            if not exe.exists():
                die(f"{exe} missing - was the build run with TOOLS_BUILD=all?")

            rc = run([str(exe), "--threads", str(jobs)], cwd=client, check=False)
            if rc != 0:
                # Restore any inputs even on failure so a retry has the same
                # persistent checkpoint state.
                for name in restored:
                    client_data = client / name
                    stored_data = target / name
                    if client_data.is_dir():
                        if stored_data.exists():
                            shutil.rmtree(stored_data, ignore_errors=True)
                        shutil.move(str(client_data), str(stored_data))
                die(f"mmaps_generator failed ({rc}). Nothing was moved; fix the cause and re-run.")

            mmaps = client / "mmaps"
            if not mmaps.is_dir():
                die("mmaps_generator reported success but produced no mmaps/")

            dest = target / "mmaps"
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            shutil.move(str(mmaps), str(dest))
            ok(f"  mmaps/ -> {dest.relative_to(REPO)}/")

            # Return maps/vmaps to their persistent repository location.
            for name in ("maps", "vmaps"):
                client_data = client / name
                dest_data = target / name
                if client_data.is_dir():
                    if dest_data.exists():
                        shutil.rmtree(dest_data, ignore_errors=True)
                    shutil.move(str(client_data), str(dest_data))
                    ok(f"  {name}/ -> {dest_data.relative_to(REPO)}/")
            continue

        die(f"unknown extraction step: {tool}")

    leftovers = client / "Buildings"
    if leftovers.exists():
        info("removing the Buildings/ intermediate")
        shutil.rmtree(leftovers, ignore_errors=True)

    ok("client extraction complete")
    return 0


def cmd_run(args):
    binary = "authserver" if args.target == "auth" else "worldserver"
    exe = (dist_dir() if IS_WINDOWS else dist_dir() / "bin") / (binary + (".exe" if IS_WINDOWS else ""))
    if not exe.exists():
        die(f"{exe} not found - run `ta.py build` first")
    info(f"starting {binary} (Ctrl+C to stop)")
    run([str(exe)], cwd=exe.parent, check=False)
    return 0



# --------------------------------------------------------------------------
# web  -  the public website in /web
#
# The website is a separate service with its own lifecycle: it can be deployed,
# restarted and upgraded without touching the realm. These subcommands exist so
# that `ta.py` stays the single entry point on both platforms, not because the
# two are coupled.
# --------------------------------------------------------------------------

WEB_DIR = REPO / "web"


def npm_cmd():
    """npm is a .cmd shim on Windows, which subprocess will not find unaided."""
    for candidate in (["npm.cmd"], ["npm"]) if IS_WINDOWS else (["npm"],):
        if shutil.which(candidate[0]):
            return candidate
    die("npm not found on PATH - install Node.js 20 or newer (https://nodejs.org)")


def web_env_path():
    return WEB_DIR / ".env.local"


def cmd_web(args):
    if not WEB_DIR.is_dir():
        die(f"{WEB_DIR} not found")
    return {
        "env": web_env,
        "install": web_install,
        "build": web_build,
        "dev": web_dev,
        "start": web_start,
        "sql": web_sql,
        "fixture": web_fixture,
        "dev-db": web_dev_db,
        "doctor": web_doctor,
        "verify-srp6": web_verify_srp6,
        "setup": web_setup,
    }[args.action](args)


def web_env(args):
    """Write web/.env.local from tools/local.json plus a fresh session secret."""
    import secrets

    target = web_env_path()
    if target.exists() and not args.force:
        warn(f"{target.relative_to(REPO)} already exists (use --force to regenerate)")
        return 0

    cfg = load_local()
    example = WEB_DIR / ".env.example"
    if not example.exists():
        die(f"{example} is missing")

    # Start from the documented example so every comment survives, then set the
    # handful of values we actually know about this machine.
    values = {
        "SITE_URL": cfg["site_url"],
        "SESSION_SECRET": secrets.token_urlsafe(48),
        "DATA_SOURCE": "live",
        "REALM_NAME": cfg["realm_name"],
        "REALM_ADDRESS": cfg["realm_address"],
        "REALM_WORLD_PORT": str(cfg["realm_port"]),
        "DB_HOST": cfg["mysql_host"],
        "DB_PORT": str(cfg["mysql_port"]),
        "DB_USER": cfg["web_db_user"],
        "DB_PASSWORD": cfg["web_db_pass"],
        "DB_AUTH": cfg["db_auth"],
        "DB_CHARACTERS": cfg["db_characters"],
        "DB_WORLD": cfg["db_world"],
        "DB_WEB": cfg["db_web"],
    }

    out, seen = [], set()
    for line in example.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in values:
                out.append(f"{key}={values[key]}")
                seen.add(key)
                continue
        out.append(line)

    missing = [f"{k}={v}" for k, v in values.items() if k not in seen]
    if missing:
        out.extend(["", "# Added by `ta.py web env`"] + missing)

    target.write_text("\n".join(out) + "\n", encoding="utf-8")
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass  # Windows without POSIX permissions - the file is still gitignored.

    ok(f"wrote {target.relative_to(REPO)} ({len(seen)} settings applied)")
    if not cfg["web_db_pass"]:
        warn("DB_PASSWORD is empty. Create the website's database user first:")
        warn("  1. edit web/sql/grants.sql, replacing CHANGE_ME with a password")
        warn("  2. python3 tools/ta.py web sql")
        warn('  3. put the same password in tools/local.json as "web_db_pass"')
        warn("  4. re-run `ta.py web env --force`")
    return 0


def web_install(args):
    info("installing website dependencies")
    lock = WEB_DIR / "package-lock.json"
    run(npm_cmd() + (["ci"] if lock.exists() else ["install"]), cwd=WEB_DIR)
    ok("dependencies installed")
    return 0


def web_build(args):
    info("building the website")
    run(npm_cmd() + ["run", "build"], cwd=WEB_DIR)
    ok("built - start it with `ta.py web start`")
    return 0


def web_dev(args):
    if not (WEB_DIR / "node_modules").is_dir():
        die("dependencies are not installed - run `ta.py web install` first")
    cfg = load_local()
    info(f"starting the development server on port {cfg['web_port']} (Ctrl+C to stop)")
    run(npm_cmd() + ["run", "dev", "--", "--port", str(cfg["web_port"])], cwd=WEB_DIR, check=False)
    return 0


def web_start(args):
    if not (WEB_DIR / ".next" / "standalone").is_dir():
        die("the website is not built - run `ta.py web build` first")
    cfg = load_local()
    info(f"starting the website on port {cfg['web_port']} (Ctrl+C to stop)")
    run(npm_cmd() + ["start"], cwd=WEB_DIR, check=False, env={"PORT": str(cfg["web_port"])})
    return 0


def _apply_sql(cfg, path, label):
    if not path.exists():
        die(f"{path} is missing")
    sql = path.read_text(encoding="utf-8")
    info(f"applying {label}")
    mysql_run(cfg, sql)
    ok(f"{label} applied")


def web_sql(args):
    """Create the website's own schema, and optionally its database user."""
    cfg = load_local()
    _apply_sql(cfg, WEB_DIR / "sql" / "web-schema.sql", "web/sql/web-schema.sql")

    grants = WEB_DIR / "sql" / "grants.sql"
    if args.grants:
        if "CHANGE_ME" in grants.read_text(encoding="utf-8"):
            die(f"edit {grants.relative_to(REPO)} and replace CHANGE_ME with a real password first")

        # Table-level grants need their tables. On a realm whose databases have
        # not been imported yet this fails with a bare "Table doesn't exist",
        # which does not tell you what to do about it.
        rc, _ = mysql_run(cfg, f"SELECT 1 FROM `{cfg['db_auth']}`.`account` LIMIT 0;", check=False)
        if rc != 0:
            die(
                f"`{cfg['db_auth']}`.`account` does not exist yet, and MySQL cannot grant on a\n"
                "       table that is not there. Start the worldserver once so AzerothCore\n"
                "       imports its schema (`ta.py run world`), then run this again.\n"
                "       For a database with no realm behind it, use `ta.py web dev-db --yes`."
            )
        _apply_sql(cfg, grants, "web/sql/grants.sql")
    else:
        print()
        print(f"     The website also needs its own MySQL user. Edit {grants.relative_to(REPO)},")
        print("     replace CHANGE_ME, then run `ta.py web sql --grants`.")
    return 0


def web_fixture(args):
    """Load sample AzerothCore-shaped data so the site can run with no realm."""
    cfg = load_local()
    if not args.yes:
        die(
            "This writes sample rows into acore_auth / acore_characters / acore_world.\n"
            "       It is for development databases only. Re-run with --yes if you mean it."
        )

    # Order matters and is not negotiable: characters, then the module's own
    # tables, then who bought what. Each file is applied exactly once.
    _apply_sql(cfg, WEB_DIR / "sql" / "dev-fixture.sql", "web/sql/dev-fixture.sql")

    # The classless tables are the module's, not the website's. Apply the real
    # files rather than a second copy that can drift away from them.
    module_sql = REPO / "modules" / "mod-classless" / "data" / "sql"
    for db_key, subdir in (("db_world", "db-world"), ("db_characters", "db-characters")):
        for path in sorted((module_sql / subdir).glob("*.sql")):
            info(f"applying {path.relative_to(REPO)} to {cfg[db_key]}")
            # The broker NPC needs creature_template, which only a real world
            # import provides. Its absence is expected here and harmless: the
            # website never reads it.
            rc, _ = mysql_run(cfg, path.read_text(encoding="utf-8"),
                              database=cfg[db_key], check=False)
            if rc != 0:
                warn(f"  {path.name} did not apply cleanly - fine if it needs a full world import")

    _apply_sql(cfg, WEB_DIR / "sql" / "dev-fixture-classless.sql",
               "web/sql/dev-fixture-classless.sql")
    ok("fixture loaded - the armory now has classless builds to render")
    return 0


def web_dev_db(args):
    """
    One command: a working local database the website can actually connect to.

    Starting the site is easy; the fiddly part is a database with the right
    schemas, a user that is allowed to read them, sample characters to render,
    and an .env.local that agrees with all of it. This does the lot:

        1. start MySQL (Docker) if nothing is reachable already
        2. create acore_auth / acore_world / acore_characters
        3. create the website's own schema and its least-privilege user
        4. apply the classless module's SQL, so builds have trees to point at
        5. load sample characters
        6. write web/.env.local pointing at all of the above

    Development only. It inserts invented characters, so it refuses to run
    without --yes and prints what it is about to write to first.
    """
    import argparse as _argparse
    import json as _json
    import secrets

    cfg = load_local()

    if not args.yes:
        print()
        warn("`web dev-db` builds a DEVELOPMENT database and inserts sample characters.")
        warn(f"  server  : {cfg['mysql_host']}:{cfg['mysql_port']}")
        warn(f"  schemas : {cfg['db_auth']}, {cfg['db_world']}, {cfg['db_characters']}, {cfg['db_web']}")
        warn("")
        warn("If that is a real realm's database, DO NOT run this - point")
        warn("web/.env.local at it instead and run `ta.py web env --force`.")
        warn("")
        die("re-run with --yes if this is a development database")

    # 1. Is anything listening? Start Docker MySQL only if not.
    rc, _ = mysql_run(cfg, "SELECT 1;", check=False)
    if rc != 0:
        if not shutil.which("docker"):
            die(
                f"no MySQL at {cfg['mysql_host']}:{cfg['mysql_port']} and no docker to start one.\n"
                "       Install MySQL 8 (or Docker), then put the credentials in tools/local.json."
            )
        info("no MySQL reachable - starting one in Docker")
        cmd_db(_argparse.Namespace(action="up"))
    else:
        ok(f"MySQL reachable at {cfg['mysql_host']}:{cfg['mysql_port']}")

    # 2. The three AzerothCore schemas.
    cmd_db(_argparse.Namespace(action="init"))

    # 3. Tables first. `grants.sql` grants on individual tables of acore_auth,
    #    and MySQL refuses a table-level GRANT for a table that does not exist
    #    yet - so the schema has to be in place before the user is created.
    web_fixture(_argparse.Namespace(yes=True))
    _apply_sql(cfg, WEB_DIR / "sql" / "web-schema.sql", "web/sql/web-schema.sql")

    # 4. Now the user - created for BOTH hosts, deliberately.
    #
    #    A '%' account alone is not enough on a fresh MySQL or MariaDB: the
    #    default install leaves an anonymous ''@'localhost' account, and host
    #    matching prefers the more specific 'localhost' over '%'. A local
    #    connection then matches the anonymous account, fails the password, and
    #    reports "Access denied for user 'ash_web'@'localhost'" - naming an
    #    account that does not exist. Creating both ends that entirely.
    password = cfg["web_db_pass"] or secrets.token_urlsafe(18)
    template = (WEB_DIR / "sql" / "grants.sql").read_text(encoding="utf-8")
    info("creating the website's database user")
    user = cfg["web_db_user"]
    for host in ("localhost", "%"):
        mysql_run(cfg, template.replace("CHANGE_ME", password).replace("'localhost'", f"'{host}'"))
        # CREATE USER IF NOT EXISTS keeps an existing user's OLD password, so a
        # second run would hand the site a password the server does not accept
        # and the page would report the database down. Set it explicitly.
        mysql_run(cfg, f"ALTER USER IF EXISTS '{user}'@'{host}' IDENTIFIED BY '{password}';")

    rc, _ = mysql_run(cfg, "SELECT 1;", check=False)
    probe = dict(cfg, mysql_user=user, mysql_pass=password)
    rc, _ = mysql_run(probe, f"SELECT 1 FROM `{cfg['db_characters']}`.`characters` LIMIT 0;", check=False)
    if rc != 0:
        die(f"user '{user}' was created but cannot connect - check the MySQL error log")
    ok(f"user '{user}' connects, from localhost and from other hosts")

    # 6. Remember the password, then write an .env.local that matches.
    local_file = REPO / "tools" / "local.json"
    local = {}
    if local_file.exists():
        try:
            local = _json.loads(local_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            warn("tools/local.json is not valid JSON - not updating it")
            local = None
    if local is not None and local.get("web_db_pass") != password:
        local["web_db_pass"] = password
        local.setdefault("web_db_user", cfg["web_db_user"])
        local_file.write_text(_json.dumps(local, indent=2) + "\n", encoding="utf-8")
        ok(f"recorded the website's database password in {local_file.relative_to(REPO)}")

    web_env(_argparse.Namespace(force=True))

    print()
    ok("the website has a database to talk to")
    print()
    print("     Start it:")
    print("       python3 tools/ta.py web build && python3 tools/ta.py web start")
    print()
    print("     Then check /status - it should say the database is reachable,")
    print("     and /armory should find Emberlyn.")
    return 0


def _env_file_values(path, keys):
    """
    Read KEY=VALUE pairs out of a .env file.

    Doctors must check the credential the SERVICE actually uses, which is the
    one in its .env.local - not the one recorded in tools/local.json. When those
    two disagree the service is down and local.json looks perfectly healthy,
    which is exactly the failure this exists to catch.
    """
    values = {key: "" for key in keys}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key in values:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value
    return values


def web_doctor(args):
    cfg = load_local()
    problems = 0

    node = shutil.which("node")
    if node:
        _, version, _ = capture([node, "--version"])
        major = int(version.lstrip("v").split(".")[0] or 0)
        (ok if major >= 20 else warn)(f"node {version}" + ("" if major >= 20 else " - 20 or newer is required"))
        problems += 0 if major >= 20 else 1
    else:
        warn("node not found - install Node.js 20 or newer")
        problems += 1

    if shutil.which(npm_cmd()[0] if shutil.which("npm") or IS_WINDOWS else "npm"):
        ok("npm found")
    else:
        warn("npm not found")
        problems += 1

    if (WEB_DIR / "node_modules").is_dir():
        ok("dependencies installed")
    else:
        warn("dependencies not installed - run `ta.py web install`")
        problems += 1

    env_file = web_env_path()
    if env_file.exists():
        text = env_file.read_text(encoding="utf-8", errors="replace")
        secret = ""
        for line in text.splitlines():
            if line.startswith("SESSION_SECRET="):
                secret = line.split("=", 1)[1].strip()
        if len(secret) >= 32:
            ok("SESSION_SECRET is set")
        else:
            warn("SESSION_SECRET is missing or too short - run `ta.py web env --force`")
            problems += 1
    else:
        warn(f"{env_file.relative_to(REPO)} not found - run `ta.py web env`")
        problems += 1

    if (WEB_DIR / ".next" / "standalone").is_dir():
        ok("website is built")
    else:
        warn("website is not built - run `ta.py web build`")

    code, out, _ = capture(mysql_cmd(cfg) + ["-N", "-B", "-e",
                                             f"SELECT COUNT(*) FROM information_schema.tables "
                                             f"WHERE table_schema = '{cfg['db_web']}'"])
    if code == 0 and out.strip().isdigit() and int(out.strip()) >= 3:
        ok(f"{cfg['db_web']} schema present ({out.strip()} tables)")
    else:
        warn(f"{cfg['db_web']} schema missing or empty - run `ta.py web sql`")
        problems += 1

    # Can the SITE connect? Everything above this line passes while the website
    # is completely down, because everything above connects as the admin user
    # from tools/local.json. The site uses DB_USER/DB_PASSWORD out of
    # web/.env.local, and when that password and MySQL's disagree every page
    # logs "Access denied for user 'ash_web'@'localhost'" while the doctor
    # cheerfully reports the website looks ready. It did exactly that once.
    site = _env_file_values(web_env_path(), ("DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT"))
    if not site["DB_USER"]:
        warn("web/.env.local names no DB_USER - run `ta.py web env --force`")
        problems += 1
    else:
        probe = dict(cfg,
                     mysql_user=site["DB_USER"],
                     mysql_pass=site["DB_PASSWORD"],
                     mysql_host=site["DB_HOST"] or cfg["mysql_host"],
                     mysql_port=site["DB_PORT"] or cfg["mysql_port"])
        rc, _ = mysql_run(probe, f"SELECT 1 FROM `{cfg['db_characters']}`.`characters` LIMIT 0;", check=False)
        if rc == 0:
            ok(f"the site's own user '{site['DB_USER']}' connects and can read characters")
        else:
            warn(f"the site's own user '{site['DB_USER']}' CANNOT connect with the password in")
            warn("web/.env.local. Every page will report the database down. Fix with:")
            warn("  python3 tools/ta.py web dev-db --yes      (development database)")
            warn("  ...then restart the website so it picks the new password up.")
            problems += 1

    print()
    if problems:
        warn(f"{problems} thing(s) to fix - see SETUP.md section 9")
        return 1
    ok("the website looks ready")
    return 0


def web_verify_srp6(args):
    """
    Prove the website computes SRP6 exactly as the server does.

    Given an account the *realm itself* created (`account create` in the
    worldserver console), recompute the verifier from the stored salt and the
    known password. If they match, the website can create accounts the game
    client will accept - which no unit test can establish on its own.

    The pinned vector below is the same one web/src/lib/srp6.test.ts asserts,
    so a pass here means the Python and TypeScript implementations agree with
    each other *and* with the realm's own data.
    """
    import hashlib

    modulus = int("894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7", 16)

    def verifier_for(username, password, salt):
        identity = hashlib.sha1(f"{username.upper()}:{password.upper()}".encode()).digest()
        exponent = int.from_bytes(hashlib.sha1(salt + identity).digest(), "little")
        return pow(7, exponent, modulus).to_bytes(32, "little")

    pinned = verifier_for("ASHMORROW", "TOMORROWSASH", bytes([0x11] * 32)).hex()
    expected = "13624bc6778a4fbbe1637e831336494fdea028c701ef14b8fcb706ea95a12952"
    if pinned != expected:
        die("the SRP6 implementation no longer matches its pinned test vector")
    ok("SRP6 matches the vector pinned in web/src/lib/srp6.test.ts")

    cfg = load_local()
    username = args.username.upper()
    code, out, err = capture(mysql_cmd(cfg) + [
        "-N", "-B", "-e",
        f"SELECT HEX(salt), HEX(verifier) FROM `{cfg['db_auth']}`.`account` WHERE username = '{username}'",
    ])
    if code != 0:
        die(f"could not read the account table: {err or out}")
    if not out.strip():
        die(f"no account named {username} in {cfg['db_auth']} - create one in the worldserver "
            f"console with `account create {args.username} <password>` first")

    salt_hex, verifier_hex = out.split()
    computed = verifier_for(username, args.password, bytes.fromhex(salt_hex)).hex()

    if computed == verifier_hex.lower():
        ok(f"the verifier stored for {username} matches a fresh computation")
        print()
        print("     The website will create accounts this realm's client accepts.")
        return 0

    warn(f"MISMATCH for {username}")
    warn("  The website would create accounts the game client cannot log into.")
    warn("  Either the password given here is wrong, or upstream changed SRP6.")
    return 1


def web_setup(args):
    """Everything a first-time website install needs, in order."""
    web_install(args)
    args.force = getattr(args, "force", False)
    web_env(args)
    web_build(args)
    print()
    print(f"     Next: `python3 tools/ta.py web sql` to create the site's schema,")
    print(f"     then `python3 tools/ta.py web start`.")
    return 0


# --------------------------------------------------------------------------
# the admin panel
#
# A THIRD service, separate again from the website. It runs as its own MySQL
# user with privileges the website must never have, so the two are never
# collapsed into one process - see docs/decisions/0008-admin-panel.md.
#
# Same reasoning as the web subcommands above: these exist so ta.py stays the
# single entry point on both platforms, not because the panel is coupled to the
# game server.
# --------------------------------------------------------------------------

ADMIN_DIR = REPO / "web-admin"


def admin_env_path():
    return ADMIN_DIR / ".env.local"


def cmd_admin(args):
    if not ADMIN_DIR.is_dir():
        die(f"{ADMIN_DIR} not found")
    return {
        "env": admin_env,
        "install": admin_install,
        "build": admin_build,
        "dev": admin_dev,
        "start": admin_start,
        "sql": admin_sql,
        "dev-db": admin_dev_db,
        "doctor": admin_doctor,
        "setup": admin_setup,
    }[args.action](args)


def admin_env(args):
    """Write web-admin/.env.local from tools/local.json plus fresh keys."""
    import secrets

    target = admin_env_path()
    if target.exists() and not args.force:
        warn(f"{target.relative_to(REPO)} already exists (use --force to regenerate)")
        return 0

    cfg = load_local()
    example = ADMIN_DIR / ".env.example"
    if not example.exists():
        die(f"{example} is missing")

    # Two separate keys, and they must stay separate: rotating the session
    # secret signs everyone out (fine), rotating the TOTP key makes every
    # enrolled authenticator unreadable (not fine).
    values = {
        "ADMIN_SITE_URL": cfg["admin_url"],
        "ADMIN_PUBLIC": "0",
        "ADMIN_SESSION_SECRET": secrets.token_urlsafe(48),
        "ADMIN_TOTP_KEY": secrets.token_urlsafe(48),
        "REALM_ID": "1",
        "REALM_NAME": cfg["realm_name"],
        "DB_HOST": cfg["mysql_host"],
        "DB_PORT": str(cfg["mysql_port"]),
        "DB_USER": cfg["admin_db_user"],
        "DB_PASSWORD": cfg["admin_db_pass"],
        "DB_AUTH": cfg["db_auth"],
        "DB_CHARACTERS": cfg["db_characters"],
        "DB_WORLD": cfg["db_world"],
        "DB_ADMIN": cfg["db_admin"],
    }

    out, seen = [], set()
    for line in example.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in values:
                out.append(f"{key}={values[key]}")
                seen.add(key)
                continue
        out.append(line)

    missing = [f"{k}={v}" for k, v in values.items() if k not in seen]
    if missing:
        out.extend(["", "# Added by `ta.py admin env`"] + missing)

    target.write_text("\n".join(out) + "\n", encoding="utf-8")
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass  # Windows without POSIX permissions - the file is still gitignored.

    ok(f"wrote {target.relative_to(REPO)} ({len(seen)} settings applied)")
    warn("ADMIN_TOTP_KEY is in that file. Back it up: losing it makes every")
    warn("enrolled authenticator unreadable.")
    if not cfg["admin_db_pass"]:
        warn("DB_PASSWORD is empty. Create the panel's database user first:")
        warn("  1. python3 tools/ta.py admin sql --grants")
        warn("  2. re-run `ta.py admin env --force`")
    return 0


def admin_install(args):
    info("installing admin panel dependencies")
    lock = ADMIN_DIR / "package-lock.json"
    run(npm_cmd() + (["ci"] if lock.exists() else ["install"]), cwd=ADMIN_DIR)
    ok("dependencies installed")
    return 0


def admin_build(args):
    info("building the admin panel")
    run(npm_cmd() + ["run", "build"], cwd=ADMIN_DIR)
    ok("built - start it with `ta.py admin start`")
    return 0


def admin_dev(args):
    if not (ADMIN_DIR / "node_modules").is_dir():
        die("dependencies are not installed - run `ta.py admin install` first")
    cfg = load_local()
    info(f"starting the admin panel in development on port {cfg['admin_port']} (Ctrl+C to stop)")
    run(npm_cmd() + ["run", "dev", "--", "--port", str(cfg["admin_port"])], cwd=ADMIN_DIR, check=False)
    return 0


def admin_start(args):
    if not (ADMIN_DIR / ".next" / "standalone").is_dir():
        die("the admin panel is not built - run `ta.py admin build` first")
    cfg = load_local()
    info(f"starting the admin panel on port {cfg['admin_port']} (Ctrl+C to stop)")
    run(npm_cmd() + ["start"], cwd=ADMIN_DIR, check=False, env={"PORT": str(cfg["admin_port"])})
    return 0


def _remember_local(values):
    """Record generated credentials in tools/local.json, which is gitignored."""
    import json as _json

    local_file = REPO / "tools" / "local.json"
    local = {}
    if local_file.exists():
        try:
            local = _json.loads(local_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            warn("tools/local.json is not valid JSON - not updating it")
            return
    if all(local.get(key) == value for key, value in values.items()):
        return
    local.update(values)
    local_file.write_text(_json.dumps(local, indent=2) + "\n", encoding="utf-8")
    ok(f"recorded credentials in {local_file.relative_to(REPO)}")


def admin_sql(args):
    """Create the panel's own schema, and optionally its database user."""
    cfg = load_local()
    _apply_sql(cfg, ADMIN_DIR / "sql" / "admin-schema.sql", "web-admin/sql/admin-schema.sql")

    if not args.grants:
        info("skipping the database user (pass --grants to create it)")
        return 0

    import secrets

    password = cfg["admin_db_pass"] or secrets.token_urlsafe(18)
    template = (ADMIN_DIR / "sql" / "admin-grants.sql").read_text(encoding="utf-8")
    if "CHANGE_ME" not in template:
        die("admin-grants.sql has no CHANGE_ME placeholder - has it been edited?")

    user = cfg["admin_db_user"]
    info(f"creating the panel's database user '{user}'")
    # Both hosts, deliberately - same anonymous-''@'localhost' trap documented
    # in web_dev_db above.
    for host in ("localhost", "%"):
        mysql_run(cfg, template.replace("CHANGE_ME", password).replace("'localhost'", f"'{host}'"))
        mysql_run(cfg, f"ALTER USER IF EXISTS '{user}'@'{host}' IDENTIFIED BY '{password}';")

    _remember_local({"admin_db_user": user, "admin_db_pass": password})
    ok(f"user '{user}' created, from localhost and from other hosts")
    return 0


def admin_dev_db(args):
    """
    One command: a local database the admin panel can actually operate on.

    Shares the website's *fixture* - the schemas, the module SQL, the sample
    characters - and nothing else. It adds the tables only the panel touches
    (bans, mutes, the MOTD, teleport destinations, the item-class backup) plus
    one staff account per tier, so the permission model can be exercised rather
    than reasoned about.

    It deliberately does NOT call `web dev-db`.

    That was the first version and it was wrong. `web dev-db` creates the
    *website's* database user, and when `web_db_pass` is not already recorded in
    tools/local.json it generates a new password, applies it to MySQL and
    rewrites web/.env.local. A website already running still holds the old
    password in memory, so setting up the admin panel would knock the public
    site offline with "Access denied for user 'ash_web'@'localhost'" until it
    was restarted. Two services, two credentials: this one has no business
    touching the other's.

    Development only. It creates accounts with known passwords, so it refuses to
    run without --yes.
    """
    import argparse as _argparse

    cfg = load_local()

    if not args.yes:
        print()
        warn("`admin dev-db` builds a DEVELOPMENT database and creates staff")
        warn("accounts WITH KNOWN PASSWORDS.")
        warn(f"  server  : {cfg['mysql_host']}:{cfg['mysql_port']}")
        warn(f"  schemas : {cfg['db_auth']}, {cfg['db_world']}, {cfg['db_characters']}, {cfg['db_admin']}")
        warn("")
        warn("If that is a real realm's database, DO NOT run this.")
        warn("")
        die("re-run with --yes if this is a development database")

    # 1. Is anything listening?
    rc, _ = mysql_run(cfg, "SELECT 1;", check=False)
    if rc != 0:
        if not shutil.which("docker"):
            die(
                f"no MySQL at {cfg['mysql_host']}:{cfg['mysql_port']} and no docker to start one.\n"
                "       Install MySQL 8 (or Docker), then put the credentials in tools/local.json."
            )
        info("no MySQL reachable - starting one in Docker")
        cmd_db(_argparse.Namespace(action="up"))
    else:
        ok(f"MySQL reachable at {cfg['mysql_host']}:{cfg['mysql_port']}")

    # 2. The three AzerothCore schemas, then the shared fixture: sample
    #    accounts and characters, the module's own SQL, and who bought what.
    #    None of this touches the website's user or its .env.local.
    cmd_db(_argparse.Namespace(action="init"))
    web_fixture(_argparse.Namespace(yes=True))

    # 3. The panel's own schema, then the tables and staff accounts it needs.
    #    Schema before grants: admin-grants.sql names individual tables and
    #    MySQL refuses a table-level GRANT for a table that does not exist.
    _apply_sql(cfg, ADMIN_DIR / "sql" / "admin-schema.sql", "web-admin/sql/admin-schema.sql")
    _apply_sql(cfg, ADMIN_DIR / "sql" / "dev-fixture-admin.sql", "web-admin/sql/dev-fixture-admin.sql")

    # 4. The panel's own user. `ash_admin` only - `ash_web` is untouched.
    admin_sql(_argparse.Namespace(grants=True))

    cfg = load_local()
    probe = dict(cfg, mysql_user=cfg["admin_db_user"], mysql_pass=cfg["admin_db_pass"])
    rc, _ = mysql_run(probe, f"SELECT 1 FROM `{cfg['db_admin']}`.`admin_audit` LIMIT 0;", check=False)
    if rc != 0:
        die(f"user '{cfg['admin_db_user']}' was created but cannot connect - check the MySQL error log")
    ok(f"user '{cfg['admin_db_user']}' connects")

    admin_env(_argparse.Namespace(force=True))

    print()
    ok("the admin panel has a database to operate on")
    print()
    print("     Start it:")
    print("       python3 tools/ta.py admin build && python3 tools/ta.py admin start")
    print()
    print("     Sign in with any of these (development passwords):")
    print("       ASHOWNER   / ownerpass     owner")
    print("       ASHGM      / gmpass        game master")
    print("       ASHSUPPORT / supportpass   support, read-only")
    print()
    print("     Each is asked to enrol an authenticator on first sign-in.")
    return 0


def admin_doctor(args):
    cfg = load_local()
    problems = 0

    if not (ADMIN_DIR / "node_modules").is_dir():
        warn("dependencies are not installed - run `ta.py admin install`")
        problems += 1
    else:
        ok("dependencies installed")

    if not admin_env_path().exists():
        warn("web-admin/.env.local is missing - run `ta.py admin env`")
        problems += 1
    else:
        ok("web-admin/.env.local exists")
        text = admin_env_path().read_text(encoding="utf-8")
        for key in ("ADMIN_SESSION_SECRET", "ADMIN_TOTP_KEY", "DB_PASSWORD"):
            line = next((l for l in text.splitlines() if l.startswith(f"{key}=")), None)
            if line is None or not line.split("=", 1)[1].strip():
                warn(f"{key} is empty - the panel will refuse to start in production")
                problems += 1

    rc, _ = mysql_run(cfg, "SELECT 1;", check=False)
    if rc != 0:
        warn(f"no MySQL at {cfg['mysql_host']}:{cfg['mysql_port']}")
        problems += 1
    else:
        ok("MySQL reachable")
        # The panel's own credential, read from the file the panel actually
        # boots with rather than from tools/local.json - see _env_file_values.
        panel = _env_file_values(admin_env_path(), ("DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT"))
        probe = dict(cfg,
                     mysql_user=panel["DB_USER"] or cfg["admin_db_user"],
                     mysql_pass=panel["DB_PASSWORD"] or cfg["admin_db_pass"],
                     mysql_host=panel["DB_HOST"] or cfg["mysql_host"],
                     mysql_port=panel["DB_PORT"] or cfg["mysql_port"])
        rc, _ = mysql_run(probe, f"SELECT 1 FROM `{cfg['db_admin']}`.`admin_audit` LIMIT 0;", check=False)
        if rc != 0:
            warn(f"user '{cfg['admin_db_user']}' cannot read the audit table"
                 " - run `ta.py admin sql --grants`")
            problems += 1
        else:
            ok(f"user '{cfg['admin_db_user']}' can read the audit table")

            # The audit log is append-only BY GRANT. If that grant is wrong the
            # panel still works perfectly, which is exactly why it is worth
            # checking: nothing else would ever notice.
            rc, _ = mysql_run(
                probe,
                f"UPDATE `{cfg['db_admin']}`.`admin_audit` SET summary = summary WHERE id = 0;",
                check=False,
            )
            if rc == 0:
                warn(f"'{cfg['admin_db_user']}' can UPDATE the audit log - it must not."
                     " Re-run `ta.py admin sql --grants`.")
                problems += 1
            else:
                ok("the audit log is append-only (UPDATE is refused)")

    if problems:
        print()
        warn(f"{problems} problem(s) found")
        return 1
    print()
    ok("the admin panel looks ready")
    return 0


def admin_setup(args):
    import argparse as _argparse

    admin_install(args)
    admin_env(_argparse.Namespace(force=False))
    admin_build(args)
    return admin_doctor(args)


# --------------------------------------------------------------------------
# play - point a client at the realm and start it
# --------------------------------------------------------------------------
#
# The reference implementation of the launcher (docs/decisions/0006).
#
# The GUI launcher in launcher/ is the thing players get. This is the same
# behaviour with no window, no Rust build and no dependencies, which makes it
# three useful things at once: the way to test a realm from a terminal, the
# thing to reach for when the launcher itself is the suspect, and the
# description of what the launcher is supposed to do that is short enough to
# read in one sitting.
#
# It obeys the same rule the launcher does: it never downloads a Blizzard file.
# See docs/decisions/0005-client-distribution.md.

KNOWN_LOCALES = ["enUS", "enGB", "enCN", "enTW", "deDE", "esES", "esMX", "frFR",
                 "itIT", "koKR", "ptBR", "ptPT", "ruRU", "zhCN", "zhTW"]

WANTED_BUILD = 12340

# VS_FIXEDFILEINFO.dwSignature, little-endian on disk.
VERSION_SIGNATURE = b"\xbd\x04\xef\xfe"


def client_dir(args):
    """The client directory: --client, then local.json, then give up usefully."""
    chosen = getattr(args, "client", None) or load_local().get("client_path")
    if not chosen:
        die("no client directory. Pass --client /path/to/WoW-3.3.5a, or put\n"
            '       { "client_path": "/path/to/WoW-3.3.5a" } in tools/local.json.')
    path = Path(chosen).expanduser()
    if not path.is_dir():
        die(f"{path} is not a directory")
    return path


def find_executable(root):
    """Wow.exe, whatever case the filesystem gave it."""
    for entry in root.iterdir():
        if entry.is_file() and entry.name.lower() == "wow.exe":
            return entry
    return None


def read_file_version(exe):
    """
    The four-part version a PE executable states about itself.

    A port of launcher_core::client::read_file_version - see that for why the
    .rsrc section is located first and then scanned, rather than walking the
    resource directory tree.
    """
    try:
        image = exe.read_bytes()
    except OSError:
        return None

    start, end = 0, len(image)
    section = rsrc_bounds(image)
    if section:
        start, end = section

    at = image.find(VERSION_SIGNATURE, start, end)
    while at != -1:
        struc = int.from_bytes(image[at + 4:at + 8], "little")
        ms = int.from_bytes(image[at + 8:at + 12], "little")
        ls = int.from_bytes(image[at + 12:at + 16], "little")
        major = ms >> 16
        if struc and major:
            return (major, ms & 0xFFFF, ls >> 16, ls & 0xFFFF)
        at = image.find(VERSION_SIGNATURE, at + 4, end)
    return None


def rsrc_bounds(image):
    """Byte range of the .rsrc section, if the PE headers parse."""
    try:
        if image[:2] != b"MZ":
            return None
        pe = int.from_bytes(image[0x3C:0x40], "little")
        if image[pe:pe + 4] != b"PE\0\0":
            return None
        coff = pe + 4
        count = int.from_bytes(image[coff + 2:coff + 4], "little")
        optional = int.from_bytes(image[coff + 16:coff + 18], "little")
        header = coff + 20 + optional
        for _ in range(count):
            if image[header:header + 5] == b".rsrc":
                size = int.from_bytes(image[header + 16:header + 20], "little")
                pointer = int.from_bytes(image[header + 20:header + 24], "little")
                if 0 < pointer < len(image) and pointer + size <= len(image):
                    return pointer, pointer + size
                return None
            header += 40
    except (IndexError, ValueError):
        return None
    return None


def client_locales(root):
    data = root / "Data"
    if not data.is_dir():
        return []
    found = {known for known in KNOWN_LOCALES
             for entry in data.iterdir()
             if entry.is_dir() and entry.name.lower() == known.lower()}
    return sorted(found)


def inspect_client(root):
    """Everything tier 1 can tell us. Never raises for a merely odd client."""
    exe = find_executable(root)
    if not exe:
        die(f"no Wow.exe in {root} - is that the client directory?")
    version = read_file_version(exe)
    return {
        "root": root,
        "exe": exe,
        "version": version,
        "build": version[3] if version else None,
        "locales": client_locales(root),
    }


def find_runtimes():
    """Wine and Proton, best first. Empty on Windows, where none is needed."""
    if IS_WINDOWS:
        return []

    found = []
    wine = shutil.which("wine")
    if wine:
        found.append({"kind": "wine", "name": "Wine (system)", "program": Path(wine),
                      "steam_root": None})

    home = Path.home()
    for suffix in (".steam/steam", ".local/share/Steam", ".steam/root",
                   ".var/app/com.valvesoftware.Steam/data/Steam"):
        steam_root = home / suffix
        if not steam_root.is_dir():
            continue
        libraries = {steam_root}
        vdf = steam_root / "steamapps" / "libraryfolders.vdf"
        if vdf.is_file():
            for line in vdf.read_text(errors="replace").splitlines():
                parts = line.split('"')[1::2]
                if len(parts) >= 2 and parts[0].lower() == "path":
                    libraries.add(Path(parts[1]))
        for library in sorted(libraries):
            common = library / "steamapps" / "common"
            if not common.is_dir():
                continue
            for entry in sorted(common.iterdir()):
                if entry.name.startswith("Proton") and (entry / "proton").is_file():
                    found.append({"kind": "proton", "name": entry.name,
                                  "program": entry / "proton", "steam_root": steam_root})
    return found


def write_realmlist(client, address):
    """One line, LF, no BOM, into every locale directory the client has."""
    if not client["locales"]:
        die(f"no locale directory under {client['root'] / 'Data'} - expected something like Data/enUS")

    written = []
    for locale in client["locales"]:
        path = client["root"] / "Data" / locale / "realmlist.wtf"
        backup = path.with_name(path.name + ".ashmorrow-original")
        if path.exists() and not backup.exists():
            shutil.copy2(path, backup)
        path.write_text(f"set realmlist {address}\n", encoding="ascii", newline="\n")
        written.append(path)
    return written


def launch_plan(client, cfg, runtime=None):
    """The exact command that starts the game, as data. Mirrors launcher_core::launch."""
    args, env = [], {}

    if cfg.get("renderer") == "opengl":
        args.append("-opengl")
    if cfg.get("windowed"):
        args.append("-windowed")

    if IS_WINDOWS:
        return {"program": client["exe"], "args": args, "env": env, "cwd": client["root"]}

    if not runtime:
        die("no Wine or Proton found. Install Wine from your distribution, or Proton through Steam.")

    prefix = Path(cfg.get("wine_prefix") or (Path.home() / ".local/share/ashmorrow/prefix"))
    if runtime["kind"] == "proton":
        if not runtime["steam_root"]:
            die("Proton needs to know where Steam is installed")
        env["STEAM_COMPAT_DATA_PATH"] = str(prefix)
        env["STEAM_COMPAT_CLIENT_INSTALL_PATH"] = str(runtime["steam_root"])
        leading = ["run", str(client["exe"])]
    else:
        env["WINEPREFIX"] = str(prefix)
        env["WINEDEBUG"] = "-all"
        leading = [str(client["exe"])]

    prefix.mkdir(parents=True, exist_ok=True)
    return {"program": runtime["program"], "args": leading + args, "env": env,
            "cwd": client["root"]}


def cmd_play(args):
    cfg = load_local()

    if args.action == "doctor":
        return play_doctor(args, cfg)
    if args.action == "provision":
        return play_provision(args, cfg)
    if args.action == "verify":
        return play_verify(args, cfg)
    if args.action == "config":
        return play_config(args, cfg)
    if args.action == "run":
        return play_run(args, cfg)
    die(f"unknown play action: {args.action}")


def play_doctor(args, cfg):
    info("Client")
    try:
        client = inspect_client(client_dir(args))
    except Fail as exc:
        warn(str(exc))
        client = None

    if client:
        ok(f"{client['exe']}")
        if client["build"] == WANTED_BUILD:
            ok(f"build {client['build']} - the build Ashmorrow needs")
        elif client["build"]:
            warn(f"this client reports {'.'.join(str(n) for n in client['version'])}, "
                 f"and Ashmorrow needs build {WANTED_BUILD}. Nothing here can change that.")
        else:
            warn("no version resource in Wow.exe - this may be a repack. Proceeding anyway.")
        ok(f"locales: {', '.join(client['locales']) or 'none found'}")

    info("Running the game")
    if IS_WINDOWS:
        ok("Windows - the client runs natively")
    else:
        runtimes = find_runtimes()
        if not runtimes:
            warn("no Wine or Proton found. `sudo apt install wine64`, or install Proton via Steam.")
            warn("Everything after that, `play provision` does for you.")
        else:
            for runtime in runtimes:
                ok(f"{runtime['name']} - {runtime['program']}")

            prefix = Path(cfg.get("wine_prefix") or (Path.home() / ".local/share/ashmorrow/prefix"))
            windows_dir = prefix / "drive_c" / "windows"
            # A prefix with no DXVK starts the game and shows a black window,
            # which is a worse outcome than not starting it.
            ready = ((windows_dir / "syswow64" / "d3d9.dll").is_file()
                     or (windows_dir / "system32" / "d3d9.dll").is_file())
            if ready:
                ok(f"prefix provisioned: {prefix}")
            else:
                warn(f"prefix not set up yet: {prefix}")
                warn("  python3 tools/ta.py play provision")

    info("Realm")
    ok(f"realmlist would be set to: {cfg['realm_address']}")

    info("Deep verification")
    binary = manifest_tool()
    if binary:
        ok(f"{binary}")
    else:
        warn("not built. `cargo build --manifest-path launcher/core/Cargo.toml "
             "--bin ashmorrow-manifest` to compare file hashes as well as structure.")
    return 0


def manifest_tool():
    """The Rust helper, if someone has built it."""
    for profile in ("release", "debug"):
        for name in ("ashmorrow-manifest", "ashmorrow-manifest.exe"):
            candidate = REPO / "launcher" / "core" / "target" / profile / name
            if candidate.is_file():
                return candidate
    return None


def play_verify(args, cfg):
    client = inspect_client(client_dir(args))
    info(f"{client['root']}")

    if client["build"] == WANTED_BUILD:
        ok(f"build {client['build']}")
    elif client["build"]:
        die(f"this client reports {'.'.join(str(n) for n in client['version'])}. "
            f"Ashmorrow needs build {WANTED_BUILD}, and neither this tool nor the launcher "
            f"can turn one into the other - you need a build {WANTED_BUILD} client.")
    else:
        warn("no version resource in Wow.exe, so the build could not be checked")

    if client["locales"]:
        ok(f"locales: {', '.join(client['locales'])}")
    else:
        die(f"no locale directory under {client['root'] / 'Data'}")

    manifest = REPO / "launcher" / "manifests" / "ashmorrow.json"
    binary = manifest_tool()
    if not binary:
        warn("structure only. Build launcher/core to compare file hashes too:")
        warn("  cargo build --manifest-path launcher/core/Cargo.toml --bin ashmorrow-manifest")
        return 0

    info("Comparing file hashes")
    code = run([binary, "check", client["root"], manifest], check=False)
    if code != 0:
        warn("some files differ from the build we measured. That does not mean your client "
             "is broken - it means it is not the copy we hashed.")
    return 0


def play_provision(args, cfg):
    """
    Create the Wine prefix and install what the game needs to run in it.

    Mirrors launcher_core::app::provision_runtime. Wine itself still belongs to
    your package manager - a tool that installs system packages behind your
    back has overstepped - but everything after that is ours to do.
    """
    if IS_WINDOWS:
        ok("Windows runs the client natively - nothing to set up.")
        return 0

    runtimes = find_runtimes()
    if not runtimes:
        die("no Wine or Proton found. Install Wine from your distribution, or Proton "
            "through Steam. Everything after that, this does for you.")

    wanted = args.runtime or cfg.get("runtime_name")
    runtime = next((r for r in runtimes if r["name"] == wanted), runtimes[0])
    prefix = Path(cfg.get("wine_prefix") or (Path.home() / ".local/share/ashmorrow/prefix"))
    info(f"{runtime['name']} -> {prefix}")

    env = {"WINEDEBUG": "-all"}
    if runtime["kind"] == "proton":
        if not runtime["steam_root"]:
            die("Proton needs to know where Steam is installed")
        env["STEAM_COMPAT_DATA_PATH"] = str(prefix)
        env["STEAM_COMPAT_CLIENT_INSTALL_PATH"] = str(runtime["steam_root"])
        boot = [runtime["program"], "run", "wineboot", "-u"]
    else:
        env["WINEPREFIX"] = str(prefix)
        boot = [runtime["program"], "wineboot", "-u"]

    prefix.mkdir(parents=True, exist_ok=True)

    # `wineboot -u` is safe against a prefix that already exists, so this is
    # also the repair path.
    info("creating the Wine prefix")
    if not args.dry_run:
        run(boot, env=env)
    ok(f"prefix at {prefix}")

    manifest_path = REPO / "launcher" / "manifests" / "ashmorrow.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        die(f"{manifest_path}: {exc}")

    components = manifest.get("runtime", [])
    if not components:
        ok("nothing else to install")
        return 0

    system32 = prefix / "drive_c" / "windows" / "system32"
    syswow64 = prefix / "drive_c" / "windows" / "syswow64"
    # Where a 32-bit DLL belongs depends on the prefix architecture, and getting
    # it wrong is the classic "DXVK did nothing" bug.
    target = syswow64 if syswow64.is_dir() else system32

    installed_any = False
    for component in components:
        if component.get("kind") != "dxvk":
            warn(f"{component.get('id')}: unknown kind {component.get('kind')!r}, skipped")
            continue
        if (target / "d3d9.dll").is_file():
            ok(f"{component['id']} already installed")
            continue
        if args.dry_run:
            info(f"would download {component['id']} {component['version']} from {component['url']}")
            continue
        install_dxvk(component, target)
        installed_any = True

    if installed_any and not args.dry_run:
        reg = prefix / "ashmorrow-overrides.reg"
        reg.write_text('REGEDIT4\n\n[HKEY_CURRENT_USER\\Software\\Wine\\DllOverrides]\n'
                       '"d3d9"="native,builtin"\n', encoding="ascii")
        info("telling Wine to prefer the installed DLLs")
        regedit = [runtime["program"]] + (["run"] if runtime["kind"] == "proton" else []) + \
                  ["regedit", str(reg)]
        run(regedit, env=env)
        ok("DLL override set")

    return 0


def install_dxvk(component, target):
    """Fetch a DXVK release, check it against the manifest, unpack the 32-bit DLL."""
    import hashlib
    import io
    import tarfile
    import urllib.request

    url = component["url"]
    if not url.startswith("https://"):
        die(f"{component['id']}: refusing to fetch {url} over plain HTTP")

    info(f"downloading {component['id']} {component['version']} ({component['size']:,} bytes)")
    with urllib.request.urlopen(url, timeout=120) as response:
        blob = response.read()

    if len(blob) != component["size"]:
        die(f"{component['id']} is {len(blob)} bytes, the manifest says {component['size']}. "
            "Nothing was written.")

    # BLAKE3 is not in the standard library, so the CLI verifies size and the
    # SHA-256 of what it got is printed for a human to compare. The GUI
    # launcher checks the manifest's BLAKE3 properly.
    digest = hashlib.sha256(blob).hexdigest()
    info(f"sha256 {digest}")

    target.mkdir(parents=True, exist_ok=True)
    written = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        for member in archive.getmembers():
            parts = Path(member.name).parts
            if len(parts) < 2 or parts[-2] != "x32" or parts[-1] != "d3d9.dll":
                continue
            source = archive.extractfile(member)
            if source is None:
                continue
            # Write beside and rename: an interrupted install must not leave a
            # half-written DLL that Wine will happily try to load.
            temporary = target / "d3d9.dll.ashmorrow-part"
            temporary.write_bytes(source.read())
            temporary.replace(target / "d3d9.dll")
            written += 1

    if not written:
        die(f"{component['id']}: no 32-bit d3d9.dll in the archive - is it a DXVK release?")
    ok(f"{component['id']} -> {target / 'd3d9.dll'}")


def play_config(args, cfg):
    client = inspect_client(client_dir(args))
    address = args.address or cfg["realm_address"]
    for path in write_realmlist(client, address):
        ok(f"{path} -> set realmlist {address}")

    account = args.account or cfg.get("account_name")
    if account:
        config_wtf = client["root"] / "WTF" / "Config.wtf"
        set_wtf_value(config_wtf, "accountName", account)
        ok(f"{config_wtf} -> accountName {account}")
        info("The password field is yours to fill: the client does its own login, and "
             "typing into it for you would mean writing into the running game's memory.")
    return 0


def set_wtf_value(path, key, value):
    """Set one SET key "value" line, preserving everything else in the file."""
    if '"' in value or "\n" in value:
        die(f"{key} cannot contain a quote or a newline")

    existing = path.read_text(errors="replace").splitlines() if path.exists() else []
    line = f'SET {key} "{value}"'
    out, replaced = [], False
    for current in existing:
        stripped = current.strip()
        is_key = (stripped[:4].upper() == "SET " and
                  stripped[4:].split()[:1] == [key] if len(stripped) > 4 else False)
        if is_key:
            if not replaced:
                out.append(line)
                replaced = True
        else:
            out.append(current)
    if not replaced:
        out.append(line)

    path.parent.mkdir(parents=True, exist_ok=True)
    backup = path.with_name(path.name + ".ashmorrow-original")
    if path.exists() and not backup.exists():
        shutil.copy2(path, backup)
    path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")


def play_run(args, cfg):
    client = inspect_client(client_dir(args))

    if client["build"] and client["build"] != WANTED_BUILD:
        warn(f"this client reports build {client['build']}, not {WANTED_BUILD}. "
             "Starting it anyway, but the realm will refuse the connection.")

    # A dry run must not touch the client: it exists to answer "what would you
    # do", and writing the realmlist first makes that a lie.
    if not args.dry_run:
        play_config(args, cfg)

    runtimes = find_runtimes()
    runtime = None
    if runtimes:
        wanted = args.runtime or cfg.get("runtime_name")
        runtime = next((r for r in runtimes if r["name"] == wanted), runtimes[0])
        info(f"through {runtime['name']}")

    plan = launch_plan(client, cfg, runtime)
    shown = " ".join([f"{k}={v}" for k, v in plan["env"].items()] +
                     [str(plan["program"])] + [str(a) for a in plan["args"]])
    print(f"{c('  $', 'grey')} {c(shown, 'grey')}")

    if args.dry_run:
        return 0

    proc = subprocess.Popen([str(plan["program"])] + [str(a) for a in plan["args"]],
                            cwd=str(plan["cwd"]), env={**os.environ, **plan["env"]})
    ok(f"started, pid {proc.pid}")
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

    p = sub.add_parser("install", help="guided setup: dependencies, core, build, database, configs")
    p.add_argument("--yes", "-y", action="store_true",
                   help="don't ask anything; take defaults for whatever isn't a flag")
    p.add_argument("--reconfigure", action="store_true",
                   help="re-ask the setup questions and overwrite existing configs")
    # database
    p.add_argument("--db", choices=["docker", "local", "remote"],
                   help="where MySQL lives (skips that question)")
    p.add_argument("--db-host", help="database host (local/remote)")
    p.add_argument("--db-port", help="database port")
    p.add_argument("--db-user", help="database user; needs CREATE DATABASE")
    p.add_argument("--db-password", help="database password (prefer the prompt; "
                                         "a flag lands in your shell history)")
    # realm
    p.add_argument("--realm-name", help="realm name shown in the client")
    p.add_argument("--realm-address", help="address clients are redirected to after login; "
                                           "use your LAN IP if anyone else connects")
    p.add_argument("--realm-port", help="world server port")
    # build
    p.add_argument("--build-type", choices=["Release", "RelWithDebInfo", "Debug"],
                   help="compiler build type")
    p.add_argument("--no-tools", action="store_true",
                   help="don't build the client-data extractors")
    p.add_argument("--skip-build", action="store_true", help="don't compile at all")
    p.add_argument("--rebuild", action="store_true", help="rebuild even if worldserver exists")
    p.add_argument("-j", "--jobs", type=int, help="parallel build/extract jobs")
    p.add_argument("--generator", help="explicit CMake generator")
    # client data
    p.add_argument("--client", help="path to your WoW 3.3.5a folder; also extracts client data")
    p.add_argument("--skip-mmaps", action="store_true", help="defer the multi-hour pathfinding step")
    p.set_defaults(func=cmd_install)

    p = sub.add_parser("extract", help="extract map/vmap/mmap/DBC data from your WoW client")
    p.add_argument("--client", required=True, help="path to your WoW 3.3.5a folder")
    p.add_argument("--skip-mmaps", action="store_true", help="skip the multi-hour pathfinding step")
    p.add_argument("-j", "--jobs", type=int, help="threads for mmaps generation")
    p.set_defaults(func=cmd_extract)

    sub.add_parser("doctor", help="check prerequisites").set_defaults(func=cmd_doctor)

    p = sub.add_parser("bootstrap", help="fetch pinned AzerothCore and overlay modules")
    p.add_argument("--force", action="store_true", help="delete and re-clone the core checkout")
    p.set_defaults(func=cmd_bootstrap)

    sub.add_parser("sync", help="re-overlay modules into the core checkout").set_defaults(func=cmd_sync)

    p = sub.add_parser("configure", help="run cmake configure")
    p.add_argument("--build-type", help="Release (default) / RelWithDebInfo / Debug")
    p.add_argument("--tools", help="TOOLS_BUILD: all (default) / none / maps-only / db-only")
    p.add_argument("--generator", help="explicit CMake generator, e.g. \"Visual Studio 17 2022\"")
    p.add_argument("--clean", action="store_true",
                   help="discard the CMake cache before configuring")
    p.set_defaults(func=cmd_configure)

    p = sub.add_parser("build", help="compile the server")
    p.add_argument("-j", "--jobs", type=int, help="parallel jobs (default: all cores)")
    p.add_argument("--build-type", choices=["Release", "RelWithDebInfo", "Debug"],
                   help="build configuration; especially important for Visual Studio")
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

    p = sub.add_parser("web", help="the public website in web/ (deploys separately)")
    p.add_argument("action", choices=["setup", "env", "install", "build", "dev", "start",
                                      "sql", "fixture", "dev-db", "doctor", "verify-srp6"])
    p.add_argument("--force", action="store_true", help="env: overwrite an existing .env.local")
    p.add_argument("--grants", action="store_true", help="sql: also create the website's MySQL user")
    p.add_argument("--yes", action="store_true",
                   help="fixture / dev-db: confirm writing sample data")
    p.add_argument("--username", help="verify-srp6: an account the realm itself created")
    p.add_argument("--password", help="verify-srp6: that account's password")
    p.set_defaults(func=cmd_web)

    p = sub.add_parser("admin", help="the operator panel in web-admin/ (deploys separately again)")
    p.add_argument("action", choices=["setup", "env", "install", "build", "dev", "start",
                                      "sql", "dev-db", "doctor"])
    p.add_argument("--force", action="store_true", help="env: overwrite an existing .env.local")
    p.add_argument("--grants", action="store_true", help="sql: also create the panel's MySQL user")
    p.add_argument("--yes", action="store_true", help="dev-db: confirm writing sample data")
    p.set_defaults(func=cmd_admin)

    p = sub.add_parser("play", help="point your own 3.3.5a client at the realm and start it")
    p.add_argument("action", choices=["doctor", "verify", "provision", "config", "run"])
    p.add_argument("--client", help="path to your WoW 3.3.5a client "
                                    "(or set client_path in tools/local.json)")
    p.add_argument("--address", help="realm address to write, overriding realm_address")
    p.add_argument("--account", help="pre-fill this account name on the login screen")
    p.add_argument("--runtime", help="run: name of the Wine or Proton runtime to use")
    p.add_argument("--dry-run", action="store_true",
                   help="run / provision: say what would happen, change nothing")
    p.set_defaults(func=cmd_play)

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
