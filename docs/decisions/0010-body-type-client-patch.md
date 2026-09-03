# ADR 0010 — Showing three body types at character creation

**Date:** 2026-09-01
**Status:** Accepted. Recipe-over-shipped-MPQ is approved and built
(`launcher/core/src/recipe.rs`). `inspect-dbc` is built and awaits a run against
a real client. The race matrix is confirmed (§10.1). **The chassis swap to
Hunter is approved** (§10.7), and what it actually cost is re-derived in §10.8 —
less than quoted, and one thing more.

> **Nothing here has been checked against a real client.** There is no 3.3.5a
> client in this sandbox, so every claim about DBC layout, MPQ load order and
> race/class availability below is reasoning from documented formats, not
> observation. §8 proposes a two-hour verification step that turns the whole of
> §3 from an argument into a fact, and it should happen before anything is
> built.

---

## 1. The short answer

**Yes, the MPQ approach works, and it layers into the verification model
cleanly** — better than cleanly, in fact: it is the one client-modification
technique that does not disturb Tier 2 at all, for a reason worth stating
precisely (§2).

**But the client-side patch is the last ten percent of this job, not the first.**
The three body types are Paladin, Shaman and Mage, which are the three most
race-restricted classes in Wrath. Hiding the other seven does not leave three
choices per race — it leaves **one choice for six races and none at all for
Night Elves**. The work this scope really contains is creating sixteen
race/class combinations Blizzard never shipped, and that is server-side data,
not a DBC edit (§3).

And there is a rule-2 problem with the obvious implementation that has a clean
answer (§4).

---

## 2. How it fits the integrity model — the good news

Phase 2's model, from [ADR 0006](0006-launcher-architecture.md):

| Tier | Question | Verdict |
|---|---|---|
| 1 | Is this a build 12340 client? | **Blocks** |
| 2 | Do the player's Blizzard files match hashes we measured? | **Warns** |
| 3 | Do *our own* files match *our own* hashes? | **Blocks** |

**An MPQ override is purely additive.** It adds `Data/patch-*.MPQ`; it does not
touch `common.MPQ`, `locale-enUS.MPQ`, or any file Blizzard shipped. The client
resolves `DBFilesClient\ChrClasses.dbc` from the highest-priority archive that
contains it, and ours wins by load order rather than by overwriting anything.

That single property is what makes this safe:

- **Tier 2 is untouched.** Every Blizzard file still hashes to what it hashed
  before. Had we instead rewritten `locale-enUS.MPQ` in place, every player
  would see "1 file differs from the build we measured" forever, and the
  warning that means something would be buried under a warning that does not.
- **Tier 3 covers the new file for free.** Our patch is exactly what
  `verify_patches()` already checks: our file, our hash, blocking on mismatch.
  `install_patch()` already verifies bytes before writing and writes through a
  temporary. No new machinery.
- **Uninstall is `rm`.** Nothing was overwritten, so nothing has to be restored.
  The `.ashmorrow-original` backup convention does not even apply.

**Two concrete code changes are needed**, both small and both in the generator
rather than the verifier:

1. `ashmorrow-manifest hash` walks `*.MPQ` to build the Tier 2 list. Run it on a
   client that already has our patch installed and our own archive gets recorded
   as a *Blizzard* file. It must skip archives that are ours — and, better,
   skip any archive not in the known 3.3.5a set, so a foreign server's
   `patch-4.MPQ` cannot poison the manifest either.
2. `Client::detect` should report which custom archives are present, so the
   launcher can say "you have another server's patch installed" instead of
   silently fighting over a filename (§7).

---

## 3. The finding that reframes the task

`docs/BODY-TYPES.md` fixes the three chassis:

| Body type | Underlying class | Class ID |
|---|---|---|
| Vanguard | Paladin | 2 |
| Skirmisher | Shaman | 7 |
| Adept | Mage | 8 |

Those were chosen on stat grounds — all three must use mana, which rules out
Warrior, Rogue and Death Knight, and the document reasons carefully about attack
power and stat budgets. **Race availability was never part of that analysis**,
and in Wrath it is brutal:

| Race | Paladin | Shaman | Mage | Body types available |
|---|---|---|---|---|
| Human | ✓ | — | ✓ | 2 |
| Orc | — | ✓ | — | 1 |
| Dwarf | ✓ | — | — | 1 |
| **Night Elf** | — | — | — | **0** |
| Undead | — | — | ✓ | 1 |
| Tauren | — | ✓ | — | 1 |
| Gnome | — | — | ✓ | 1 |
| Troll | — | ✓ | ✓ | 2 |
| Blood Elf | ✓ | — | ✓ | 2 |
| Draenei | ✓ | ✓ | ✓ | **3** |

