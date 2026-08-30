# ADR 0007 — The repository's licence

**Date:** 2026-08-29
**Status:** Accepted. `LICENSE` is in the repository root.

> Not legal advice. This is the reasoning behind a choice, checked against the
> actual licence texts and the actual dependency trees rather than against
> memory. Where it matters, the commands that produced each finding are given.

---

## 1. The premise this repository had wrong

Every document here said AzerothCore is **AGPL-3.0**. It is not.

At our pinned commit (`e2f5e48b`, see `upstream.json`), `LICENSE` in the
AzerothCore repository is the **GNU General Public License, version 2, June
1991** — verbatim, its operative terms byte-identical to SPDX's `GPL-2.0-only`
text and to the copy in the Linux kernel tree. There is no Affero anywhere in
it.

And the source headers grant more than the bare version:

```
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
```
— `src/server/game/Entities/Player/Player.cpp`, and the same in
`src/common/Cryptography/Authentication/SRP6.cpp` and
`src/server/game/Accounts/AccountMgr.cpp`.

So upstream is **GPL-2.0-or-later**. Those five words carry most of this
document: they mean we may use version 2, or 3, or anything later, and they
mean the same option passes to everyone downstream of us.

The mistake was not cosmetic. AGPL-3.0 is **incompatible** with GPL-2.0-only,
so a project that believed it was AGPL and combined itself with a
GPL-2.0-only work would have had a real conflict. And the wrong claim had reached
the public website — the FAQ, and the footer of **every page** — where visitors
were being told something untrue about the licence of software they might want
to reuse. Corrected in this change, in all nine places it appeared.

*(How it went wrong is worth a sentence: AzerothCore forked from SunwellCore,
itself downstream of TrinityCore, and much of that family's tooling and many
of its community modules are AGPL-3.0. It is a very easy thing to assume. It
is also the kind of assumption that a licence file exists to settle.)*

---

## 2. What actually derives from AzerothCore, and what does not

Copyleft attaches to derivative and combined works, not to everything in a
repository that happens to sit near one. Taking the parts in turn:

| Part | Derived? | Why |
|---|---|---|
| `modules/mod-classless/` | **Yes** | Includes AzerothCore headers, compiles into the worldserver binary. A combined work on any reading |
| `web/src/lib/srp6.ts` | **Yes, on its own admission** | Its header says "Ported from the pinned upstream commit: `SRP6.cpp`, `AccountMgr.cpp`". A translation into another language is a derivative work — §101 lists "translation" by name |
| Rest of `web/` | No | Talks to MySQL. Contains no AzerothCore code |
| `tools/ta.py` | No | Shells out to `cmake`, `git`, `mysql`. Includes nothing |
| `launcher/` | No | Links nothing of AzerothCore's, ports nothing from it. Speaks HTTP to our own website and edits config files |
| `sql/`, module SQL | No | Data a GPL program reads is not a derivative of the program |

The `srp6.ts` entry deserves its paragraph, because there is a real argument on
the other side. SRP6 is a published algorithm; §102(b) puts procedures and
methods of operation outside copyright; the modulus and generator are facts;
and the protectable expression in forty lines of modular arithmetic is thin.
A clean-room implementation from the RFC would plainly be ours. But **this one
is not that** — its own comment says where it came from, and that admission is
the first thing anyone arguing the point would quote. Treating it as derived
costs us nothing and settles the question.

### The obligation nobody has noticed

Under GPL-2, **running** a program and letting people connect to it over a
network is not distribution, and triggers no source obligation whatsoever.
Neither does serving a website written in GPL'd code — visitors receive HTML,
not the program.

So the README's standing claim — *"As a public-facing server we must be able to
publish our source"* — was **never a legal requirement**. Publishing is a
choice this project made, and a good one. It is worth knowing it is a choice,
because a value held deliberately survives better than one held by mistake.

The obligation does bite the moment we **distribute a binary**: a Docker image
of the worldserver, a release build, or the launcher. Then recipients are owed
the corresponding source.

---

## 3. The dependency audit, which changed the shape of the answer

Copyleft compatibility runs both ways: not only "may our code be GPL", but
"may everything we link be combined with GPL". Checked with
`cargo metadata --all-features` over `launcher/core`:

```
 55  MIT OR Apache-2.0          ← dual-licensed; we take the MIT arm
 18  Unicode-3.0
  1  Apache-2.0 AND ISC         ← ring
    … BSD-3-Clause, ISC, Zlib, CDLA-Permissive-2.0, MIT
```

**`ring` is `Apache-2.0 AND ISC`.** `AND`, not `OR` — there is no permissive
arm to choose. And **Apache-2.0 is incompatible with GPL-2.0**: its patent
termination and indemnification provisions impose conditions GPLv2 does not
permit adding. Apache-2.0 *is* compatible with GPL-3.0, which added the
provisions to accommodate exactly this.

