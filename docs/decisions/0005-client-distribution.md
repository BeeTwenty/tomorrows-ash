# ADR 0005 — How players get a 3.3.5a client

**Date:** 2026-08-28
**Status:** **Proposed — blocked on product owner decision.** No distribution
code exists and none will be written until this ADR is Accepted.

> **Not legal advice.** I am not a lawyer. This is an engineering risk
> assessment built from published case law and fifteen years of observable
> enforcement behaviour against WoW private servers. Before this project takes
> money, registers a company, or signs a binary under a real identity, an hour
> with an IP solicitor in *your* jurisdiction is the cheapest thing on the
> roadmap. The analysis below leans on US and EU law because that is where
> Blizzard litigates and where our hosting, registrar and GitHub chain is
> reachable.

---

## 1. Context

The launcher brief asks for "client file download/verification". That single
phrase spans two activities with wildly different legal profiles, and the whole
purpose of this document is to keep them separate:

- **Verification** — checking that files the player already has are the right
  files. We publish hashes. We touch no Blizzard bytes.
- **Distribution** — putting a 15 GB copy of Blizzard's copyrighted client
  into a player's hands, by any mechanism, including ones where the bytes never
  transit our hardware.

The second is not a harder version of the first. It is a different offence.

**We have also already promised not to do it.** The live `/play` page says, in
our own words:

> We distribute no Blizzard files and never will — that is not a policy we can
> bend.

And the homepage says the realm needs "no patch to install, no custom launcher."
Both statements are load-bearing for this project's credibility, and both are
in scope for revision here. The launcher itself already softens the second one
(a launcher becomes *optional convenience*, not a requirement — the manual
`realmlist.wtf` path must keep working forever). Reversing the first is a
different order of decision and is exactly what this ADR puts to you.

---

## 2. The asymmetry, stated plainly

Running the emulator and shipping the client are not neighbouring risks.

| | Running Ashmorrow | Distributing the client |
|---|---|---|
| Primary theory | Contributory/inducement, trademark, ToU breach | **Direct** copyright infringement |
| Is the act itself the infringement? | No — the server is our code plus AGPL AzerothCore | Yes — verbatim reproduction and distribution of the whole work |
| How hard to prove | Requires establishing what users did, and that we caused it | Download it. Hash it. Done. |
| Willfulness | Arguable | Obvious — we know whose files they are |
| US statutory damages | Uncertain, contested | Up to **$150,000 per work willfully infringed** (17 U.S.C. §504(c)(2)) |
| Criminal exposure | Remote | Real — §506(a) / NET Act reaches non-commercial distribution once retail value passes $1,000 in any 180 days |
| Usual first move by rightsholder | Cease and desist | DMCA takedown to host, registrar, CDN — then suit |
| Who you are, to their lawyers | "Unauthorised service" | "Piracy site" |

That last row is the one that matters most and is the hardest to quantify.
Blizzard's enforcement against private servers is overwhelmingly *C&D-first*:
Nostalrius (2016) — 800,000 accounts, international press — received a letter
through French counsel and shut down voluntarily. No suit was ever filed.
Nostalrius did not distribute the client.

The cases that produced money judgments look different. **Blizzard v. Reeves**
(*Scapegaming*, C.D. Cal. 2010) ended in a default judgment of roughly **$88.5
million** — about $85.5M statutory damages plus $3.05M disgorgement of donations.
**Blizzard v. Bossland** (C.D. Cal. 2017) took **$8.5 million** over bots.
The distinguishing features were money changing hands and a defendant who did
not appear — not the mere existence of a server.

Outside Blizzard, the closest analogues to hosting game files are brutal and
recent. **Nintendo v. Mathias Designs** (*LoveROMs/LoveRETRO*, 2018) settled by
consent judgment at **$12.23 million** for hosting ROMs. **Nintendo v. Tropic
Haze** (*Yuzu*, 2024) settled at **$2.4 million** and shut the emulator down —
and note carefully *why*: emulation itself has been lawful since **Sony v.
Connectix**, 203 F.3d 596 (9th Cir. 2000) and **Sega v. Accolade**, 977 F.2d
1510 (9th Cir. 1992). What killed Yuzu was circumvention and the facilitation
of copying, not the emulator. That distinction is the entire strategy of this
document.

---

## 3. What is actually protected, and by what

The 3.3.5a client is not one thing. It is:

1. **Executable code** — `Wow.exe` and its DLLs. Literal copyright in software.
2. **Data archives** — ~14 GB of MPQs holding models, textures, sound, DBCs,
   maps. Audiovisual works, each independently protected.
