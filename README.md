# Tomorrow's Ash

A **classless** World of Warcraft private server. First realm: **Ashmorrow**.

Instead of class-locked spells and talents, every character draws from a shared
pool of ability trees — Fire, Frost, Holy, Sword Mastery, Stealth and so on —
balanced by a skill-point budget rather than a fixed class kit.

Built on [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk)
(WotLK 3.3.5a).

---

## Getting started

**[SETUP.md](SETUP.md)** — full build and run instructions for Windows and Linux.

```bash
git clone https://github.com/BeeTwenty/tomorrows-ash.git
cd tomorrows-ash

./install.sh          # Linux / macOS
.\install.ps1         # Windows (PowerShell)
```

One command: dependencies, AzerothCore at the pinned commit, build, databases
and configs. Re-runnable — it skips whatever already succeeded. Point it at your
own WoW 3.3.5a client and it extracts the map data too:

```bash
./install.sh --client ~/Games/WoW-3.3.5a
```

The **website** is a separate service and needs none of the above — it runs on
its own with sample data, or against a realm you already have:

```bash
cd web && npm install && npm run dev    # http://localhost:3000
```

---

## How this repository is laid out

This repo does **not** contain a fork of AzerothCore. It holds only our own
work, plus an exact upstream commit pin. `ta.py bootstrap` fetches the core into
a gitignored `.acore/` and links our module into it.

```
upstream.json            pinned AzerothCore commit — the entire upstream contract
tools/ta.py              build / database / run / web CLI (Windows + Linux)
modules/mod-classless/   the classless system, as an AzerothCore module
realm/ashmorrow/         realm-specific data
web/                     the public website — deploys separately from the realm
launcher/                the desktop launcher — deploys separately from both
docs/                    research, decisions, roadmap
docs/reference/          SRP6 implementations and DB examples for other tools
.acore/                  fetched core — gitignored, never committed
```

Everything this project has changed relative to stock AzerothCore is visible in
this repository. There is no hidden divergence. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Documentation

| Document | What it covers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | orientation for AI sessions: invariants, traps, verified facts |
| [SETUP.md](SETUP.md) | build & run, Windows + Linux, client connection |
| [docs/CLASS-RESTRICTIONS.md](docs/CLASS-RESTRICTIONS.md) | how AzerothCore actually enforces class rules — the research this design rests on |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | repo model, module design, the unsolved balance problem |
| [docs/PHASE1-FINDINGS.md](docs/PHASE1-FINDINGS.md) | what granting an off-class ability actually does, and what still needs testing |
| [docs/PHASE2-BUDGET.md](docs/PHASE2-BUDGET.md) | the skill-point budget: how it works, and why it doesn't constrain anything yet |
| [docs/BODY-TYPES.md](docs/BODY-TYPES.md) | proposed body-type stat deltas, awaiting sign-off |
| [docs/WEBSITE-DB.md](docs/WEBSITE-DB.md) | connecting a website: DB access, schema, SRP6 account creation |
| [docs/LAUNCHER-DESIGN.md](docs/LAUNCHER-DESIGN.md) | the launcher's visual identity — proposed, awaiting sign-off |
| [docs/ROADMAP.md](docs/ROADMAP.md) | phases, status, open questions |
| [web/README.md](web/README.md) | the public website: stack, layout, how to run it |
| [launcher/README.md](launcher/README.md) | the launcher: what it does, what it refuses to do, how to build it |
| [docs/LAUNCHER-DESIGN.md](docs/LAUNCHER-DESIGN.md) | the launcher's visual identity |
| [docs/decisions/](docs/decisions/) | why the notable choices were made |

---

## Status

**Phase 2 built** — 10 ability trees and 50 abilities, drawn from every class
and open to any character, served through a gossip NPC and priced against a
per-level skill-point budget with working respec. The pool costs 200 points; a
level 80 character has 71, so scarcity is real. **Zero core modifications**
throughout. Still gated behind `Classless.Enable = 0`; the in-game play test
needs client data.

The **public website** is live alongside it, and its armory reads those same
tables: where a normal armory prints a class, this one derives a title from
how a character has actually spent its points.

The headline research finding: **`Player::learnSpell()` has no class check**.
Class identity is enforced at *acquisition paths* (trainers, the talent frame,
character creation), not at spell ownership. So the classless system can be
built as a module plus SQL with **zero core modifications** — which is what
makes staying current with upstream realistic.

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.

---

## Licence

**[GPL-2.0-or-later](LICENSE)**, matching AzerothCore, which is GPL-2.0-or-later
at our pinned commit. The reasoning — what actually derives from the core, what
does not, and why the launcher binary ships as GPL-3.0-or-later — is in
[ADR 0007](docs/decisions/0007-licence.md).

Publishing our source is a **choice**, not an obligation: under GPL-2, running a
server and serving a website are not distribution and owe nobody anything. We
publish because the project is built in the open. The overlay layout keeps our
code cleanly separable and already public.

World of Warcraft is a trademark of Blizzard Entertainment. This project ships
no Blizzard content: you supply your own 3.3.5a client, and client data is
gitignored. That holds for the launcher too — it verifies a client you already
have and downloads none of it, for the reasons set out in
[ADR 0005](docs/decisions/0005-client-distribution.md).
