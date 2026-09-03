# Tomorrow's Ash — build & run guide

Realm: **Ashmorrow** · Core: AzerothCore (WotLK 3.3.5a) · Client: **3.3.5a build 12340**

This guide covers **Windows** and **Linux**. Everything runs through one helper,
`tools/ta.py`, so both platforms use the same commands.

> **Kept current every phase.** If something here is wrong, that is a bug —
> report it and it gets fixed in the same pass as the code.

---

## 0. What you need before starting

| | Windows | Linux (Ubuntu/Debian) |
|---|---|---|
| Compiler | Visual Studio 2022, "Desktop development with C++" | `g++` or `clang` |
| CMake | 3.16+ ([cmake.org](https://cmake.org/download/)) | `cmake` |
| Git | [git-scm.com](https://git-scm.com/download/win) | `git` |
| Python | 3.8+ ([python.org](https://www.python.org/downloads/)) | `python3` |
| Boost | 1.78+ prebuilt, msvc-14.3 | `libboost-all-dev` |
| OpenSSL | Win64 OpenSSL **3.x** | `libssl-dev` |
| MySQL | MySQL Server 8.x | Docker **or** `mysql-server` |
| MySQL **client** | comes with MySQL Server (usually **not** on PATH — the installer finds it) | `mysql-client` ← **needed even with Docker** |

**Also required, separately:** a **World of Warcraft 3.3.5a (build 12340)**
client. Not distributed here, not downloadable from this repo. You need your own
copy. Section 5 explains what to do with it.

> **Why the MySQL *client* matters even when the database runs in Docker:**
> AzerothCore's built-in SQL updater shells out to the `mysql` binary to import
> `.sql` files. Without it the server starts fine and silently applies no
> database updates. `ta.py doctor` checks for it.

---

## 1. The short way

From a fresh clone, on either platform:

```bash
# Linux / macOS
./install.sh

# Windows (PowerShell)
.\install.ps1
```

It asks you about the choices that matter, then does dependencies, fetches
AzerothCore at the pinned commit, builds, creates the databases and renders the
server configs. It is **idempotent** — re-run it after a failure and it skips
what already succeeded.

What it asks:

| Question | Options | Why it matters |
|---|---|---|
| Where the databases live | Docker container / MySQL already on this machine / MySQL on another machine | The homelab case is usually the third — realm and database on different boxes |
| Realm address | defaults to your detected LAN IP | This is what clients are redirected to **after** login. `127.0.0.1` here is the usual cause of "login works but the realm shows offline" |
| Realm name and world port | `Ashmorrow`, `8085` | |
| Build type | Release / RelWithDebInfo / Debug | Release to play; the others are larger and only for debugging |
| Build the extractors? | yes | Skipping shortens the build, but you need them unless you already have extracted client data |

### Answering up front instead

**Every question has a matching flag**, so the same script serves a first-time
setup and an unattended rebuild. A question whose flag is supplied is not asked.

```bash
# Linux / macOS
./install.sh --db remote --db-host db.homelab.lan --db-user acore \
             --realm-address 192.168.1.50 --build-type Release

# Windows
.\install.ps1 -Database remote -DbHost db.homelab.lan -DbUser acore `
              -RealmAddress 192.168.1.50 -BuildType Release
```

| `install.sh` | `install.ps1` | Values | What it does |
|---|---|---|---|
| `--db` | `-Database` | `docker` `local` `remote` | Where MySQL lives (not `-Db`: PowerShell reserves that as an alias for `-Debug`) |
| `--db-host` | `-DbHost` | hostname or IP | Database host (`local`/`remote`) |
| `--db-port` | `-DbPort` | port | Database port, default `3306` |
| `--db-user` | `-DbUser` | username | Needs `CREATE DATABASE`; default `root` |
| `--db-password` | `-DbPassword` | password | **Prefer the prompt** — a flag lands in shell history |
| `--realm-name` | `-RealmName` | text | Realm name in the client, default `Ashmorrow` |
| `--realm-address` | `-RealmAddress` | IP or hostname | Where clients go **after** login — see the warning above |
| `--realm-port` | `-RealmPort` | port | World server port, default `8085` |
| `--build-type` | `-BuildType` | `Release` `RelWithDebInfo` `Debug` | Compiler build type |
| `--no-tools` | `-NoTools` | flag | Don't build the client-data extractors |
| `--skip-build` | `-SkipBuild` | flag | Don't compile at all |
| `--rebuild` | `-Rebuild` | flag | Rebuild even if `worldserver` already exists |
| `--jobs N` | `-Jobs N` | number | Parallel build/extract jobs, default all cores |
| `--generator` | `-Generator` | CMake generator | e.g. `"Visual Studio 17 2022"` |
| `--client PATH` | `-ClientPath PATH` | path | Your WoW 3.3.5a folder; also extracts client data |
| `--skip-mmaps` | `-SkipMmaps` | flag | Defer the multi-hour pathfinding step |
| `--reconfigure` | `-Reconfigure` | flag | Re-ask everything, overwrite `tools/local.json` |
| `--yes` / `-y` | `-Yes` | flag | Ask nothing; take defaults for anything not flagged |
| — | `-PythonPath` | path to `python.exe` | Windows only. Skip interpreter detection when it picks the wrong Python |

Your answers are written to **`tools/local.json`**, which every other `ta.py`
command reads. It holds your database password, is gitignored, and is the only
copy — back it up. Re-running the installer leaves it alone unless you pass
`--reconfigure`.

### Worked examples

```bash
# Homelab: realm on this box, database on the NAS, played from other machines
./install.sh --db remote --db-host 192.168.1.20 --db-user acore \
             --realm-address 192.168.1.50

# Just me, on this laptop, nothing else installed
./install.sh --db docker

# Rebuild on a CI box, no questions, no client data
./install.sh --yes --db local --db-user root --db-password "$MYSQL_PW" --rebuild

# I already have extracted client data; skip the extractors to shorten the build
./install.sh --no-tools
```

If you already have your WoW 3.3.5a client, hand it over and the installer does
the client-data extraction too:

```bash
./install.sh --client ~/Games/WoW-3.3.5a
.\install.ps1 -ClientPath 'C:\Games\WoW-3.3.5a'
```

Useful flags: `--yes` (never prompt), `--skip-mmaps` (defer the multi-hour
pathfinding step so you can play sooner), `-j N` (parallel jobs).

> The first build takes 20–60 minutes and about 15 GB. The installer tells you
> before it starts.

Everything below is the same process done by hand, for when a single step needs
attention.

---

## 2. Linux — step by step

```bash
# 1. dependencies
sudo apt update
sudo apt install -y git cmake ninja-build clang g++ python3 \
     libboost-all-dev libssl-dev libmysqlclient-dev \
     libreadline-dev libbz2-dev libncurses-dev ccache mysql-client

# 2. get the project
git clone https://github.com/BeeTwenty/tomorrows-ash.git
cd tomorrows-ash

# 3. check your machine
python3 tools/ta.py doctor

# 4. fetch AzerothCore at the pinned commit (~1 GB, few minutes)
python3 tools/ta.py bootstrap

# 5. build (30-60 min first time, 4 cores)
python3 tools/ta.py configure
python3 tools/ta.py build

# 6. database
python3 tools/ta.py db up        # MySQL 8.4 in Docker
python3 tools/ta.py db init      # create the three schemas

# 7. server configs, pointed at that database
python3 tools/ta.py conf
```

Then go to **section 6** (client data) — the server will not start without it.

> **If `db up` fails with "429 Too Many Requests"**, that is Docker Hub
> rate-limiting anonymous image pulls — nothing is wrong with your setup. Either
> run `docker login`, or use the native MySQL route just below, which needs no
> registry at all. (This is not hypothetical: it happened while building this
> guide.)

### Linux without Docker

If you'd rather run MySQL natively:

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'ashmorrow';"
```

Then create `tools/local.json` (gitignored) so `ta.py` talks to it:

```json
{ "mysql_host": "127.0.0.1", "mysql_port": 3306,
  "mysql_user": "root", "mysql_pass": "ashmorrow" }
```

Skip `ta.py db up`; `db init`, `conf` and `db realm` work unchanged.

---

## 3. Windows — step by step

Use **PowerShell**. Run `git` commands from PowerShell or Git Bash.

### 2.1 Install prerequisites

1. **Visual Studio 2022** (Community is fine). In the installer tick
   **Desktop development with C++**.
2. **CMake** — during install choose *Add CMake to the system PATH*.
3. **Git for Windows**, **Python 3** (tick *Add python.exe to PATH*).
4. **Boost — 1.78 or newer.** This is the most common cause of a failed
   Windows configure, and the version matters: AzerothCore requires **1.78+ on
   Windows** (`deps/boost/CMakeLists.txt`). An older Boost that happens to be
   installed will be found and rejected.

   Download the prebuilt `boost_1_8x_0-msvc-14.3-64.exe` from
   [Boost binaries](https://sourceforge.net/projects/boost/files/boost-binaries/)
   — pick a **1.8x** build, matching **msvc-14.3** (Visual Studio 2022) and
   **-64**. Install to e.g. `C:\local\boost_1_86_0`, then set a system
   environment variable:
   ```
   Boost_ROOT = C:\local\boost_1_86_0
   ```
   `deps/boost/CMakeLists.txt` reads `Boost_ROOT`; CMake itself also accepts
   `BOOST_ROOT` and `BOOSTROOT`. Windows environment variable names are
   case-insensitive, so `BOOST_ROOT` works there too — on Linux and macOS the
   capitalisation matters, so prefer `Boost_ROOT` everywhere.

   (Windows Search → "Edit the system environment variables" → Environment
   Variables → New, under *System variables*. **Reopen PowerShell afterwards.**)

   `python tools\ta.py doctor` reports the version it finds and where it came
   from, so check that before starting a build.

   > **If you already have an older Boost** — say `C:\local\boost_1_66_0` —
   > installing a newer one is not enough on its own: point `Boost_ROOT` at the
   > new folder, or the old one may still be found first. And if a configure
   > already failed against the old Boost, the answer is cached: CMake stores
   > the include directory it found and re-reads it next time, ignoring the
   > environment. `ta.py configure` now detects a cache whose paths have
   > vanished and clears it for you; `--clean` forces it.
5. **OpenSSL** — Win64 OpenSSL **v3.x** (not Light, not v1.x) from
   [slproweb](https://slproweb.com/products/Win32OpenSSL.html).
6. **MySQL Server 8.x** — the MySQL Installer. Remember the root password; its
   `bin\` folder also gives you `mysql.exe`.

> **On vcpkg:** the brief mentioned "Visual Studio + vcpkg or equivalent".
> AzerothCore's supported Windows path is the prebuilt Boost + OpenSSL
> installers above, not vcpkg. That is the "or equivalent" — it is fewer moving
> parts and it is what upstream actually tests. If you have a strong preference
> for vcpkg, say so and I'll add a manifest, but it is not the tested route.

### 2.2 Build

```powershell
git clone https://github.com/BeeTwenty/tomorrows-ash.git
cd tomorrows-ash

python tools\ta.py doctor
python tools\ta.py bootstrap

python tools\ta.py configure --generator "Visual Studio 17 2022"
python tools\ta.py build
```

`configure` writes a Visual Studio solution to `build\`. You can either keep
using `ta.py build`, or open `build\AzerothCore.sln` in Visual Studio, set the
configuration to **Release**, and build the `ALL_BUILD` target.

> **Module linking on Windows.** `ta.py` links `modules\mod-classless` into the
> core checkout using a symlink, falling back to a **directory junction**
> (`mklink /J`, no admin rights needed), falling back to a plain copy. If it
> reports a *copy*, run `python tools\ta.py sync` after editing module sources,
> or the build won't see your changes. Enabling **Developer Mode** (Settings →
> System → For developers) gets you real symlinks and avoids this.

### 2.3 Database on Windows

MySQL Server is already running as a service. Create `tools\local.json`:

```json
{ "mysql_host": "127.0.0.1", "mysql_port": 3306,
  "mysql_user": "root", "mysql_pass": "YOUR_MYSQL_ROOT_PASSWORD" }
```

Then:

```powershell
python tools\ta.py db init
python tools\ta.py conf
```

If `mysql.exe` isn't on PATH, add `C:\Program Files\MySQL\MySQL Server 8.0\bin`
to your PATH and reopen PowerShell.

---

## 4. What `ta.py` does

| Command | Purpose |
|---|---|
| **`install`** | **everything below, in one command** |
| `extract --client PATH` | pull map/vmap/mmap/DBC data out of your WoW client |
| `doctor` | check prerequisites and report what's missing |
| `bootstrap` | clone AzerothCore at the pinned commit into `.acore/`, link our modules |
| `sync` | re-link/re-copy modules after editing (only needed in copy mode) |
| `configure` | run CMake |
| `build [-j N]` | compile and install into `dist/` |
| `db up` / `down` / `status` | Docker MySQL lifecycle |
| `db init` | create `acore_auth`, `acore_world`, `acore_characters` |
| `db realm` | register the **Ashmorrow** realm row |
| `conf` | render `dist/etc/*.conf` pointed at your database |
| `run auth` / `run world` | start a server binary |
| `web setup` | install, configure and build the website (section 10) |
| `web sql` | create the website's own schema (and its MySQL user, with `--grants`) |
| `web start` / `web dev` | run the website |
| `web doctor` | check the website's prerequisites |
| `web verify-srp6` | prove the website's password handling matches the realm's |

Per-machine settings go in **`tools/local.json`** (gitignored) or `TA_*`
environment variables. Never commit credentials.

---

## 5. Databases

`ta.py db init` creates three empty schemas:

| Database | Contents |
|---|---|
| `acore_auth` | accounts, realm list |
| `acore_world` | world content: creatures, items, quests, spells |
| `acore_characters` | player characters |

They stay empty on purpose. AzerothCore's updater (`Updates.AutoSetup = 1`)
imports everything from `.acore/data/sql` on the **first worldserver start**.
That import is ~800 MB of SQL and takes **several minutes** — the console looks
frozen but is working. This happens once.

Check state at any time:

```bash
python3 tools/ta.py db status
```

### Connecting a website

Building a site against this database (registration, armory, realm status)?
See **[docs/WEBSITE-DB.md](docs/WEBSITE-DB.md)**. Short version:

```bash
python3 tools/ta.py db website-user   # least-privilege DB user for the site
cp web/.env.example /path/to/site/.env
```

Note that AzerothCore stores an SRP6 salt/verifier, **not** a password hash —
`docs/reference/srp6/` has verified implementations for Python, Node and PHP.
The website itself uses `web/src/lib/srp6.ts`, which CI checks against the same vector.

---

## 6. Client data (required — the server won't start without it)

The server needs map, vmap, mmap and DBC data **extracted from your own WoW
3.3.5a client**. This is the slowest one-time step.

**The easy way** — one command, correct order, output filed where the server
looks for it:

```bash
python3 tools/ta.py extract --client /path/to/WoW-3.3.5a
python3 tools/ta.py extract --client /path/to/WoW-3.3.5a --skip-mmaps   # play sooner
```

It validates the path before starting (so you don't discover a typo an hour in),
skips anything already extracted so an interrupted run resumes, and cleans up
its intermediates. The rest of this section is what it does, by hand.

The extractors were built alongside the server into `dist/bin/`:
`map_extractor`, `vmap4_extractor`, `vmap4_assembler`, `mmaps_generator`.

```bash
# from your WoW 3.3.5a client directory
cd /path/to/WoW-3.3.5a

/path/to/tomorrows-ash/dist/bin/map_extractor       # dbc/ + maps/     ~10 min
/path/to/tomorrows-ash/dist/bin/vmap4_extractor     # Buildings/       ~15 min
mkdir -p vmaps
/path/to/tomorrows-ash/dist/bin/vmap4_assembler Buildings vmaps
mkdir -p mmaps
/path/to/tomorrows-ash/dist/bin/mmaps_generator     # HOURS. Overnight job.
```

On Windows the same binaries live in `dist\bin\` — run them from the client
folder in PowerShell.

Then move the four output folders where the server expects them:

```bash
mkdir -p /path/to/tomorrows-ash/data/client
mv dbc maps vmaps mmaps /path/to/tomorrows-ash/data/client/
```

`ta.py conf` already points `DataDir` at `data/client`, and that path is
gitignored — client data must never be committed.

> `mmaps_generator` is the long pole (several hours, all cores). You can start
> the server without `mmaps` — NPC pathfinding will be poor but the realm runs —
> so consider generating maps/vmaps first, playing, and running mmaps overnight.

---

## 7. First run

Two processes. Two terminals.

```bash
# terminal 1 - authserver (login)
python3 tools/ta.py run auth

# terminal 2 - worldserver (game)
python3 tools/ta.py run world
```

First `run world` performs the big SQL import described in section 5. Wait for:

```
World initialized in X minutes Y seconds
AzerothCore rev. ... ready...
```

Then name the realm and create an account:

```bash
python3 tools/ta.py db realm       # sets realm 1 to "Ashmorrow"
```

In the **worldserver console**:

```
account create ashadmin somepassword
account set gmlevel ashadmin 3 -1
```

Restart the authserver after `db realm` so it picks up the new realm row.

---

## 8. Connecting a client

1. Copy your WoW 3.3.5a client somewhere (do not point it at the extraction
   folder you used above if you'd rather keep that pristine — either works).
2. Edit `WTF\Config.wtf`, or `Data\enUS\realmlist.wtf` (locale folder varies):

   ```
   set realmlist 127.0.0.1
   ```

   For your homelab server, use its LAN IP instead, e.g. `set realmlist 192.168.1.50`.
3. Make sure `ta.py db realm` used a matching address. If the client and server
   are on different machines, set it explicitly before running `db realm`:

   ```json
   { "realm_address": "192.168.1.50" }
   ```

   in `tools/local.json`. The `realmlist` row's `address` is what the client is
   redirected to **after** login — `127.0.0.1` there will break remote clients
   even when login itself succeeds. This is the single most common
   "I can log in but the realm is offline" cause.
4. Launch `Wow.exe` and log in with the account you created.

> **Or let the launcher do steps 2-4.** `python3 tools/ta.py play run --client
> /path/to/WoW-3.3.5a` writes the realmlist and starts the game, on either
> platform; the desktop launcher in `launcher/` does the same with a window.
> Section 10. This section stays correct either way — it is the fallback when
> the launcher is not an option.

Ports: **3724** (authserver) and **8085** (worldserver). Open both on the
homelab box's firewall for LAN play.

---

## 9. The classless module

`modules/mod-classless` is built into the server automatically. Its config is
installed to `dist/etc/mod_classless.conf`.

As of **Phase 1** it ships disabled (`Classless.Enable = 0`), so the realm
behaves as stock AzerothCore until you turn it on. With it enabled you get five
ability trees served by a gossip NPC.

```ini
Classless.Enable = 1
```

Restart worldserver, then spawn a broker where you're standing:

```
.npc add 900000
```

Talk to it to learn abilities from any tree regardless of class. GM commands
for testing without hunting down the NPC:

```
.classless trees            list the trees
.classless list <treeId>    list abilities in a tree
.classless learn <nodeId>   learn one (respects level, prerequisites and points)
.classless points           your skill-point budget
.classless respec           forget everything, refund the points
.classless status           what you own, and whether it's really in your spellbook
.classless reload           re-read the trees from the database
```

Skill points are earned per level (`Classless.Points.*` in the module config)
and are **derived from level, never stored** — retuning the curve re-prices
every character immediately, no migration.

Abilities live in the `classless_tree` / `classless_node` tables — changing them
needs no recompile, just `.classless reload`.

**Please run the test checklist in
[docs/PHASE1-FINDINGS.md §6](docs/PHASE1-FINDINGS.md)** once you have client
data. Some of what Phase 2 needs can only be measured in-game.

```ini
Classless.Enable = 0                      # master switch
Classless.Announce = 1                    # login notice
Classless.SuppressBlizzardTalents = 0     # Phase 2 - do not enable yet
Classless.OpenRelicSlot = 0               # Phase 3 - librams/idols/totems/sigils
```

`OpenRelicSlot` is the only gear restriction that is not a database row. Relic
slots are chosen by a hardcoded class check in the core, so the Phase 3 SQL
pass cannot reach them; this setting turns on a module hook that answers that
one check and nothing else. See
[docs/PHASE3-ITEMIZATION.md §4](docs/PHASE3-ITEMIZATION.md).

**Do not set `SuppressBlizzardTalents = 1` before the replacement system
exists**, or characters will have no way to spend points at all.

---

## 10. The website

The public site — landing page, account registration, armory, rankings, realm
status, wiki and patch notes — lives in **`web/`** and is a **separate
service**. It reads the realm's database and probes its ports, but it builds,
deploys and restarts independently. You can run the realm without it, and you
can run it against a realm on another machine.

Its own code map is in [web/README.md](web/README.md); why it is built this way
is in [ADR 0004](docs/decisions/0004-website.md).

### 9.1 What you need

**Node.js 20 or newer**, and nothing else the realm did not already need.

| | Windows | Linux |
|---|---|---|
| Node.js | [nodejs.org](https://nodejs.org) LTS installer | `sudo apt install nodejs npm` (or [nodesource](https://github.com/nodesource/distributions) for a current LTS) |

Check with `node --version`. Ubuntu's own `nodejs` package can be older than 20;
if it is, use nodesource or nvm.

### 9.2 Try it with no realm at all

The site runs standalone. With no database configured it starts in **demo
mode** — every page renders from built-in sample data and says so on screen.
Useful for looking at the design before the realm is up:

```bash
cd web
npm install
cp .env.example .env.local
npm run gen-secret          # prints a SESSION_SECRET= line; paste it into .env.local
npm run dev                 # http://localhost:3000
```

On Windows, the same commands in PowerShell (`copy .env.example .env.local`).

### 9.3 A database with no realm behind it

Demo mode needs no database at all, but it also cannot exercise the real
queries. If you want the site running against a **real MySQL** without building
the game server first, one command does the whole thing:

```bash
# Linux
python3 tools/ta.py web dev-db --yes

# Windows
python tools\ta.py web dev-db --yes
```

That starts MySQL in Docker if nothing is reachable, creates the three
AzerothCore schemas plus the site's own, applies the classless module's SQL so
the armory has trees to point at, loads a handful of sample characters, creates
the website's database user, and writes a matching `web/.env.local`. Then:

```bash
python3 tools/ta.py web build
python3 tools/ta.py web start
```

`/status` should report the database reachable, and `/armory` should find
**Emberlyn**.

It refuses to run without `--yes`, and prints the server and schemas it is about
to write to first — it inserts invented characters, so it must never be pointed
at a real realm. For that, see the next section.

### 9.4 Point it at a running Ashmorrow

**Step 1 — give the website its own database user.**

It must never connect as root. Edit `web/sql/grants.sql`, replace `CHANGE_ME`
with a long random password, then apply it along with the site's own schema:

```bash
# Linux
python3 tools/ta.py web sql --grants

# Windows
python tools\ta.py web sql --grants
```

That creates the `ashmorrow_web` schema (reset tokens, rate limits, audit log)
and an `ash_web` MySQL user with exactly the privileges the site uses: read on
the game data, column-scoped writes on `account`, and nothing else. Check it
with `SHOW GRANTS FOR 'ash_web'@'localhost';`.

> If the site runs on a different machine from MySQL, change `'localhost'` to
> `'%'` (or the site's address) in `grants.sql` before applying it, and make
> sure MySQL is listening on more than the loopback address.

**Step 2 — record the password where `ta.py` can see it.**

Add it to `tools/local.json` (gitignored, never committed):

```json
{ "mysql_host": "127.0.0.1", "mysql_port": 3306,
  "mysql_user": "root", "mysql_pass": "YOUR_ROOT_PASSWORD",
  "web_db_user": "ash_web", "web_db_pass": "THE_PASSWORD_YOU_CHOSE",
  "site_url": "http://192.168.1.50:3000", "web_port": 3000 }
```

**Step 3 — install, configure and build.**

```bash
# Linux
python3 tools/ta.py web setup

# Windows
python tools\ta.py web setup
```

That runs `npm ci`, writes `web/.env.local` from your `tools/local.json` with a
freshly generated session secret, and builds the site. Then:

```bash
python3 tools/ta.py web doctor    # confirms everything above actually worked
python3 tools/ta.py web start     # serves on web_port
```

**Step 4 — prove the password handling matches the realm's.**

This is the check worth running once. Create an account in the **worldserver
console**, then ask the website to recompute its verifier:

```
account create verifytest somepassword123
```

```bash
python3 tools/ta.py web verify-srp6 --username verifytest --password somepassword123
```

A pass means accounts created on the website are byte-identical to ones created
by the server, and the game client will accept them. Run it again after any
upstream bump. If it ever fails, **stop letting people register** until it
passes: the site would be creating accounts nobody can log into.

### 9.5 Configuration

Everything is in `web/.env.local`, which `ta.py web env` generates and
`web/.env.example` documents line by line. The values worth knowing:

| Setting | What it does |
|---|---|
| `SITE_URL` | the site's public address; password-reset links and cookie security depend on it |
| `SESSION_SECRET` | signs session cookies; required in production, 32+ characters |
| `DB_*` | the MySQL server and the four schema names |
| `REALM_ADDRESS` | what the site tells players to put in `realmlist.wtf` |
| `MAIL_TRANSPORT` | `console` (log reset links), `smtp` (send them), `disabled` |
| `TRUST_PROXY` | set to 1 **only** behind a reverse proxy you control |
| `ARMORY_HIDE_GM_LEVEL` | hides staff characters site-wide; 0 turns the filter off |
| `CLASSLESS_POINTS_PER_LEVEL` | optional. Unset, the armory shows points spent with no total. Set, it mirrors the realm's budget curve — a second copy that can go stale |

The site refuses to start in production with a missing or weak
`SESSION_SECRET`, or with no database configured unless you set
`DATA_SOURCE=demo` to say you meant it. That is deliberate: a misconfigured
site that serves anyway is worse than one that will not boot.

**Never commit `web/.env.local`.** It is gitignored, and `ta.py web env` writes
it mode 0600 on Linux.

### 9.6 Running it for real

**Linux, with systemd** — the usual choice for a homelab:

```bash
sudo useradd --system --home /opt/tomorrows-ash ashmorrow
sudo cp -r . /opt/tomorrows-ash          # or clone there in the first place
sudo install -m 600 -o root -g root web/.env.local /etc/ashmorrow-web.env
sudo cp web/ashmorrow-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ashmorrow-web
journalctl -u ashmorrow-web -f
```

The unit ships with the hardening a service like this should have
(`ProtectSystem=strict`, `NoNewPrivileges`, no home access). Adjust `User` and
the paths to match your install.

**Linux or Windows, with Docker:**

```bash
cd web
docker compose up -d --build
```

The compose file reads `web/.env.local` and points the container at the host's
MySQL and realm ports via `host.docker.internal`. The image contains no
configuration at all — everything arrives as environment variables — so the
same image is safe to push anywhere.

**Windows, as a service.** There is no systemd; two workable options:

- **NSSM** ([nssm.cc](https://nssm.cc)): `nssm install AshmorrowWeb "C:\Program Files\nodejs\node.exe" "scripts\start.mjs"`, set *Startup directory* to your `web\` folder.
- **Task Scheduler**: a task triggered *At startup*, running `node.exe` with argument `scripts\start.mjs` and *Start in* set to `web\`, with "Run whether user is logged on or not".

Either way the site reads `web\.env.local` from its working directory.

**Behind a reverse proxy** (recommended for anything public — Node should not
terminate TLS here):

```nginx
server {
    listen 443 ssl http2;
    server_name ashmorrow.example;

    ssl_certificate     /etc/letsencrypt/live/ashmorrow.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ashmorrow.example/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Caddy needs two lines:

```
ashmorrow.example {
    reverse_proxy 127.0.0.1:3000
}
```

With a proxy in front, set `TRUST_PROXY=1` and `SITE_URL=https://...` in
`web/.env.local`, or rate limiting cannot tell your visitors apart and cookies
will not be marked `Secure`.

### 9.7 Upgrading

```bash
git pull
python3 tools/ta.py web install
python3 tools/ta.py web build
python3 tools/ta.py web sql        # re-apply the schema; it is idempotent
sudo systemctl restart ashmorrow-web
```

### 9.8 Website troubleshooting

| Symptom | Cause / fix |
|---|---|
| Refuses to start, "configuration is not usable" | Read the list it prints. Usually `SESSION_SECRET` or `DB_HOST` |
| Every page says "demo mode" | No `DB_HOST` set, or `DATA_SOURCE=demo` |
| Status page shows the realm down but it is running | The site probes `REALM_ADDRESS`; from another machine `127.0.0.1` is itself. Set `REALM_AUTH_HOST` / `REALM_WORLD_HOST` |
| Registration fails, "database refused" | The `ash_web` user is missing a grant. `SHOW GRANTS FOR 'ash_web'@'localhost';` and compare with `web/sql/grants.sql` |
| Password reset never arrives | `MAIL_TRANSPORT=console` prints the link to the server log — that is by design for a homelab. Set SMTP for real mail |
| Armory finds nothing | Characters appear once they have logged in. Staff characters never appear |
| Accounts work on the site but not in the client | Run `ta.py web verify-srp6` — that is exactly what it is for |
| CSS missing after an upgrade | A stale server process. Restart the service; do not run two |
| `Access denied for user 'ash_web'@'localhost'` | A fresh MySQL keeps an anonymous `''@'localhost'` account that outranks a `'%'` user for local connections. Create the user for `'localhost'` too, or run `mysql_secure_installation` |
| `Table 'acore_auth.uptime' doesn't exist` when granting | The realm's databases have not been imported yet. MySQL cannot grant on a table that is not there — start the worldserver once, or use `web dev-db` |

---

## 11. The launcher

**`launcher/`** is a desktop application that verifies a player's own 3.3.5a
client, writes the realmlist, installs Ashmorrow's patches and starts the game —
natively on Windows, through Wine or Proton on Linux. Like the website, it is a
**separate service** with its own build and its own release cadence.

It replaces "edit `realmlist.wtf` and run `Wow.exe`" as the *recommended* route.
It never replaces it as the only one: section 8 stays correct forever, and is
what you fall back to when the launcher is broken, unavailable on your platform,
or simply not something you want to run.

**It does not download a game client, and it never will.** You supply your own
3.3.5a build 12340 client, exactly as the rest of this guide already assumes.
Why, at length: [ADR 0005](docs/decisions/0005-client-distribution.md).

Its code map is in [launcher/README.md](launcher/README.md); the stack decision
is [ADR 0006](docs/decisions/0006-launcher-architecture.md); the interface's
design is [docs/LAUNCHER-DESIGN.md](docs/LAUNCHER-DESIGN.md).

### 10.1 Without building anything

`ta.py play` does the same work from a terminal. Pure Python, no dependencies,
no Rust, both platforms — and it is the first thing to reach for when something
is wrong, because it prints every decision it makes.

```bash
# Linux
python3 tools/ta.py play doctor --client /path/to/WoW-3.3.5a
python3 tools/ta.py play verify --client /path/to/WoW-3.3.5a
python3 tools/ta.py play run    --client /path/to/WoW-3.3.5a

# Windows
python tools\ta.py play doctor --client C:\Games\WoW-3.3.5a
python tools\ta.py play run    --client C:\Games\WoW-3.3.5a
```

Save the typing by putting the path in `tools/local.json`:

```json
{ "client_path": "/path/to/WoW-3.3.5a", "realm_address": "192.168.1.50" }
```

| Action | Does |
|---|---|
| `doctor` | what is on this machine: client, build number, locales, Wine/Proton, realm address |
| `verify` | checks the client is build 12340 and, if `ashmorrow-manifest` is built, compares file hashes |
| `config` | writes `realmlist.wtf` into every locale directory, and optionally pre-fills the account name |
| `provision` | creates the Wine prefix and installs DXVK into it. Linux only; safe to re-run |
| `run` | `config`, then starts the game. `--dry-run` prints the command and touches nothing |

Your existing `realmlist.wtf` and `Config.wtf` are copied to
`*.ashmorrow-original` the first time — once, before we have ever written, so
the backup always holds what *you* had.

### 10.2 Building the desktop launcher

Two commands from `launcher/`, once the prerequisites are there:

```bash
cd launcher
npm install      # brings the Tauri CLI and ui/'s dependencies; nothing global
npm run build
```

**A platform builds only for itself.** Linux produces an AppImage and a `.deb`;
Windows produces an `.exe` and an `.msi`. Cross-compiling a Windows launcher
from Linux is not realistically supported, so the `.exe` needs a Windows machine
or the release workflow (section 10.6).

**Windows prerequisites:** Rust ([rustup.rs](https://rustup.rs)), Node 20+, and
the **MSVC build tools** — Visual Studio's "Desktop development with C++"
workload, which section 2.1 already installs for the server. WebView2 ships with
Windows 10 21H2 and later. Without the build tools the first `cargo` step fails
with `link.exe not found`; `rustup` does not install a linker for you.

**Linux prerequisites:**

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl libssl-dev \
                 libayatana-appindicator3-dev librsvg2-dev file patchelf
```

`file` and `patchelf` are only needed to package the AppImage, and their absence
fails late in an otherwise successful build — install them up front.

**What you get**, under `launcher/src-tauri/target/release/`:

| Platform | File |
|---|---|
| Windows | `bundle\nsis\Ashmorrow_0.1.0_x64-setup.exe` — the installer to hand a player |
| Windows | `bundle\msi\Ashmorrow_0.1.0_x64_en-US.msi` — for policy deployment |
| Linux | `bundle/appimage/Ashmorrow_0.1.0_amd64.AppImage` — runs anywhere |
| Linux | `bundle/deb/Ashmorrow_0.1.0_amd64.deb` |

First build takes 5–15 minutes; it compiles Tauri's dependency tree once.

Run it while working on it, pointed at a local website:

```bash
ASHMORROW_BASE_URL=http://127.0.0.1:3000 npm run dev
```

**When it fails, run `npx tauri info` from `launcher/`** — it prints every
prerequisite with a tick or a cross beside it, and is the first thing to paste
into a bug report.

| Symptom | Cause |
|---|---|
| `webkit2gtk-4.1: not installed` from `tauri info` | the Linux list above |
| `try setting PKG_CONFIG_PATH to the directory containing gdk-3.0.pc` | the same thing, as the compiler phrases it |
| `link.exe not found` (Windows) | MSVC build tools missing, not Rust |
| `failed to bundle project` after a clean compile | `patchelf` or `file` missing. The Rust built fine |
| `beforeBuildCommand ... failed` | the interface did not build — run `npm run build` in `launcher/ui` alone to see why |

### 10.3 Working on it without a webview

The interface answers from a demo adapter when Tauri is absent, so it opens in
an ordinary browser — no Rust, no client, no realm:

```bash
cd launcher/ui && npm run dev     # http://localhost:5173
```

And the half that matters is testable anywhere:

```bash
cargo test   --manifest-path launcher/core/Cargo.toml
cargo clippy --manifest-path launcher/core/Cargo.toml --all-targets -- -D warnings
cd launcher/ui && npm run typecheck
```

### 10.4 The hash manifest

`launcher/manifests/ashmorrow.json` ships with an **empty** file list. Hashes
have to be measured against a real client, and nobody has done that yet — until
they do, the launcher checks structure and build number and says so plainly
rather than implying it verified anything.

From a machine that has a client:

```bash
cargo run --manifest-path launcher/core/Cargo.toml \
      --bin ashmorrow-manifest -- hash /path/to/WoW-3.3.5a > client.json
```

Paste `build`, `version`, `locales` and `files` into `ashmorrow.json`, and put
where the copy came from in `measured_from`. The output is paths, sizes and
hashes — facts, safe to commit. No client bytes leave the machine that runs it.

To check a client against a manifest without the GUI:

```bash
cargo run --manifest-path launcher/core/Cargo.toml \
      --bin ashmorrow-manifest -- check /path/to/WoW-3.3.5a launcher/manifests/ashmorrow.json
```

### 10.5 Linux: Wine and Proton

**Install Wine yourself. The launcher does everything after that.**

```bash
sudo apt install wine64        # Debian/Ubuntu
sudo dnf install wine          # Fedora
sudo pacman -S wine            # Arch
```

Proton works too, and is found automatically in every Steam library listed in
`steamapps/libraryfolders.vdf`, including a Flatpak Steam.

Then, either in the launcher (the button says `SET UP RUNTIME`) or from a
terminal:

```bash
python3 tools/ta.py play provision
```

That creates a Wine prefix, downloads DXVK, verifies it, unpacks the 32-bit
`d3d9.dll` into the right system directory for your prefix's architecture, and
tells Wine to prefer it. Roughly ninety seconds and a 10 MB download, and it is
the difference between "Wine is installed" and "the game runs".

It is safe to re-run — `wineboot -u` and the component check are both
idempotent — so it is also the repair path when a prefix goes wrong.

Wine itself is deliberately **not** installed for you: system packages belong
to your package manager, not to a game launcher.

The prefix is the launcher's own, at `~/.local/share/ashmorrow/prefix`. It
never touches `~/.wine` or any prefix belonging to another game.

| Symptom | Try |
|---|---|
| Black screen or nothing draws | run `play provision` — this is almost always a missing or misplaced DXVK. Failing that, switch the renderer to OpenGL in Settings |
| Nothing found | install Wine from your distribution, or Proton through Steam. Everything after that, `play provision` does |
| Proton fails immediately | it needs Steam installed, not just the Proton folder — the launcher reports which of the two is missing |
| Fonts are boxes | `winetricks corefonts` in the launcher's prefix |

### 10.6 Getting a build, and cutting a release

**Every push builds both platforms**, so a testable `.exe` exists without anyone
owning a Windows machine. Actions tab → your commit's run → *Artifacts*:
`launcher-Windows-<sha>` holds the installer, the `.msi`, the bare
`ashmorrow-launcher.exe` and `ashmorrow-manifest.exe`. For testing a change the
bare executable is the one to take — it installs nothing and leaves nothing
behind.

`ashmorrow-manifest.exe` is the command-line tool, shipped alongside because
everything it does needs a real client on the same machine:

```
ashmorrow-manifest.exe inspect-dbc "C:\path\to\World of Warcraft"
ashmorrow-manifest.exe hash        "C:\path\to\World of Warcraft"
ashmorrow-manifest.exe check       "C:\path\to\World of Warcraft" manifest.json
```

To publish, tag it:

```bash
git tag launcher-v0.1.0
git push origin launcher-v0.1.0
```

`.github/workflows/release.yml` runs `windows-latest` and `ubuntu-22.04` in
parallel, tests the launcher core, builds each platform's bundles, writes
`SHA256SUMS.txt` and opens a **draft** release with everything attached. Draft,
so you look before anyone downloads.

To check a build without tagging, run the workflow by hand from the Actions tab:
it builds and leaves the installers as workflow artifacts, publishing nothing.

The binaries are unsigned by choice ([ADR 0005](docs/decisions/0005-client-distribution.md) §6),
which is why the sums are published alongside them.

> **What the workflow proves, and what it does not.** Both platforms build and
> bundle: Windows produces the installer, the `.msi` and the bare `.exe`, Linux
> the AppImage, the `.deb` and the bare binary. The Linux leg then *starts* the
> binary it just built and drives it to a launch
> (`launcher/test/smoke-linux.sh`), so a build that comes up broken fails there
> rather than on your machine. There is no Windows equivalent, so whether the
> `.exe` runs is still something only a person with Windows can tell you.

### 10.7 Launcher troubleshooting

| Symptom | Cause / fix |
|---|---|
| "this client reports 2.4.3.8606" | it is a TBC client. Ashmorrow needs 3.3.5a build 12340, and nothing here can convert one into the other |
| "no version resource in Wow.exe" | a repack that stripped it. The launcher proceeds and warns; verify by hand |
| "no locale directory under Data" | the client is incomplete — `Data/enUS` or the equivalent must exist |
| Files "differ from the build we measured" | your copy is not the one we hashed. Usually harmless; the Ledger tab names every file |
| The launcher cannot reach the realm | it reads `/api/launcher/manifest` from the website. If the site is down, use `ta.py play` |
| SmartScreen or antivirus warning | the binaries are unsigned by choice — ADR 0005 §6. Check the published SHA-256 sums |
| Login works on the site, not in the launcher | account names and passwords are capped at 16 characters; the client silently truncates longer ones |

---

## 12. The admin panel

**`web-admin/`** is the operator surface: accounts, characters, ability trees,
itemization, realm configuration, and a record of everything anyone did. Like
the website and the launcher it is a **separate service** — and here the
separation is not just deployment convenience, it is the security boundary. It
runs as its own MySQL user with privileges the website must never have.

Read [ADR 0008](docs/decisions/0008-admin-panel.md) before changing anything
about how access is decided; [web-admin/README.md](web-admin/README.md) is the
code map.

### 12.1 What you need

Node.js 20+, npm, and a realm database. Nothing from the C++ toolchain. It does
**not** need the worldserver running — but a few actions do, and it says so
rather than pretending otherwise (see 12.5).

There is no demo mode. Without a database the panel refuses to start.

### 12.2 A development instance

```bash
python3 tools/ta.py admin dev-db --yes    # database, schema, grants, fixture, .env.local
python3 tools/ta.py admin build
python3 tools/ta.py admin start           # http://127.0.0.1:3010
```

`admin dev-db` layers on top of `web dev-db` rather than repeating it, and adds
one staff account per tier so the permission model can be exercised rather than
reasoned about:

| Account | Password | Tier |
|---|---|---|
| `ASHOWNER` | `ownerpass` | owner — staff levels, promoting item changes |
| `ASHSTAFF` | (the website fixture's) | administrator — realm and trees |
| `ASHGM` | `gmpass` | game master — bans, character edits |
| `ASHSUPPORT` | `supportpass` | support — read only |
| `ASHCULPRIT` | `culpritpass` | a level-0 player to act on |

Development passwords, obviously. `admin dev-db` refuses to run without `--yes`
and prints what it is about to write to first.

Every account is asked to enrol an authenticator on first sign-in. There is no
way to skip it.

### 12.3 Production

```bash
mysql -u root -p < web-admin/sql/admin-schema.sql
$EDITOR web-admin/sql/admin-grants.sql          # replace CHANGE_ME with a password
mysql -u root -p < web-admin/sql/admin-grants.sql

cd web-admin
npm ci
npm run gen-secret                              # prints the two keys
cp .env.example .env.local && $EDITOR .env.local
npm run build
npm start                                       # 127.0.0.1:3010
```

Or, from the repository root, `python3 tools/ta.py admin setup`.

Windows is the same, with `.\install.ps1`-style paths:

```powershell
mysql -u root -p < web-admin\sql\admin-schema.sql
notepad web-admin\sql\admin-grants.sql
mysql -u root -p < web-admin\sql\admin-grants.sql

cd web-admin
npm ci
npm run gen-secret
copy .env.example .env.local
notepad .env.local
npm run build
npm start
```

Serve it behind a reverse proxy that terminates TLS, and then tell the panel
that it is public:

```
ADMIN_PUBLIC=1
ADMIN_SITE_URL=https://admin.example.com
ADMIN_IP_ALLOWLIST=203.0.113.7,198.51.100.0/24
ADMIN_TRUSTED_PROXY_HOPS=1
```

With `ADMIN_PUBLIC=1` the panel **refuses to start** unless the allowlist is
non-empty, a trusted proxy is configured, and the site URL is https. That is
deliberate. Those three are the controls; starting without them and logging a
warning is how an open admin panel ends up on the internet for a week.

`ADMIN_TRUSTED_PROXY_HOPS` is the number of proxies **you** operate.
`X-Forwarded-For` is written by the client, so hops are counted from the right
and only that many are peeled off. Get it too high and a client can claim any
address it likes.

### 12.4 The two keys are not interchangeable

| Key | Rotating it |
|---|---|
| `ADMIN_SESSION_SECRET` | signs every staff member out. Safe, occasionally useful. |
| `ADMIN_TOTP_KEY` | makes every enrolled authenticator unreadable. **Back it up.** |

They are separate for exactly that reason. `npm run gen-secret` prints both.

### 12.5 What needs the worldserver, and what does not

Everything that changes a database row works without it: bans, unbans, mutes,
password resets, staff levels, offline character edits, tree edits, itemization,
MOTD, maintenance mode.

These need SOAP, and are refused with a reason when it is not configured: kicks,
revives, teleports, pushing a MOTD to the running server, and reloading the
trees. Enable it in `worldserver.conf`:

```
SOAP.Enabled = 1
SOAP.IP      = "127.0.0.1"
SOAP.Port    = 7878
```

then in `web-admin/.env.local`:

```
SOAP_ENABLED=1
SOAP_USER=<a GM account>
SOAP_PASSWORD=<its password>
```

**Never expose 7878.** Bind it to localhost and give the account the lowest GM
level that covers the commands the panel actually sends — the panel's own tiers
do not constrain the worldserver.

### 12.6 The one thing that is deliberately missing

There is no budget editor. `Classless.Points.PerLevel` and friends live in
`mod_classless.conf` on the worldserver, which the panel cannot read; mirroring
them into the panel's environment would create a second source of truth that
silently disagrees with the first. Character pages show points **spent** and say
plainly that the total available is unknown until the module publishes those
values to a `classless_config` table. ADR 0008 carries the request.

Two others, for the same reason — the panel would be lying:

- **Population cap.** `PlayerLimit` is a config file value with no database
  representation. Use maintenance mode, which does take effect immediately.
- **Anything needing a running server, without one.** See 12.5.

### 12.7 Admin panel troubleshooting

| Symptom | Cause / fix |
|---|---|
| Refuses to start, "misconfigured and will refuse every request" | it lists what is missing. `ADMIN_PUBLIC=1` requires an allowlist, a trusted proxy and https |
| Every request bounces to the sign-in page | the allowlist. Check `ADMIN_TRUSTED_PROXY_HOPS` matches how many proxies you actually run — with it at 0 behind a proxy, no address is trusted and everything is refused |
| Correct password, "those credentials are not valid" | the account has no `account_access` row for this realm, or its `gmlevel` is 0. The message is deliberately vague; the audit log says which |
| "That code is not right" for a code that is right | clock drift on the authenticator's device, or the code was already used — a code lives once, not for its whole window |
| Locked out: lost device, no recovery codes left | an owner clears the enrolment. There is no self-service path, by design |
| Every administrator locked out at once | `ADMIN_TOTP_KEY` changed. Restore it from your backup — the sealed secrets cannot be read without it |
| Signed out mid-session | your GM level changed, your password changed, the idle window passed, or your network address changed. The sign-in page says which |
| Kick / revive / teleport unavailable | SOAP is not configured — 12.5 |
| Tree edits do not take effect in game | the module caches trees at load. Use "Reload trees on the server", which needs SOAP; otherwise they apply at the next restart |
| A character edit is refused | they are online. The worldserver owns their row and would overwrite the change |
| `admin doctor` says the audit log is not append-only | `ash_admin` has `UPDATE` on `admin_audit` and must not. Re-run `ta.py admin sql --grants` |
| The **website** starts logging `Access denied for user 'ash_web'@'localhost'` after setting the panel up | An early version of `admin dev-db` re-ran `web dev-db`, which rotates the website's database password when `web_db_pass` is not recorded in `tools/local.json`. Fixed — it no longer touches the site's user at all. On a machine that already hit it: `python3 tools/ta.py web dev-db --yes`, then restart the website. `ta.py web doctor` now reports this rather than passing. |

---

## 13. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `no C++ compiler` from `doctor` | Linux: `apt install build-essential`. Windows: VS 2022 with the C++ workload |
| CMake can't find Boost | `Boost_ROOT` not set, or PowerShell not reopened after setting it |
| `Could NOT find Boost: Found unsuitable version "1.66.0", but required is at least "1.78"` | an older Boost is installed and being found. Install 1.8x and point `Boost_ROOT` at **that** folder |
| `Could NOT find Boost: Found unsuitable version "0.0.0" ... (found C:/local/boost_1_66_0, )` | a stale `build/CMakeCache.txt` from an earlier failed configure — it still points at a Boost you removed, so no version can be read out of it. Re-run `ta.py configure` (it clears a cache with dead paths), or force it with `python tools\ta.py configure --clean` |
| `Policy CMP0167 is not set: The FindBoost module is removed` | harmless warning from CMake 4.x; the build is unaffected |
| `install.sh` says Python 3.8+ not found | install Python; the script prints the command for your platform |
| `install.ps1` won't run | execution policy: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| `install.ps1` : `NativeCommandError` naming Python | interpreter detection tripped over your Python. Point at it directly: `.\install.ps1 -PythonPath 'C:\Path\To\python.exe'` |
| "not a usable Python 3.8+" for a Python you know is fine | the message now prints what `--version` returned — send that. Detection needs `Python X.Y` in that output |
| "Python 3.8+ is required and was not found" but it is installed | `python` may be the Microsoft Store stub. Use `-PythonPath`, or reinstall from python.org ticking *Add python.exe to PATH* |
| Installer stopped partway | just run it again — it skips whatever already succeeded |
| `extract` rejects your client path | it wants the folder holding `Wow.exe` and `Data/`, not `Data/` itself |
| Server starts, database stays empty | no `mysql` client found — see section 0 |
| Installer stops at step 5 saying `mysql` is missing | expected: it's needed to import SQL, not to build. Install MySQL Server and re-run; everything already done is skipped |
| `mysql` installed on Windows but "not found" | it lives in `C:\Program Files\MySQL\MySQL Server 8.x\bin` and isn't on PATH. The installer now looks there itself — if yours is elsewhere, add that `bin` folder to PATH |
| `Could not find DBC file` / instant exit | client data missing — section 6 |
| Client: "unable to connect" | authserver not running, or `realmlist.wtf` wrong |
| Client: logs in, realm offline/greyed | `realmlist.address` in the DB is `127.0.0.1` but the client is on another machine — section 8 step 3 |
| Module edits don't take effect | `ta.py` fell back to copy mode — run `ta.py sync` |
| Out of disk during build | full build needs ~15 GB. `ta.py configure --tools none` skips the extractors if you already have client data |
| `db up` fails, "429 Too Many Requests" | Docker Hub rate limit. `docker login`, or use native MySQL (section 2) |
| `db status` says "container: not created" | expected and harmless when you run MySQL natively |

Website problems have their own table in [section 9.8](#98-website-troubleshooting), the launcher's are in
[section 10.6](#106-launcher-troubleshooting), and the admin panel's are in
[section 12.7](#127-admin-panel-troubleshooting).

Still stuck? `python3 tools/ta.py doctor` output is the fastest thing to share —
or `python3 tools/ta.py web doctor` for the website, `python3 tools/ta.py admin doctor`
for the panel.
