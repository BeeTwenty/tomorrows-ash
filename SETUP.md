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
| `web setup` | install, configure and build the website (section 9) |
| `web sql` | create the website's own schema (and its MySQL user, with `--grants`) |
| `web start` / `web dev` | run the website |
| `web doctor` | check the website's prerequisites |
| `web verify-srp6` | prove the website's password handling matches the realm's |

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
```

**Do not set `SuppressBlizzardTalents = 1` before the replacement system
exists**, or characters will have no way to spend points at all.

---

## 9. The website

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

## 10. Troubleshooting

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
| `db up` fails, "429 Too Many Requests" | Docker Hub rate limit. `docker login`, or use native MySQL (section 1) |
| `db status` says "container: not created" | expected and harmless when you run MySQL natively |

Website problems have their own table in [section 9.8](#98-website-troubleshooting).

Still stuck? `python3 tools/ta.py doctor` output is the fastest thing to share —
or `python3 tools/ta.py web doctor` for the website.