**14 of the 30 combinations exist. Only Draenei can pick all three. Night Elf
can pick nothing.**

So "delete the seven non-body-type classes from `CharBaseInfo.dbc`" produces a
character creation screen where six of ten races offer a single non-choice and
one race offers an empty list. That is not the feature; it is a broken screen.

The actual requirement is **adding 16 race/class rows**, and a row in
`CharBaseInfo.dbc` is the cheap half. The server has to agree, which means data
in every one of these for each new combination:

| Table | What breaks without it |
|---|---|
| `playercreateinfo` | character creation is refused outright |
| `player_levelstats` | no base stats — a broken or zero-stat character |
| `playercreateinfo_item` | starts naked |
| `playercreateinfo_spell_custom` | no racial or class starting spells |
| `playercreateinfo_action` | empty action bars |
| `playercreateinfo_skills` | no weapon or armour skills |

That is generated data, and it is generable — the existing rows for the same
class on a different race are the template, with the race's own starting
position and racial spells substituted. `tools/gen_trees.py` is the precedent
for how this project does generated, verified-against-the-database SQL. But it
is a **Phase 3-sized piece of server work that has to land before the client
patch does anything useful**, and it belongs to `mod-classless`, not the
launcher.

### The cheaper alternative worth one paragraph

If a chassis were built on **Priest** instead, availability changes sharply:
Priest exists for Human, Dwarf, Night Elf, Draenei, Undead, Troll and Blood
Elf — seven races against Paladin's four and Shaman's four. Swapping one chassis
could cut the sixteen missing combinations to a handful.

I am **not** proposing to reopen BODY-TYPES; its numbers are approved and tuned,
and Priest's stat line is not Shaman's. But the choice was made without this
constraint in view, and "sixteen generated race/class datasets" is a large
enough bill that it is worth knowing a cheaper menu exists before paying it.

---

## 4. What we would ship — and the rule-2 problem

The obvious implementation is: edit the two DBCs, pack them into an MPQ, host
it, launcher downloads it. That runs straight into
[ADR 0005](0005-client-distribution.md) rule 2:

> Our patch channel carries only content we authored or licensed.

A `ChrClasses.dbc` with three names changed is **Blizzard's table with three
edits**. A `CharBaseInfo.dbc` with rows removed and added is **Blizzard's table,
filtered**. Neither is content we authored. Shipping either means putting
Blizzard-derived data on our server and handing it to players — which is a
smaller version of exactly the thing rule 1 exists to prevent, and it would be
odd to have declined to host a client and then host pieces of one.

*(The counter-argument is real: a DBC is a data table, `Feist` puts facts
outside copyright, and "Paladin" is a word. The expression here is thin. But
this is a rule we wrote, the workaround is cheap, and consistency is worth
more than the argument.)*

### The answer: ship a recipe, not a table

The manifest carries **edit instructions**; the launcher reads the player's own
DBCs out of their own client, applies the edits, and builds the MPQ **locally**.

```
     our server                          the player's machine
┌────────────────────┐         ┌──────────────────────────────────┐
│ recipe (a few kB)  │────────▶│ read locale-enUS.MPQ             │
│                    │         │  → DBFilesClient\ChrClasses.dbc  │
│ rename 2 → Vanguard│         │  → DBFilesClient\CharBaseInfo.dbc│
│ rename 7 → Skirm.  │         │            ↓ apply the recipe    │
│ rename 8 → Adept   │         │ write Data/patch-4.MPQ           │
│ keep classes 2,7,8 │         │            ↓                     │
│ add 16 race rows   │         │ hash it, record it, Tier 3       │
└────────────────────┘         └──────────────────────────────────┘
   no Blizzard bytes                 Blizzard bytes never leave
```

This is better on four counts, not just the legal one:

- **No Blizzard bytes on our infrastructure.** Rule 2 holds without an argument.
- **Every locale works from one recipe.** A shipped MPQ would be enUS-only, or
  sixteen MPQs. A recipe reads whatever locale the player has.
- **It is robust to client variation.** A repacked client whose DBCs differ
  slightly still gets a correct patch, because we edit *theirs*.
- **The recipe is reviewable.** "Rename class 2, keep 2/7/8, add Night Elf
  Paladin" is legible in a pull request. A binary blob is not.