3. **Trademarks** — "World of Warcraft", "Wrath of the Lich King", the logos,
   the trade dress.

Five theories reach a distributor:

- **Direct infringement** (§106(1), (3)) — reproduction and distribution.
- **DMCA §1201 anti-circumvention.** **MDY v. Blizzard**, 629 F.3d 928 (9th Cir.
  2010) held Warden was an access control for the game's dynamic non-literal
  elements and let a §1201(a)(2) claim proceed. Any tool that defeats a
  protection measure lands here — and §1201 claims do not need an underlying
  infringement to succeed.
- **Trademark / false designation of origin** (Lanham Act §43(a)) — a launcher
  that looks official, or that uses Blizzard's marks as its own branding.
- **Contract** — the WoW EULA and ToU forbid both copying and connecting to
  unauthorised servers. That binds the player; inducing the breach reaches us.
- **Secondary liability** — **MGM v. Grokster**, 545 U.S. 913 (2005): one who
  distributes a device "with the object of promoting its use to infringe", shown
  by clear expression or affirmative steps, is liable for the resulting
  infringement. This is the theory that eats every "we only provide the tool"
  argument, and it is aimed directly at launchers.

### The one piece of good news, and it is large

**The 3.3.5a client needs no binary patch to reach a private server.** It reads
`realmlist.wtf`, it speaks stock SRP6, and AzerothCore answers. Later expansions
(MoP onward) pin the auth server's key inside the executable, which is why those
communities ship "connection patchers" — tools that modify Blizzard's binary to
accept a different key. That is textbook §1201 territory, and it is what turned
Yuzu into a $2.4M settlement.

We are not in that territory and we must never wander into it. **Rule: this
project never modifies a Blizzard binary, on disk or in memory.** It costs us
one feature (see §7) and it removes an entire cause of action.

---

## 4. The options

### Option 1 — We host it. Direct download from our infrastructure.

A 15 GB archive on our own server, or on S3 / R2 / Backblaze behind our domain.

**Legal:** the worst available answer. Direct, willful, per-copy infringement
with our name on the hosting invoice. No §512 safe harbour — safe harbour
protects service providers hosting *user* content under notice-and-takedown, not
a publisher serving its own library. A DMCA notice terminates the storage
account, quite possibly along with everything else we keep there. The registrar
gets the next letter.

**Practical:** also the most expensive option we have. 15 GB per install is real
money at any scale worth having.

**Verdict: no.** Not at any risk appetite. This is the LoveROMs fact pattern.

### Option 2 — Torrent / P2P. We publish a magnet link; the swarm carries the bytes.

The launcher embeds a BitTorrent client and a magnet URI. We host nothing —
allegedly.

**Legal:** better than Option 1 for exactly one reason (no bytes on our disks),
and worse than it looks for four:

- **Somebody has to seed.** A swarm with no seed is a dead swarm, so early on
  that is us, from a machine we control, publishing the whole work to strangers.
  That is Option 1 with extra steps, and it is *trivially* observable — joining
  a swarm and logging peer IPs is the entire evidentiary method of the
  mass-BitTorrent litigation industry.
- **Grokster is precisely on point.** Our launcher would exist to fetch the
  client; our documentation would say so. That is "clear expression" of an
  infringing object. **Columbia Pictures v. Fung**, 710 F.3d 1020 (9th Cir.
  2013) held isoHunt liable for inducement while hosting only torrent files and
  magnet links. The Pirate Bay operators drew *criminal* convictions in Sweden
  (Stockholm District Court 2009, affirmed 2010) for running an index.
- **In the EU it is not even close.** **Stichting Brein v. Ziggo** (CJEU
  C-610/15, 2017) held that operating a platform that indexes torrents is itself
  an "act of communication to the public". **GS Media** (C-160/15, 2016) holds
  that linking to infringing material infringes where the linker knew or ought
  to have known — and knowledge is *presumed* for anyone acting for profit.
- **It moves our liability onto our players.** Every player becomes a
  distributor of a 15 GB commercial work from a residential IP. In Germany the
  *Abmahnung* industry turns that into four-figure euro settlement demands as a
  matter of routine. Knowingly walking a community we are trying to build into
  that is not a legal problem so much as a decency one.

**Practical:** 3.3.5a torrents already exist and are heavily seeded. We would be
adding nothing except our fingerprints.

**Verdict: no.** It shifts risk from us to our players while leaving the
inducement claim fully intact.

### Option 3 — Bring your own client: verify and configure only.

