# ADR 0003 — Do not build on Blizzard's talent frame

**Date:** 2026-08-25
**Status:** Accepted

## Context

The obvious way to build "learn from any tree" is to unlock Blizzard's talent
trees across classes. Two findings rule it out.

**Server side.** `Player::LearnTalent()` hard-returns when the talent's
`TalentTab.dbc` `ClassMask` doesn't match the character
(`Player.cpp:14290`). The `OnPlayerCanLearnTalent` hook fires *before* that
check and, per `ScriptMgrMacros.h:76`, can only veto — never grant. So this
needs a core patch.

**Client side — the real blocker.** The 3.3.5a client draws the talent window
from its own local DBCs, keyed to the character's class. A Warrior client will
not render a Frost tree however the server is patched. Fixing that means
shipping a custom client MPQ that **every player must install**.

## Decision

Build our own ability-acquisition surface. Do not touch the talent frame.
Retire it instead: `OnPlayerCalculateTalentsPoints` sets the Blizzard talent
budget to zero — a hook, so no core patch
(`Classless.SuppressBlizzardTalents`).

Delivery surfaces, in order of adoption cost:

1. **NPC gossip menus + chat commands** — server-authoritative, works on an
   unmodified client. Phases 1–3.
2. **Custom addon panel (AIO)** — nicer, but players must install an addon.
3. **Custom talent trees via client patch** — best UX, highest adoption tax.

## Rationale

"Eventually a public community server" is the deciding phrase in the brief. A
required client patch is a serious barrier to a public server: it blocks casual
players, complicates updates, and invites support load. Gossip menus are plain,
but they work for everyone on day one.

Starting at (1) keeps (2) and (3) available later — the module's data model is
UI-agnostic, so a prettier front end is additive, not a rewrite.

## Consequences

- The Phase 1 prototype is driven through a gossip NPC, not a talent window.
- Blizzard talents and the classless system must not both be live: enabling
  `SuppressBlizzardTalents` before the replacement exists would leave players
  with no way to spend points at all. The config default is `0` and the
  comment in `mod_classless.conf.dist` says so.
- Existing characters with spent talent points need a migration (refund +
  `.reset talents`) at the switchover.
