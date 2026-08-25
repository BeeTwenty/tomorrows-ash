# ADR 0001 — Base core: AzerothCore (WotLK 3.3.5a)

**Date:** 2026-08-25
**Status:** Accepted, but **needs product-owner confirmation** — see "What this costs you"

## Context

The brief asked to "fork/clone AzerothCore's Classic fork". I checked, and that
project is not what the name suggests.

**`azerothcore/azerothcore-classic` exists but is dead.** Findings:

- Last commit **7 April 2017** — nine years stale.
- Its README is still MaNGOS Zero's, linking to `getmangos.eu` and Travis CI.
  It is an unmodified MaNGOS Zero snapshot parked in the AzerothCore org; it
  never became AzerothCore.
- **No `modules/` directory** — it has none of AzerothCore's module system.
- GitHub's search API does not even index it any more.

**`azerothcore/classic-mode` is not a core.** It is two SQL files
(`classic-mode.up.sql` / `.down.sql`) that restrict players to vanilla zones on
a normal AzerothCore server. Last pushed 2020.

So there is no maintained "AzerothCore Classic". The real options:

| Option | Era / client | Module system | Upstream activity |
|---|---|---|---|
| **azerothcore-wotlk** | 3.3.5a WotLK | **yes**, mature | commits daily |
| azerothcore-classic | 1.12 vanilla | none | dead since 2017 |
| VMaNGOS | 1.12 vanilla | none | active |
| CMaNGOS-Classic | 1.12 vanilla | none | active |

## Decision

**Build on `azerothcore-wotlk`**, pinned at `e2f5e48b4375` (2026-08-25).

The mandate set two constraints that decide this by themselves:

1. *"Build the classless system as an isolated module if AzerothCore's module
   system supports it."* Only `azerothcore-wotlk` has a module system at all.
2. *"Prefer data/SQL over core C++ forks, to keep this maintainable against
   upstream."* On VMaNGOS or CMaNGOS every change is a core fork — there is no
   module layer — so the maintainability goal is unreachable there by
   construction.

The Phase 0 investigation then confirmed the choice pays off concretely: on
AzerothCore the classless system needs **zero core modifications**
(`docs/CLASS-RESTRICTIONS.md`). On a vanilla core it would be a permanent fork
from commit one.

## What this costs you — please confirm

Players connect with the **3.3.5a (WotLK) client**, not the 1.12 vanilla
client. Concretely that means WotLK talent trees and spell ranks exist as
source material, WotLK-era UI, and the WotLK world including Outland and
Northrend.

If you want the *vanilla content experience* on this core, that is a solved
problem and stays compatible with everything above:
- `azerothcore/classic-mode` SQL restricts players to the classic world, or
- `mod-individual-progression`, which gates content by expansion per character.

If you specifically want the **1.12 vanilla client** — the actual Classic
look and feel — that is a different decision with real consequences: we would
move to VMaNGOS or CMaNGOS, lose the module system, and every line of the
classless system becomes a permanent core fork. I would be building against
the mandate's own maintainability requirement, so I have not done it
unilaterally.

**This is the one question where I need your answer before Phase 2.** Phase 1
work is unaffected either way — the enforcement mechanisms are broadly similar
across cores, so the research and the data model carry over.

## Consequences

- Pinned upstream in `upstream.json`; bumping is a one-line change.
- AGPL-3.0 (AzerothCore's licence) applies to derived work. As a public server
  we must be able to publish our source. The overlay layout makes that easy —
  our code is already separate.
- `azerothcore.org` is blocked by this sandbox's egress proxy, so setup docs
  are written from the source tree itself rather than copied from the wiki.
