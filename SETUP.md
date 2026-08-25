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
| MySQL **client** | comes with MySQL Server | `mysql-client` ← **needed even with Docker** |

**Also required, separately:** a **World of Warcraft 3.3.5a (build 12340)**
client. Not distributed here, not downloadable from this repo. You need your own
copy. Section 5 explains what to do with it.

> **Why the MySQL *client* matters even when the database runs in Docker:**
> AzerothCore's built-in SQL updater shells out to the `mysql` binary to import
> `.sql` files. Without it the server starts fine and silently applies no
> database updates. `ta.py doctor` checks for it.

---

## 1. Linux — quick path

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

Then go to **section 5** (client data) — the server will not start without it.

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

## 2. Windows — quick path

Use **PowerShell**. Run `git` commands from PowerShell or Git Bash.

### 2.1 Install prerequisites

1. **Visual Studio 2022** (Community is fine). In the installer tick
   **Desktop development with C++**.
2. **CMake** — during install choose *Add CMake to the system PATH*.
3. **Git for Windows**, **Python 3** (tick *Add python.exe to PATH*).
4. **Boost** — download the prebuilt `boost_1_8x_0-msvc-14.3-64.exe` from
   [Boost binaries](https://sourceforge.net/projects/boost/files/boost-binaries/)
   and install to e.g. `C:\local\boost_1_86_0`. Then set a system environment
   variable:
   ```
   BOOST_ROOT = C:\local\boost_1_86_0
   ```
   (Windows Search → "Edit the system environment variables" → Environment
   Variables → New, under *System variables*. **Reopen PowerShell afterwards.**)
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

## 3. What `ta.py` does

| Command | Purpose |
|---|---|
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

Per-machine settings go in **`tools/local.json`** (gitignored) or `TA_*`
environment variables. Never commit credentials.

---

## 4. Databases

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

---

## 5. Client data (required — the server won't start without it)

The server needs map, vmap, mmap and DBC data **extracted from your own WoW
3.3.5a client**. This is the slowest one-time step.

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

## 6. First run

Two processes. Two terminals.

```bash
# terminal 1 - authserver (login)
python3 tools/ta.py run auth

# terminal 2 - worldserver (game)
python3 tools/ta.py run world
```

First `run world` performs the big SQL import described in section 4. Wait for:

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

## 7. Connecting a client

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

Ports: **3724** (authserver) and **8085** (worldserver). Open both on the
homelab box's firewall for LAN play.

---

## 8. The classless module

`modules/mod-classless` is built into the server automatically. Its config is
installed to `dist/etc/mod_classless.conf`.

As of **Phase 0 it is inert**: `Classless.Enable = 0` and every hook returns
early, so the realm behaves as stock AzerothCore. Turning it on now changes
nothing visible yet — the ability system arrives in Phase 1.

```ini
Classless.Enable = 0                      # master switch
Classless.Announce = 1                    # login notice
Classless.SuppressBlizzardTalents = 0     # Phase 2 - do not enable yet
```

**Do not set `SuppressBlizzardTalents = 1` before the replacement system
exists**, or characters will have no way to spend points at all.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `no C++ compiler` from `doctor` | Linux: `apt install build-essential`. Windows: VS 2022 with the C++ workload |
| CMake can't find Boost | `BOOST_ROOT` not set, or PowerShell not reopened after setting it |
| Server starts, database stays empty | no `mysql` client on PATH — see section 0 |
| `Could not find DBC file` / instant exit | client data missing — section 5 |
| Client: "unable to connect" | authserver not running, or `realmlist.wtf` wrong |
| Client: logs in, realm offline/greyed | `realmlist.address` in the DB is `127.0.0.1` but the client is on another machine — section 7 step 3 |
| Module edits don't take effect | `ta.py` fell back to copy mode — run `ta.py sync` |
| Out of disk during build | full build needs ~15 GB. `ta.py configure --tools none` skips the extractors if you already have client data |

Still stuck? `python3 tools/ta.py doctor` output is the fastest thing to share.
