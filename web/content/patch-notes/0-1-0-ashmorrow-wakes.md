---
title: Ashmorrow wakes
summary: The realm exists, the site is live, and the classless system is inert on purpose.
version: 0.1.0
date: 2026-08-25
tags: foundation, website
---

The first thing to say about this release is what it does not do: it does not make the realm
classless. Not yet.

What it does is establish that the realm exists, that it builds from a public repository, and that
the system which will make it different has a place to live.

## Realm

- **Ashmorrow is named and registered.** The realm runs on AzerothCore for the 3.3.5a client, build
  12340, pinned to an exact upstream commit rather than tracking a moving branch.
- **The classless module is installed and inert.** It compiles, registers itself, and returns early
  from every hook while `Classless.Enable` is `0`. Dropping it into a stock realm changes nothing —
  which is exactly what makes it safe to develop against upstream.
- **No modifications to the server's source code.** Phase 0 research established that spell ownership
  is not class-gated in the core at all, so the whole system can be built as a module plus data.

## Website

- **This site.** Landing page, realm status, armory, rankings, wiki and patch notes.
- **Account registration and sign-in**, writing directly to the realm's login server using the same
  SRP6 credential format the game client uses. No reversible copy of your password is stored
  anywhere.
- **Password reset** by single-use email link, with rate limiting on every account endpoint.
- **The armory reads builds, not classes.** Where a normal armory prints "Fire Mage", this one shows
  the distribution of skill points across ability trees and derives a title from its shape. Until the
  classless system is live there are no points to show, so it says so rather than inventing them.
- **Realm status** probes the login and world servers directly over TCP, so it can tell the
  difference between "the realm is down" and "the realm is restarting".

## Known limitations

- The classless system is not live. Ashmorrow currently plays as a standard realm.
- The armory's build display has nothing to display yet, and says so on every character page.
- The "deepest builds" ranking is empty for the same reason.
- The chassis question — the hidden class underneath every character — is
  [unresolved](/docs/chassis), and it is the biggest open design decision on the project.

## Next

Phase 1: a broker NPC that teaches deliberately off-class abilities, and a careful inventory of what
each one drags in with it. A warrior casting Fireball is a five-minute change. Knowing exactly which
spells that change quietly brings along is the actual work.
