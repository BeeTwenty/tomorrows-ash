---
title: What is built and what is not
summary: An honest phase-by-phase account of where the realm is, including what does not work yet.
order: 4
---

Tomorrow's Ash is built in phases, in public. This page is the player-facing version of the
project's roadmap, and it is kept accurate rather than encouraging.

## Phase 0 — Foundation · complete

The realm exists, it builds, and it runs. Ashmorrow is named and registered. Ordinary WoW works.

The important result of this phase was research rather than code: we mapped exactly how the server
enforces class restrictions, and found that **spell ownership is not class-gated at all**. The
server will happily teach a warrior Fireball; class identity is enforced at the places you *acquire*
abilities — trainers, the talent frame, character creation — not at the point of owning them.

That means the classless system needs **no modifications to the game server's source code**. It can
be built as a module plus data. Which in turn means we can keep taking upstream fixes forever
instead of slowly drifting into a fork nobody can update.

## Phase 1 — The first off-class ability · in progress

The smallest thing that proves the concept: a broker NPC that teaches a handful of deliberately
wrong abilities. A warrior who casts Fireball. A mage who swings Mortal Strike. Both surviving a
relog.

The interesting part is not making the ability appear — that is easy. It is finding out what each
ability **drags in with it**: rank chains, dependent spells, and abilities the original game
classified as talents. Every one has to be tested individually.

## Phase 2 — The skill budget · next

The real system. Points that grow with level, trees to spend them in, a broker to spend them at, and
respecs. The built-in talent frame gets retired at the same time, because two competing budgets
would be incoherent.

Blocked on the [chassis question](/docs/chassis), deliberately. There is no point balancing a budget
before deciding what it is balancing against.

## Phase 3 — Itemisation · later

Removing class restrictions breaks a lot of quiet assumptions in gear. Plate that only warriors could
wear, set bonuses that assume a class, weapons restricted to four classes out of ten. All of it has
to be rewritten — as a generated, reversible change, never by hand.

## What this means for you today

The realm runs. You can play it. What you cannot do yet is the thing the realm is named for: right
now Ashmorrow behaves as a standard server while the system that makes it different is built
underneath.

The [patch notes](/patch-notes) record each change as it lands, including the ones that did not work.