It reaches us unavoidably:

```
ring v0.17.14
├── rustls v0.23.43
│   └── ureq v2.12.1
│       └── ashmorrow-launcher-core
```

There is no escape by switching TLS. `ureq`'s `native-tls` route uses OpenSSL,
which is Apache-2.0 from 3.0 onward; `rustls`'s other backend, `aws-lc-rs`, is
Apache-2.0 as well. TLS in Rust is Apache-licensed, and the launcher needs TLS.

**So the launcher binary — the one artefact we actually ship compiled — cannot
be conveyed under GPL-2.0.** It must go out under GPL-3.0 or later.

The npm trees are not in the same position. Apache-2.0 and LGPL packages in
`web/node_modules` are ESLint and optional `sharp` binaries: development
tooling and things `npm ci` fetches on the installing machine. We do not convey
them. `launcher/ui`'s one runtime dependency, `@tauri-apps/api`, is
`Apache-2.0 OR MIT` — MIT arm taken.

---

## 4. Decision

**The whole repository is licensed `GPL-2.0-or-later`.** `LICENSE` holds the
verbatim GPL-2 text — the same document upstream ships, its operative terms
verified against two independent copies.

Four reasons, in the order they mattered.

**It is exactly what upstream grants, and nothing more.** Matching upstream is
the answer that cannot be wrong, and it is the same instinct as ADR 0002's
commit pin: divergence you did not need is drift you will pay for later.

**"Or later" is the whole point, so we pass it on.** It is what lets the
launcher binary ship as GPL-3.0-or-later without a second licence file, a
dual-licensing story, or an exception clause. That is not a workaround — it is
the clause working as designed. Anyone downstream gets the same latitude.

**Downstream compatibility is maximised.** Our code can be taken under v2, v3,
or later. Most AzerothCore community modules are GPL-2.0-or-later, so ours
combines with theirs. Choosing GPL-3-only at the root would cut off v2 users
and buy nothing that "or later" does not already give us.

**AGPL would have added an obligation, not a protection.** Its §13 network
clause binds *us* first: our own website would owe a prominent offer of the
Corresponding Source to every visitor. In fairness, the site footer already
links to this repository on every page, so we would very likely be compliant
by accident — but "compliant by accident" is a poor reason to take on a
continuing obligation, and we publish source by choice already. And the argument that AGPL forces other realms to publish their
changes is weaker than it looks — operators who would ignore GPL will ignore
AGPL, and the ones who care publish either way. Upstream chose GPL-2 knowing
this domain perfectly well.

### The asymmetry that settles it

GPL-2.0-or-later → GPL-3.0 or AGPL-3.0 is a door we can walk through whenever
we like, because "or later" points forward. AGPL-3.0 → GPL-2.0 is a door that
does not open. Starting at the permissive end of copyleft keeps the choice
alive; starting at the strict end spends it on day one.

### What was chosen against

**AGPL-3.0-or-later** — legal via the "or later" option, and a genuine fit for
a project whose stated character is that every line is public. It costs a §13
source offer on the website, compatibility with any GPL-2.0-only work, and
divergence from upstream for no compatibility gain. It remains available at any
time; that is the point of the paragraph above.

**Mixed licensing** — GPL for `modules/`, MIT for `launcher/` and `tools/`. More
precisely correct per part, and `launcher/` genuinely is not derived, so it
could be permissive. Rejected because `web/src/lib/srp6.ts` would need either a
clean-room rewrite or an exception carved around one file, and because
per-directory licence files and SPDX headers are ongoing overhead with no
beneficiary this project can name. If someone ever wants to reuse the launcher
in a proprietary product, we hold the copyright and can relicense it then.

---

## 5. Consequences

- `LICENSE` (GPL-2.0) is in the root. `Cargo.toml` and `package.json` manifests
  declare `GPL-2.0-or-later`, and our own C++ sources carry the standard
  header — those are the files that link into a GPL'd binary, so they are where
  it matters most.
- **The launcher binary is conveyed under GPL-3.0-or-later**, because of `ring`.
  Recorded in `launcher/README.md` beside the build instructions, which is
  where whoever cuts a release will be looking.
- **If we ever publish a worldserver binary or Docker image**, recipients are
  owed the corresponding source. Running the realm, and serving the website,
  owe nothing under GPL-2 — but we publish anyway, and now by choice rather
  than under a misapprehension.
- Vendored IBM Plex (`launcher/ui/src/fonts/`) stays under **OFL-1.1**, with
  its own `OFL.txt` beside it. Fonts aggregated with a program are not part of
  the program; nothing about our licence changes theirs, or theirs ours.
- A CI step fails the build if `LICENSE` goes missing or if anything in the
  tree claims AGPL again, so this particular error cannot come back quietly.