The launcher never downloads a Blizzard file. It asks the player to point at a
3.3.5a install they already have — folder, ISO, or archive — verifies it against
a published hash manifest, says precisely what is wrong if anything is, and then
does everything we *are* free to do: write `realmlist.wtf`, install our own
patches, manage the Wine prefix, launch the game, check for updates.

**What we publish:** hashes, file paths, sizes, build numbers. Facts. **Feist v.
Rural**, 499 U.S. 340 (1991) — facts carry no copyright. A hash is one-way; a
manifest reconstructs nothing. Our own code and our own content, and nothing
else.

**Legal exposure:** essentially unchanged from running the realm, which is the
risk this project already accepted in ADR 0001. No direct infringement, no
§1201, no inducement — provided we never link to a source (see Option 6).

**Practical cost:** real, and worth stating honestly. The player has to find 15
GB themselves. But this is the most-distributed game client in the history of
the medium, its acquisition is a solved problem in every private-server
community, and our own `/play` page has required exactly this from day one. Our
audience is people who chose to seek out a classless WotLK realm. They can
manage a client.

**It also keeps a promise we already made in public**, which is worth more to a
project whose stated virtue is telling you exactly where it is.

**Verdict: recommended.**

### Option 4 — Host only our own patches and deltas.

A small patch channel — megabytes, not gigabytes — carrying content we authored:
our own MPQ (icons, strings, any art Phase 3 itemisation eventually needs), our
config, the manifest itself, and the launcher's own updates.

This is not an alternative to Option 3. It is the other half of the same
launcher. The only hazard is our patch content quietly becoming derivative —
a recoloured Blizzard icon is still Blizzard's icon. **Rule: everything in our
patch channel is original or licensed, and its provenance is recorded.**

**Verdict: do it, alongside Option 3.**

### Option 5 — Binary deltas against a client the player already has.

Tempting: ship a small patch that turns *their* build into *our* known-good
build, normalising locale or build number.

A delta between two copyrighted builds contains the expression of the target
build; applying it reproduces a work we had no right to reproduce. This is the
"patcher" fact pattern and it converts a small file into direct infringement.

**Verdict: no. Never a delta over a Blizzard file.** We tell players what build
they need and whether theirs matches. We do not transform it.

### Option 6 — Point elsewhere. Link to a mirror, a wiki, archive.org.

Contributory infringement with the knowledge element handed over voluntarily,
and in the EU an act of communication to the public under *GS Media*. Archive.org
does not launder anything — it lost **Hachette v. Internet Archive** (2d Cir.
2024) on its own lending programme.

**Verdict: no links. Not in the launcher, not in the docs, not "unofficially",
not in Discord.** This is a bright line and it is easy to enforce mechanically —
see §6.

### Option 7 — Jurisdiction and anonymity plays.

Offshore hosting, a seedbox somewhere permissive, anonymous ownership, no real
names. This is what operators who do distribute clients actually do, and it does
reduce *practical* enforceability. It does not reduce legal exposure by one inch,
and it is unavailable to us anyway: this repository is public under a real GitHub
account, the commits carry a real email, the site has a real domain. We are not
anonymous and pretending otherwise would be a worse position than being open —
you get the risk of hiding *and* the risk of being found.

It also contradicts the entire character of the project.

**Verdict: not available, and not worth wanting.**

### Option 8 — Ask Blizzard.

Named only so the list is honest. Blizzard has never licensed a private server.
They hired the Nostalrius team's data for Classic and shut the server anyway.
There is no door here.

---

## 5. Enforcement reality — what actually triggers a response

Ranked by observed history, most-triggering first:

1. **Money.** Subscriptions, cash shops, and donations. Scapegaming's damages
   were driven by its donation revenue. Every large judgment in this space has
   money in the fact pattern.
2. **Scale and publicity.** Nostalrius drew fire at 800,000 accounts and
   international press coverage.
3. **Distributing client files.** Moves the file from the "unauthorised service"
   queue to the "piracy" queue, and those are handled by different people with
   different remedies.
4. **Using Blizzard's trademarks as your own branding.**
5. **Competing with something Blizzard currently sells.** This one has changed
   since the last generation of private servers. WotLK Classic shipped in 2022;
   Blizzard now *sells* the era we emulate. Historically that is precisely the
   condition under which their calculus changes — Nostalrius was shut down
   months before Classic was announced.

Things that reduce it: no monetisation of any kind, no client distribution, no
Blizzard marks in our branding, and answering a C&D promptly and completely
rather than moving hosts.

