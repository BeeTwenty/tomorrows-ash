# ADR 0008 — Showing three body types at character creation

**Date:** 2026-09-01
**Status:** **Proposed — architecture only, no code written.** The brief asked
for this before implementation because it touches the verification model Phase 2
built.

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