The cost is real: the launcher needs an MPQ **reader**, a DBC reader/writer, and
an MPQ **writer**. Sizing that honestly:

| Piece | Effort | Note |
|---|---|---|
| DBC read/write | Small | A 20-byte header and fixed-size records. `CharBaseInfo` is the awkward one — records are 2 bytes, so the usual `field_count * 4 == record_size` assumption fails |
| MPQ read | Medium | Hash table, block table, and the decompression the archive actually uses |
| MPQ write | Medium | An uncompressed MPQ v1 holding two small files is a few hundred lines. We do not need compression, encryption, or the (v2+) features |
| Recipe format + tests | Small | Fits the existing manifest pattern |

No Rust crate does all of this well. Writing it ourselves keeps the dependency
count where it is and keeps everything under `cargo test`, which is the same
reasoning that put the HTTP transport in `core`.

---

## 5. Scope

**Client-side, in the recipe:**

1. `ChrClasses.dbc` — rewrite the `Name_Lang` string for IDs 2, 7 and 8 to
   Vanguard, Skirmisher and Adept. Writing a DBC string means appending to the
   string block and repointing the offset; in-place overwriting only works when
   the new name is no longer than the old, which "Skirmisher" over "Shaman" is
   not.
2. `CharBaseInfo.dbc` — reduce to the intended race × body-type matrix: remove
   every row whose class is not 2, 7 or 8, and add the 16 rows §3 lists.

**Explicitly not in scope, and worth being clear about:**

- **This hides; it does not enforce.** A player with an unpatched client sees all
  ten classes and can create any of them. The DBC patch is a *presentation*
  change. Enforcement is `mod-classless` rejecting the create packet, and
  without that the patch is decoration. Ship the server rule first.
- Class icons and the character-creation background art still say Paladin. That
  is `Interface\Glues\CharacterCreate\` and a much larger art job.
- Tooltips, the character sheet and `%c` in chat come from other DBC strings and
  from the server. Renaming three rows in `ChrClasses` will leave "Paladin"
  visible in places, and a first pass should enumerate them rather than
  discover them one bug report at a time.

---

## 6. How it reaches the player

Through the mechanism already built, with one new step:

1. Launcher fetches the manifest. It gains a `recipes` section beside `patches`
   and `runtime` — an https URL and a hash, like everything else.
2. Verification runs as it does now.
3. **New:** if a recipe is present and the built artefact is missing or does not
   match, the launcher builds it from the player's own client, writes
   `Data/patch-4.MPQ`, and records its hash.
4. Tier 3 checks it on every subsequent start; a corrupted one is rebuilt.
5. The launch bar will not say `LAUNCH` until it is in place — same rule the
   runtime provisioning uses, and for the same reason: a client that reaches
   the creation screen showing ten classes on a three-class realm is a worse
   outcome than one that has not started.

Automatic, no player step, and it fits the existing state machine rather than
adding a parallel one.

**The archive slot needs verifying, not assuming.** `patch-4.MPQ` is the
private-server convention and I believe 3.3.5a loads `patch-4` through
`patch-9`, but whether `DBFilesClient` overrides must live in a *locale* archive
(`Data/enUS/patch-enUS-4.MPQ`) rather than the base `Data/` is exactly the kind
of thing that is obvious with a client in front of you and a coin-flip without
one. §8.

---

## 7. Risks

**Anti-cheat: near zero, and the only relevant one is ours.** Blizzard's Warden
is irrelevant — nobody is connecting to Blizzard. AzerothCore ships a Warden
implementation, and if we ever enable it with MPQ checks we would be flagging
our own patch; our allowlist, our problem, but a note-to-self worth leaving now.

**Antivirus: modest, and already priced in.** The launcher already writes into a
game directory and unpacks archives into a Wine prefix. Writing one more file is
not a new category of behaviour.

**Collision with other servers' patches: the real risk.** `patch-4.MPQ` is a
*convention*, which means everyone uses it. A player who also plays on another
custom server very likely has one, and whoever writes last wins — silently,
producing a character creation screen belonging to neither server.

Mitigations, in order of preference:

- **Detect and refuse to clobber.** If a `patch-4.MPQ` exists that is not ours,
  say so and stop, rather than overwriting someone else's work. The launcher's
  whole posture is diagnosis over silent action; this is the same rule.
- **Take a distinctive slot.** A higher number is less contended.
- **Say it in the interface.** "This client is now set up for Ashmorrow" is
  information a player sharing an install between servers genuinely needs.

**Addons are not affected.** `Interface\AddOns` is a different mechanism
entirely; nothing here touches it.

**One operational rule, easy to get wrong and expensive to debug:** the server's
DBC data is extracted from a client by `map_extractor`. **Never extract server
data from a patched client** — the renames and the filtered class table would
propagate into the server's own `ChrClasses` and `CharBaseInfo`, and the
resulting mismatch would be maddening. SETUP §5 should say so, and the extraction
step should check.

### 7.1 What the first real-client run found (2026-09-03)

Both numbers the patch turns on were wrong, and they were wrong in ways that
agreed with each other.

**`ChrClasses.Name_Lang` is field 4, not 5.** The authority is the format string
the core's own DBC loader parses with —
`ChrClassesEntryfmt` in `src/server/shared/DataStores/DBCfmt.h` at the pinned
commit:

```
"nxixssssssssssssssssxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxixii"      60 fields
 ││││└──────────────┘                                     └──┴─ 56, 58, 59
 ││││ 4..19  Name_Lang, sixteen locale columns  (20 is its flags word)
 │││└ 3      PetNameToken
 ││└ 2       powerType
 │└ 1        unused
 └ 0         ClassID