**The single largest risk reduction available to this project is to never take
money.** Nothing in the launcher — no cosmetic, no priority queue, no "supporter"
tier — is worth what it does to the exposure profile.

---

## 6. Launcher-specific exposure the website never had

A launcher is a binary we put on other people's computers. That is new, and it
brings its own list:

- **Code signing.** An unsigned Windows binary meets SmartScreen and a scary
  dialog. Signing needs an OV/EV certificate bound to a verified legal identity,
  now on a hardware token. That puts your real name, or a company's, on a
  certificate attached to a WoW private server. That is a genuine decision, not a
  formality. The alternative is shipping unsigned with published hashes and
  eating the friction. **Recommendation: ship unsigned initially**, publish
  SHA-256 sums, and revisit only if we ever incorporate.
- **Antivirus false positives.** A program that writes into a game folder,
  places MPQs and spawns a Windows binary under Wine is shaped exactly like
  malware to a heuristic engine. Expect Defender flags. Mitigations: no packer,
  no self-modifying code, reproducible builds from public CI, and submitting
  false positives.
- **Trademark hygiene in the UI.** Never "World of Warcraft Launcher". Never
  Blizzard's logos, fonts, key art, or the Lich King. Nominative reference only:
  "for World of Warcraft® 3.3.5a clients". The visual identity in
  [LAUNCHER-DESIGN.md](../LAUNCHER-DESIGN.md) sidesteps this structurally by
  using no game art at all.
- **Credentials on the desktop.** The launcher should never store a password.
  A short-lived token in the OS keyring, and nothing else.
- **Licensing.** AzerothCore is AGPL-3.0 and work derived from it inherits that.
  A launcher that speaks HTTP to our website and edits config files is *not*
  derived from AzerothCore, so it is not compelled to be AGPL — but this
  repository currently has **no `LICENSE` file at all**, which is its own bug.
  Flagged as an open item below.

---

## 7. Recommendation

**Options 3 + 4: verify-only for the base client, our own patch channel for
everything we author.**

Six rules, to be written into `launcher/README.md` and enforced where a machine
can enforce them:

1. The launcher never downloads, hosts, seeds, mirrors, links to, or embeds a
   locator for any Blizzard-authored file.
2. Our patch channel carries only content we authored or licensed, with recorded
   provenance.
3. We never modify a Blizzard binary — not on disk, not in memory, not at
   runtime.
4. Manifests contain hashes, paths and sizes. Facts only, never bytes.
5. The launcher is branded Ashmorrow. No Blizzard marks, no game art.
6. No money, anywhere near any of it.

Rules 1 and 4 are testable, so CI should test them, in the same spirit as the
existing "No core checkout or client data committed" job: fail the build on
`magnet:`, `.torrent`, known mirror hostnames, or any file over a size threshold
under `launcher/`. A promise a machine checks is a promise that survives us
getting busy.

**What this does not fix.** The realm itself remains unauthorised. A launcher
makes us more visible, more product-shaped, and easier to characterise as an
operation rather than a hobby. That cost is real; it is just very much smaller
than the cost of the alternative.

---

## 8. What I need from you

**The decision this ADR is blocked on:** which distribution approach ships. My
recommendation is 3 + 4. If you choose 2 (torrent), say so explicitly and I will
document the exposure in the ADR before writing a line of it — I am not going to
build it quietly.

**Two things I need regardless, to build the verify path:**

- **A hash manifest has to come from a real client.** I cannot generate one in
  this sandbox. I need SHA-256/BLAKE3 sums, paths and sizes from your own 3.3.5a
  install — a script in `launcher/` will produce them and the output is facts,
  safe to commit. Until then the launcher verifies structure (is this a 12340
  client at all?) but cannot verify contents.
- **A `LICENSE` file** for this repository. Missing entirely today. AGPL-3.0 for
  the module and anything linked to AzerothCore; the launcher and website could
  be MIT, but one licence across the repo is simpler to explain.

## 9. Consequences if accepted

- `/play` keeps its promise verbatim, and gains a launcher as an *optional*
  route. The manual `realmlist.wtf` instructions stay forever — they are the
  fallback when the launcher is broken, unavailable on someone's platform, or
  distrusted.
- The homepage's "no custom launcher" line needs one honest edit: the classless
  system still needs no modified client; the launcher is convenience, not a
  requirement.
- The launcher's most common answer to a new player will be "your client is not
  build 12340, and I cannot fix that for you". That message has to be
  genuinely good — the UX weight lands on diagnosis rather than repair.
