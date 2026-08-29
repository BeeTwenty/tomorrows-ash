---
title: Questions
summary: Client version, progression, hardware, wipes, and whether your existing character survives.
order: 5
---

## Do I need a modified client or an addon?

No. An unmodified 3.3.5a client, build 12340, is all it takes. The design was constrained by that
from the beginning: the moment a realm requires a client patch, it has asked every prospective
player for a leap of faith before they have seen anything.

## Why Wrath of the Lich King and not vanilla?

Because the server core we build on supports 3.3.5a properly, is actively maintained, and has a
module system that lets us add the classless system without forking it. The nearest vanilla-era
alternatives have no module system, which would mean a permanent fork and no upstream fixes.

If enough people want a vanilla-content experience on this client, gating content by expansion is a
solved problem and we can revisit it.

## Will my character be wiped?

Not as a matter of routine. But this realm is under construction, and the phase that introduces skill
points has to migrate every existing character's talents into the new system. If that migration goes
wrong for a character, we will say so plainly in the [patch notes](/patch-notes) rather than quietly
resetting things.

Treat an early character as an early character.

## Can I still play a normal warrior?

Yes, and nothing stops you. Spend your entire budget on the abilities a warrior would have had and
you have built a warrior — one that chose to be a warrior rather than one that was told to be.

## Is there a level cap change, XP rate change, custom content?

Not currently. Level 80 cap, standard rates, standard content. The classless system is a large
enough change on its own; stacking custom rates on top would make it impossible to tell which change
caused which problem.

## What happens to talents?

They are replaced. The built-in talent frame is drawn by the client from its own local files and is
locked to whatever class it thinks you are, so it cannot show a Fire tree to a warrior no matter what
the server says. Rather than ship a client patch to fix that, we retire the frame and spend points
through an NPC instead.

Plainer, yes. But it works for everybody on day one.

## Is the source public?

All of it. [BeeTwenty/tomorrows-ash](https://github.com/BeeTwenty/tomorrows-ash) — the server module,
this website, the setup tooling and the design documents. The server core we build on is GPL-2.0-or-later,
and work derived from it inherits that, so publishing is an obligation as well as a preference.

## How do I report a bug?

Open an issue on the repository. Include what you did, what happened, and what you expected. If it
concerns a specific character, its name helps.

## Who runs this?

A very small operation — realistically, one person and a lot of documentation. That is worth knowing
before you decide how much of your evening to invest in it.