```

The struct comment in `DBCStructure.h` says `name[16]` is 5–20 and is simply
wrong; the format string is what the loader reads. The real client agrees with
the format string: 60 fields at 240 bytes, which is `4 + 3×(16+1) + 5`.

Writing at 5 would have put the sixteen locale columns at 5–20: the enUS name at
column 4 untouched, so **nothing visible would change**, and the string-flags
word at 20 overwritten. A silent corruption presenting as "the patch didn't
work".

**The tool's own column search was also wrong**, and would have confirmed the
error rather than catching it. It took the first column holding plausible text.
`ChrClasses` has two string columns and the decoy comes first: `PetNameToken` at
3. Against this client it reported field 3 and printed ten classes named "PET"
and "DEMON" — obviously wrong, which is the only reason it was caught.

Three things changed:

1. **Shape, not text, identifies the column.** A `_Lang` field is sixteen
   consecutive columns of which a single-locale client populates exactly one.
   Read `PetNameToken` as the start of such a block and the real name column
   falls inside it — visible as *bleed*, and disqualifying. `dbc::lang_candidates`.
2. **A string offset of 0 means "no string", by convention rather than by
   reading byte 0.** Blizzard's files begin the string block with a NUL so the
   two cannot collide; a table repacked by a third-party editor need not, and
   then every empty reference reads as whatever string is first. That is how a
   column of blank pet tokens prints as ten convincing names. The cost is that a
   string stored *at* offset 0 is unreadable, which is correct: nothing in the
   file distinguishes it from empty.
3. **The report prints every candidate with its evidence**, plus the raw fields
   of record 0 and the head of the string block, so a disagreement can be
   settled without another run on somebody else's machine.

The deeper lesson is about the fixture, not the format. The test built its
`ChrClasses` *from* `recipe.name_field`, so the fixture moved whenever the
recipe did and the two agreed all the way to a real client. The fixture is now
the layout the format string describes, fixed independently, and the recipe is
asserted against it — `launcher/core/tests/common/mod.rs`. Setting `name_field`
back to 5 now fails three tests.

---

## 8. Recommended first step, before any of this is built

**Verify §3 against a real client.** Everything above rests on a race/class
matrix I reasoned out rather than read, and on MPQ load-order behaviour I have
not observed.

Extend the existing tool — it already reads a client — with a read-only command:

```
ashmorrow-manifest inspect-dbc /path/to/WoW-3.3.5a
```

which opens the locale archive, reads `CharBaseInfo.dbc` and `ChrClasses.dbc`,
and prints the actual matrix and the actual class names. Read-only, no writing,
no legal surface, and it either confirms the table in §3 or corrects it.

That is a few hours, it is useful regardless of which direction this goes, and
it is the difference between building on a fact and building on my recollection
of Wrath.

**Then, in order:**

1. `inspect-dbc` → confirm the matrix and the archive layout.
2. **Decide the race matrix question** — accept the 16-combination bill, or
   revisit one chassis (§3).
3. Server-side: generate and verify `playercreateinfo` and friends. This is the
   bulk of the work and it is not launcher work.
4. Only then: the recipe format, the DBC/MPQ code, and the launcher step.

## 9. What I need from you

- **The race matrix decision.** Sixteen generated race/class datasets, or a
  chassis swap. This changes the size of the project more than anything else
  here.
- **Confirmation that recipe-over-shipped-MPQ is the right call** (§4). It costs
  a few hundred lines of MPQ writing and keeps rule 2 intact. I recommend it.
- Nothing else is blocked. `inspect-dbc` is safe to build now and de-risks
  everything after it, so I would like to start there.

---

## 10. Addendum — the matrix is confirmed, and a chassis proposal

*Added after the product owner ran `check_client_combos.py` against a real
client and asked for a swap candidate before committing to the race-data work.*

### 10.1 §3 was right

Sixteen of the thirty race/body-type pairs are server-accepted and
client-blocked. Night Elf has none; most other races have one. That is the
matrix §3 reasoned out, confirmed against a real client rather than recalled,
and it is now also a test — `launcher/core/tests/inspect_dbc.rs` asserts the
fourteen-of-thirty count and the Night Elf zero, so a future edit to the
body-type set that quietly changes the bill fails the build.

### 10.2 Vanguard cannot be swapped, and the reason is short

The design fixes three constraints: one plate chassis, one mail, one cloth
([BODY-TYPES §3](../BODY-TYPES.md)), and all three must cast, which means all
three must use mana ([BODY-TYPES §1](../BODY-TYPES.md)).

In 3.3.5a there is exactly **one** class that is plate *and* mana: Paladin.
Warrior is plate and uses rage; Death Knight is plate and uses runes. So the
entire design space is:

> Paladin × {Shaman, Hunter} × {Mage, Priest, Warlock}

Six combinations, not sixty. Vanguard was never a choice, which is worth
knowing before spending time on it: **Paladin's four races are a floor, not a
decision.**

### 10.3 All six, counted

Pairs available out of thirty, and how many races are left with nothing:

| Vanguard | Skirmisher | Adept | Pairs | Races with none |
|---|---|---|---|---|
| Paladin | Shaman | Mage | 14 | **1** — Night Elf |
| Paladin | Shaman | Priest | 15 | **1** — Gnome |
| Paladin | Shaman | Warlock | 13 | **1** — Night Elf |
| **Paladin** | **Hunter** | **Mage** | **17** | **0** |
| Paladin | Hunter | Priest | 18 | **1** — Gnome |
| Paladin | Hunter | Warlock | 16 | 0 |

The last three columns are computed from the client's own table in
`swapping_shaman_for_hunter_gives_every_race_something`, not from this table.

### 10.4 The proposal: Skirmisher moves from Shaman (7) to Hunter (3)

Not Priest. Priest is the swap that was suggested, and it is the wrong one for
two reasons:

- **Priest is cloth.** Skirmisher is the mail chassis with 334 melee attack
  power. Priest could only replace *Adept*, and Adept→Priest scores 15 pairs
  against Mage's 14 — one better, and it moves the empty screen from Night Elf
  to Gnome rather than fixing it.
- **Paladin/Hunter/Priest scores highest on raw count (18) and still strands
  Gnome**, whose only mana classes in Wrath are Mage and Warlock. Trading a
  broken Night Elf for a broken Gnome is not progress.

Hunter fits Skirmisher's constraints exactly: **mail armour, mana** (Hunters do
not use focus until Cataclysm), and a melee-and-cast profile that is what
"trades blows and casts" describes.

What it buys:

- **Every race gets at least one body type.** This is the one that matters. A
  race with none is not a smaller version of a race with one — it is a character
  creation screen with nothing on it.
- **Sixteen missing datasets become thirteen.** About a fifth less of the work
  in §3, which is the bulk of the project.
- **Blood Elf and Draenei get all three**, so there is at least one race per
  faction where the choice is real.

### 10.5 What it costs, stated plainly

**The approved stat table does not change.** BODY-TYPES §2 sets Skirmisher's
targets absolutely — 6939 HP, 120 Str, 130 Sta and the rest — and the migration
writes those numbers whatever the underlying class is. What changes is only the
*annotation*: "bold = changed from stock" is currently a diff against Shaman and
would become a diff against Hunter. The tuning survives; the footnotes move.

Two real costs, neither fatal, both worth knowing before deciding:

1. **The attack-power formula is keyed on class.** AzerothCore computes melee AP
   from class-specific coefficients in `Player::UpdateAttackPowerAndDamage`, so
   Skirmisher's *derived* 334 AP figure would need recomputing against Hunter's
   coefficients even though its Strength and Agility are unchanged. That is an
   arithmetic re-check of one number, not a redesign — but it is a number
   BODY-TYPES publishes, so it should be re-derived rather than assumed to
   carry over.
2. **Hunter carries pet machinery.** The class has a pet from level 10 and the
   client shows a pet bar for it. On a classless realm where everyone gets every
   spell that may be a feature or an irrelevance, but it is a visible difference
   from Shaman and should be a decision rather than a surprise. Ranged-weapon
   assumptions (auto shot) are in the same category.

Neither of these touches the launcher or the recipe. They are `mod-classless`
and BODY-TYPES questions.

### 10.6 What I recommend

**Swap Skirmisher to Hunter.** It is the only one of the six combinations that
leaves no race stranded, it cuts the largest remaining piece of work by a fifth,
and it costs one re-derived number and a decision about pets.

If the pet machinery turns out to be unacceptable, the fallback is to keep
Shaman and accept sixteen datasets, because **Paladin/Shaman/Warlock is worse
on both counts** and Priest cannot be a mail chassis. There is no third option
hiding in the table.

Whichever way this goes, it changes `char_base_info.add` in the recipe and
nothing else in the launcher: the recipe is data, and this is exactly the kind
of change it exists to make cheap.

### 10.7 Decided: Hunter

Approved. Skirmisher is class 3.

Rebuilding the classes from scratch instead was considered and rejected: it is a
different scale of project, and it breaks the pattern that has kept every phase
of this maintainable — reuse Blizzard's systems, relabel through data.

The recipe changed and nothing else in the launcher did, which was the claim
made for it: `keep_classes` is `[2, 3, 8]`, the rename targets class 3, and the
sixteen added race rows became thirteen.

### 10.8 What the swap actually cost

Re-derived against `Entities/Unit/StatSystem.cpp` and `PlayerStorage.cpp` at the
pinned commit, rather than from the recollection §10.5 was written from. Two of
the three costs quoted there are zero, and one thing nobody quoted is not.

**Melee attack power: unchanged.** `Player::UpdateAttackPowerAndDamage` puts
Hunter and Shaman in the *same arm* of the same branch —
`level×2 + Str + Agi − 20`. §10.5 said the figure "should be re-derived rather
than assumed to carry over"; re-derived, it carries over exactly. 334 at 80,
either chassis.

**Mail proficiency: unchanged.** `CanUseItem` pairs them too — both
`ITEM_SUBCLASS_ARMOR_MAIL`.

**Ranged attack power: changed by 160 at level 80, and kept.** Hunter has its
own ranged formula, `level×2 + Agi − 10`, where Shaman falls to the general
`Agi − 10`. That takes the mail chassis from the worst ranged attack power of
the three (64, below the Vanguard's 80) to nearly triple the plate chassis's
(224).

It arrived with the class id rather than being chosen, and it is kept anyway:
a middle chassis described only as "between the other two" is the one nobody
picks for a reason, and this gives it a niche — it reaches — beside the
Vanguard's plate and the Adept's unrestricted casting. Decided 2026-09-03 and
written up as a deliberate trait in [BODY-TYPES §2.1](../BODY-TYPES.md), not as
an oversight to be tidied later. The alternative — answering the ranged branch
as Shaman through `OnPlayerIsClass` — is explicitly not taken.

**Pets: turned off, and that is the decision.** §10.5 flagged the pet machinery
as needing a call. It is made: `Classless.Chassis.HunterPets = 0`.

The reasoning is availability rather than taste. Before the swap the mail
chassis was Shaman and nobody on this realm could tame anything; the swap was
made so that Night Elves have a body type, not to hand one third of the
playerbase a companion the other two thirds cannot get. **A pet only Skirmishers
have is a class wearing a different word**, which is the one thing the body-type
design exists to prevent.

Implemented in `modules/mod-classless/src/ClasslessChassis.cpp` through
`OnPlayerIsClass` against `CLASS_CONTEXT_PET` — so no core modification, the
same property the rest of the module has. Taming fails and the stable master
declines. If pets should exist on Ashmorrow they belong in the ability trees for
every body type; that is a deliberate decision, a tree entry, and this one
config line.

One honest limit: the option governs *acquiring* a pet, not loading one that
already exists. `Player::LoadFromDB` reads the raw class id there, so a
character saved with a pet keeps it. On a realm where no Skirmisher has ever had
one that case cannot arise, and it is cheaper to say so than to chase it.

