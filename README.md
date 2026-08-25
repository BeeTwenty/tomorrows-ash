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
python3 tools/ta.py doctor      # what's missing on this machine?
python3 tools/ta.py bootstrap   # fetch AzerothCore at the pinned commit
python3 tools/ta.py configure && python3 tools/ta.py build
```

---

## How this repository is laid out

This repo does **not** contain a fork of AzerothCore. It holds only our own
work, plus an exact upstream commit pin. `ta.py bootstrap` fetches the core into
a gitignored `.acore/` and links our module into it.

```
upstream.json            pinned AzerothCore commit — the entire upstream contract
tools/ta.py              build / database / run CLI (Windows + Linux)
modules/mod-classless/   the classless system, as an AzerothCore module
realm/ashmorrow/         realm-specific data
docs/                    research, decisions, roadmap
.acore/                  fetched core — gitignored, never committed
```

Everything this project has changed relative to stock AzerothCore is visible in
this repository. There is no hidden divergence. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Documentation

| Document | What it covers |
|---|---|
| [SETUP.md](SETUP.md) | build & run, Windows + Linux, client connection |
| [docs/CLASS-RESTRICTIONS.md](docs/CLASS-RESTRICTIONS.md) | how AzerothCore actually enforces class rules — the research this design rests on |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | repo model, module design, the unsolved balance problem |
| [docs/ROADMAP.md](docs/ROADMAP.md) | phases, status, open questions |
| [docs/decisions/](docs/decisions/) | why the notable choices were made |

---

## Status

**Phase 0 complete** — core selected, repo scaffolded, server builds, class
restrictions mapped. The classless module exists but is **inert**
(`Classless.Enable = 0`); the realm currently behaves as stock AzerothCore.

The headline research finding: **`Player::learnSpell()` has no class check**.
Class identity is enforced at *acquisition paths* (trainers, the talent frame,
character creation), not at spell ownership. So the classless system can be
built as a module plus SQL with **zero core modifications** — which is what
makes staying current with upstream realistic.

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.

---

## Licence

AzerothCore is **AGPL-3.0**, and work derived from it inherits that. As a
public-facing server we must be able to publish our source — the overlay layout
keeps our code cleanly separable and already public.

World of Warcraft is a trademark of Blizzard Entertainment. This project ships
no Blizzard content: you supply your own 3.3.5a client, and client data is
gitignored.
