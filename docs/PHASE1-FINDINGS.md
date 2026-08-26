# Phase 1 findings — data-only prototype

**Status:** built, migrated, module verified loading. In-game play test blocked on client data.
**Core:** `azerothcore-wotlk` @ `e2f5e48b4375`

Phase 0 flagged three risks around `Player::learnSpell()`. Two are now settled
with evidence. One cannot be settled without a WoW client and is handed to you
as a test.

---

## 1. The cascade risk was overstated — settled

Phase 0 warned that granting one ability might drag in others, via
`GetNextSpellInChain()` and `GetSpellsRequiringSpellBounds()`
(`Player.cpp:3433-3450`). Reading the actual conditions:

```cpp
if (uint32 nextSpell = sSpellMgr->GetNextSpellInChain(spellId))
{
    PlayerSpellMap::iterator itr = m_spells.find(nextSpell);
    if (itr != m_spells.end() && itr->second->State != PLAYERSPELL_REMOVED
        && !itr->second->IsInSpec(m_activeSpec))
        learnSpell(nextSpell, temporary);
}
```

**Both branches require `itr != m_spells.end()` — the spell must already be
known.** The recursion exists to *re-activate* ranks a character already owns
in another spec, not to hand out new ones.

> **Granting an ability to a character who does not already know a higher rank
> causes no cascade at all. They get exactly the one spell.**

Verified against the real data with `tools/spell_cascade.py`:

| Ability | Chain | Dependencies | Cascade on grant |
|---|---|---|---|
| Fireball (133) | 16 ranks | none | none |
| Frostbolt (116) | 16 ranks | none | none |
| Holy Light (635) | 13 ranks | none | none |
| Mortal Strike (12294) | 8 ranks | none | none |
| Backstab (53) | 12 ranks | none | none |

`spell_required` has only 50 rows realm-wide and touches none of these.

**Consequence for Phase 2:** the skill-point budget does not need cascade
accounting. A node costs what it costs and grants what it says. That removes a
whole class of balance hole I had budgeted for.

---

## 2. Nothing gates ability level — anywhere — settled

Scanned the entire learn path for any level-related reference:

| Function | Lines | Level checks |
|---|---|---|
| `Player::addSpell` | 3147-3203 | **0** |
| `Player::_addSpell` | 3234-3401 | **0** |
| `Player::learnSpell` | 3412-3451 | **0** |

There is also no `SPELL_FAILED_LEVEL_REQUIREMENT` anywhere in `game/Spells/`,
so casting is not level-gated either.

> **A level 1 character can be granted, and can cast, rank 12 Fireball.**
> The `classless_node.required_level` column we added is the *only* thing
> preventing that.

This is a sharper constraint than expected and it shapes Phase 2: the budget
curve alone will not pace progression. Every node needs a deliberate
`required_level`, and that column is now load-bearing rather than cosmetic.

---

## 3. Spec masks — UNRESOLVED, needs your client

`Player::GetLearnSpellSpecMask()` (`Player.cpp:3453`) decides whether a spell is
learned globally or **into the active spec only**:

```cpp
bool const isTalentBasedSpell = GetTalentSpellCost(firstRankSpellId) > 0
                             || sSpellMgr->IsAdditionalTalentSpell(firstRankSpellId);
if (!isTalentBasedSpell)
    return SPEC_MASK_ALL;
uint8 specMask = GetActiveSpecMask();
```

`GetTalentSpellCost()` reads **Talent.dbc** (`DBCStores.cpp:686`), which only
exists once client data is extracted. It cannot be determined from SQL, so I
could not resolve this in the build sandbox.

**Why it matters:** if an ability is talent-derived, it is learned into the
current spec only and **disappears when the player switches spec** — while our
`classless_character_node` row still says they own it. The player would have
paid for an ability that vanishes.

**Mortal Strike (12294) is in the prototype specifically as the test case** — it
is a Warrior talent in stock WoW, so it is the most likely spell to exhibit
this. Fireball rank 1 is a baseline trainer spell and should be `SPEC_MASK_ALL`.

`.classless status` was added for exactly this check: it prints what our table
says you own alongside whether the spell is actually in your spellbook, and
flags mismatches in red.

---

## 4. What is verified, and what is not

**Verified in the sandbox:**

- All four SQL migrations applied by AzerothCore's own updater
  (`>> Applying update "2026_08_25_02_classless_prototype_data.sql"`)
- Module loads its data: `[Classless] Loaded 5 trees, 10 abilities`
- Config plumbed: `[Classless] Enabled. SuppressBlizzardTalents=false`
- Broker NPC row created (entry 900000, `ScriptName npc_ashmorrow_broker`)
- Command script linked into `worldserver`
- Full build green, zero core modifications

**NOT verified — needs a WoW 3.3.5a client:**

- Clicking the broker and learning through gossip
- Whether a Warrior can actually *cast* Fireball
- **Whether off-class abilities are useful or merely present** (see §5)
- Spec-mask behaviour (§3)

The server cannot start past `Failed to find map files for starting areas`
without extracted client data, so none of the above is reachable here. This is
a hard environment limit, not an oversight.

---

## 5. The thing to watch when you test

An off-class ability can be *present and useless*. A Mage who learns Mortal
Strike still has a Mage's attack power and weapon skill; a Warrior who learns
Fireball still has a Warrior's spell power (roughly none).

**That is the hidden-class-chassis problem showing up as concrete numbers for
the first time**, and it is exactly the input needed for the body-type stat
deltas you asked to approve. Please note actual tooltip numbers when you test —
a Warrior's Fireball damage vs a Mage's is the single most useful measurement
available right now.

---

## 6. Test checklist

Once client data is extracted (SETUP.md §5):

```
1. Enable the module
   dist/etc/modules/mod_classless.conf -> Classless.Enable = 1
   restart worldserver

2. Spawn a broker
   .npc add 900000

3. On a WARRIOR, talk to it. Expect: Fire / Frost / Holy / Sword Mastery / Stealth
   Learn "Fireball". Expect it in the spellbook.
   -> Does it CAST? What damage does the tooltip show?

4. .classless status
   Expect green "(in spellbook)". Red means the grant did not stick.

5. THE SPEC TEST (§3)
   .classless learn 401          (Mortal Strike, on a non-Warrior)
   switch talent spec, then:
   .classless status
   -> Red "MISSING FROM SPELLBOOK" confirms the spec-mask problem is real.
      That result is valuable - please report it either way.

6. Level gate
   On a level 1 character: .classless learn 102   (needs level 40)
   Expect refusal. If it succeeds, required_level is not being enforced.
```

GM commands: `.classless trees`, `.classless list <treeId>`,
`.classless learn <nodeId>`, `.classless status`, `.classless reload`.

---

## 7. Open design question for Phase 2

Rank chains have up to 16 entries and a node grants exactly one rank. So either:

- **a node per useful rank** — explicit, more rows, players re-buy to upgrade; or
- **one node, rank scales with level** — the module picks the best rank the
  character's level allows and re-grants on level up.

The second is better play experience and is not much more code, but it needs a
rule for what happens on respec. I lean towards it. Not urgent — it only has to
be settled before the real tree data is authored, and the prototype demonstrates
the tier approach in the meantime.
