# 0009 — How the body-type patch is versioned, published and checked

**Status:** Proposed
**Supersedes nothing. Depends on [0010](0010-body-type-client-patch.md).**

ADR 0010 settled *what* the client patch is: a recipe of edits, applied to the
player's own DBCs, built into an archive locally. This settles the plumbing —
where the recipe is published, how a version increments, when the launcher
rebuilds, and how the result is verified.

One thing has to be said before the mechanics, because it changes a requirement:

> **The generated archive cannot be verified the way a base client file is.**

Tier 3 works by comparing a file against a hash *we publish*. We cannot publish a
hash for this archive: it is built from the player's own tables, and a repacked
or non-English client produces different bytes by design. The check is real, but
its anchor is local. §5.

---

## 1. Where the recipe lives

```
launcher/recipes/body-types.json     the recipe: the edits themselves
launcher/patch-manifest.json         the index: which recipes are published,
                                     at what version, with what hash
```

The repository is the source of truth. Both files are reviewed in a pull request
like any other change, which is the whole point of shipping instructions instead
of a binary: "rename class 2 to Vanguard, add Night Elf" is a readable diff.

## 2. Where the launcher fetches it from

**Through the manifest it already fetches.** `/api/launcher/manifest` gains a
`recipes` array beside `patches` and `runtime`, assembled from
`launcher/patch-manifest.json` exactly as the other two are assembled today
(`web/src/lib/launcher.ts`). One request, one channel, one truth.

The alternative was raw GitHub content or a release asset, and both were
rejected as the *primary* channel:

| | Website manifest | `raw.githubusercontent.com` | Release asset |
|---|---|---|---|
| Fits the existing update check | **yes, it is it** | new code path | new code path |
| One place that can disagree with another | none | two channels | two channels |
| Immutable per version | no, but the hash is | no — a branch moves | yes |
| Works before the site is deployed | **no** | yes | yes |
| Third party in the launch path | no | GitHub, rate-limited by IP | GitHub |

The one real advantage of the GitHub routes is the last row, and it is a real
advantage today because the site is not deployed. So:

**Recommendation.** The manifest is the channel. If the recipe is missing from
the manifest *and* the site was unreachable, the launcher may fall back to a
`recipe_fallback_url` carried in its own settings — off by default, pointing at
a tagged raw URL rather than a branch, so it is immutable. That keeps one
channel in normal operation and gives a way to test before the site exists,
without a second source of truth quietly disagreeing with the first.

A branch URL (`.../refs/heads/main/...`) is specifically **not** acceptable even
as a fallback: merging a pull request would immediately change every player's
character-creation screen with no staging step and no way to roll back except
another merge.

## 3. How a version increments

```jsonc
{
  "id": "body-types",
  "version": 3,                    // hand-edited, monotonic
  "revision": "9f1c2ab…",          // stamped by CI, never by hand
  …
}
```

**`version` is a monotonic integer, incremented in the same pull request that
changes anything else in the recipe.** It is the only thing the launcher
compares; everything else is detail.

**`revision` is the commit that last touched `launcher/recipes/`**, computed at
publish time by CI:

```sh
git log -1 --format=%H -- launcher/recipes/
```

Computed rather than written, because a hand-maintained revision can be wrong
and a computed one cannot. Given a `revision`, `git show <sha>` answers "what
exactly was version 3" without trusting anyone's memory.

**CI enforces the increment.** A pull request that changes `launcher/recipes/**`
without raising `version` fails, with the same posture as the other guards in
this repository: enforced rather than remembered. That is what makes "every
recipe change is traceable to a reviewed PR" true rather than aspirational.

**Prose is exempt, and has to be.** The guard compares the recipe with
`$comment`, `summary` and `revision` removed, because none of those change what
a player's client gets. Demanding a bump for a reworded comment would rebuild
the patch on every machine that has one — a worse outcome than the drift being
guarded against, and the guard proved the point by firing on a comment that had
only changed which ADR number it cited. Change anything the launcher acts on and
the bump is still required.

Optionally, tag published versions `recipe-v<N>`. Not required — `revision`
already gives traceability — but it makes the tagged raw URL in §2 possible and
costs one command.

This mirrors how server-side migrations already work here: generated, verified
against the database, reviewed as a diff.

## 4. When the launcher rebuilds

The built archive is a function of **two** inputs, not one: the recipe, and the
player's own tables. Both have to be in the trigger, and the second is the one
that is easy to forget and produces the worst failure — a patch silently built
from tables the client no longer has.

The launcher rebuilds when any of these is true:

1. it has no record of ever building this recipe;
2. the published `version` is higher than the one it recorded;
3. the output archive is missing;
4. the output archive's hash differs from the one recorded at build time;
5. **any source table's hash differs** from the one recorded at build time —
   the player repaired, repacked or reinstalled their client.

Its ledger entry therefore records all of it:

```jsonc
{
  "recipe_id": "body-types",
  "version": 3,
  "hash": "…",                       // of the archive it wrote
  "sources": [                       // what it was built from
    { "name": "DBFilesClient\\ChrClasses.dbc",
      "archive": "patch-enUS-3.MPQ", "hash": "…" },
    { "name": "DBFilesClient\\CharBaseInfo.dbc",
      "archive": "locale-enUS.MPQ",  "hash": "…" }
  ]
}
```

`launcher_core::recipe::Built` is that structure, and it is already produced by
`recipe::build`.

**Before writing, the launcher checks the slot.** `patch-4.MPQ` is a convention,
which means every custom server uses it; a player who also plays elsewhere very
likely has one. If the slot holds an archive that is not ours, the launcher says
so and stops rather than overwriting someone else's work
(`recipe::would_clobber`). ADR 0010 §7.

## 5. How the result is verified

Three different things are verified, in three different ways, and conflating
them is how this goes wrong:

| What | Tier | Anchored against |
|---|---|---|
| The **recipe** — our content, fetched over https | 3, as today | a hash we publish in the manifest |
| The player's **source tables** | — | recorded at build time, compared on every start |
| The **built archive** | **3b (new)** | the hash the launcher computed when it built it |

Tier 3b is blocking, like Tier 3: a corrupt or foreign archive in our slot stops
the launch rather than warning. What makes it meaningful — rather than a
tautology in which we check our own output against our own record of our own
output — is that **`mpq::write` is deterministic**. Same recipe, same source
tables, byte-identical archive; there is a test for it. So "rebuild and compare"
detects a corrupted file, a half-written file, and another server's patch, and
the only thing it cannot detect is a recipe that was wrong when it arrived —
which is what the manifest hash on the recipe is for.

The launch bar will not say `LAUNCH` until the archive is in place and matches,
the same rule the Wine prefix already follows, and for the same reason: a client
that reaches the character-creation screen showing ten classes on a three-class
realm is a worse outcome than one that has not started.

## 6. Sequencing

The client patch **hides**; it does not enforce. A player with an unpatched
client sees all ten classes and can create any of them. Enforcement is
`mod-classless` rejecting the create packet.

So the order is not negotiable:

1. `inspect-dbc` against a real client — confirm the matrix and the field layout
   the recipe carries. *Built; needs a client run.*
2. The chassis decision (ADR 0010 §10) — it changes how much of step 3 there is.
3. Server-side: `playercreateinfo` and friends for every new race/class pair,
   and the create-packet rule. **The bulk of the work, and not launcher work.**
4. Publish the recipe and turn on the launcher step.

Publishing the recipe before step 3 would give players a character-creation
screen offering combinations the server then refuses — which is worse than the
current state, where the screen is honest about what it will accept.

## 7. What this costs if it is wrong

The failure mode worth naming: a recipe with a wrong `name_field` renames the
wrong column, and the client shows a character-creation screen with blank or
garbled class names. `recipe::apply` refuses rather than applying when the field
is out of range or the column it points at holds no name in this client, and
`inspect-dbc` finds the column independently so the two can be compared. But
neither is a substitute for one person running the tool against a real client
once, which is why §6 starts there.

**That run happened on 2026-09-03, and both halves were wrong.** The recipe said
`name_field: 5` and the right answer is 4; the tool's own search said 3. Neither
guard caught it:

- `apply`'s refusal tests whether *any* of the sixteen locale columns from
  `name_field` holds a name. Starting one column late, the block still overlaps
  fifteen real locale columns, so the test passes. It would have written the
  name into columns 5–20, left the enUS name at column 4 untouched, and
  overwritten the string-flags word at 20. The visible symptom would have been
  *nothing changing*, with a corrupted table underneath.
- `inspect-dbc` took the first column that held plausible text. `ChrClasses`
  has two string columns and the wrong one — `PetNameToken` at 3 — comes first.

So the comparison in §6 step 1 was real and it worked: a human ran the tool,
disbelieved the output, and stopped. What has changed is that neither number is
a judgement call any more. The column is identified by shape (sixteen locale
columns of which a single-locale client populates exactly one), the report
prints every candidate with its evidence rather than only the winner, and the
recipe's `name_field` is asserted against a fixture built from the core's own
format string rather than from the recipe. `docs/decisions/0010-body-type-client-patch.md` §7.1.
