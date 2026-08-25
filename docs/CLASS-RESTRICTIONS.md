# How class restrictions are actually enforced in AzerothCore

**Status:** Phase 0 research — complete
**Core audited:** `azerothcore-wotlk` @ `e2f5e48b4375` (2026-08-25), client 3.3.5a
**Why this exists:** the mandate is to prefer data/SQL over core C++ forks. That
choice can only be made from evidence, so this maps every place the server says
"you are the wrong class for this" before any code is written.

All line numbers refer to the pinned commit above. Paths are relative to
`.acore/src/server/`.

---

## 1. The headline finding

> **Spell ownership is not class-gated at all.**

`Player::addSpell()`, `Player::_addSpell()` and `Player::learnSpell()` contain
**zero** class or race checks. They validate that the spell exists and is
well-formed, then add it to the character.

| Function | Location | Class/race gate? |
|---|---|---|
| `Player::addSpell` | `game/Entities/Player/Player.cpp:3147-3203` | none |
| `Player::_addSpell` | `game/Entities/Player/Player.cpp:3234-3401` | none |
| `Player::learnSpell` | `game/Entities/Player/Player.cpp:3412-3450` | none |

Verified by scanning each full function body for `ClassMask`, `classMask`,
`getClass`, `IsClass`, `RaceMask`, `getRace` and `IsSpellFitByClassAndRace` —
no matches.

**Consequence:** a module can already teach a Warrior *Fireball* today, with no
core modification whatsoever. Class identity in WoW is not enforced at the
"which spells do you own" layer. It is enforced entirely at the **acquisition
paths** — the specific places a player is allowed to *obtain* a spell.

That reframes the whole project. We do not need to tear down a restriction
system. We need to **add a new acquisition path** and leave the old ones alone.

---

## 2. Enforcement map

Five places enforce class identity. Each is classified by where the rule
actually lives — SQL, DBC, or compiled C++.

### 2.1 Trainers — DBC-driven, read by C++

`Player::IsSpellFitByClassAndRace()` — `game/Entities/Player/Player.cpp:12610`

```cpp
SkillLineAbilityMapBounds bounds = sSpellMgr->GetSkillLineAbilityMapBounds(spell_id);
if (bounds.first == bounds.second)
    return true;                       // <- spell in no skill line: allowed for everyone
for (...) {
    if (_spell_idx->second->RaceMask  && (RaceMask  & racemask)  == 0) continue;
    if (_spell_idx->second->ClassMask && (ClassMask & classmask) == 0) continue;
    if (!GetSkillRaceClassInfo(SkillLine, getRace(), getClass()))      continue;
    return true;
}
return false;
```

Data source: `SkillLineAbility.dbc` (`RaceMask`, `ClassMask`) plus
`SkillRaceClassInfo.dbc`. Both are **client-shipped DBC files** the server
reads from its `dbc/` directory.

Called from exactly two places, both trainer code:
- `game/Entities/Creature/Trainer.cpp:48` — building the trainer's spell list
- `game/Entities/Creature/Trainer.cpp:160` — validating a purchase

There is **no script hook** on this function.

> **Note the early return on line 12617.** A spell that appears in *no*
> `SkillLineAbility` row is unrestricted. This is a useful escape hatch for
> custom abilities we invent later.

### 2.2 The talent frame — DBC-driven, hard-coded gate

`Player::LearnTalent()` — `game/Entities/Player/Player.cpp:14260`

```cpp
if (!sScriptMgr->OnPlayerCanLearnTalent(this, talentInfo, talentRank))
    return;                                            // hook fires HERE...
TalentTabEntry const* talentTabInfo = sTalentTabStore.LookupEntry(talentInfo->TalentTab);
...
// xinef: prevent learn talent for different class (cheating)
if ((getClassMask() & talentTabInfo->ClassMask) == 0)
    return;                                            // ...but the gate is HERE
```

Data source: `TalentTab.dbc` (`ClassMask`).

The `OnPlayerCanLearnTalent` hook fires *before* the class check and can only
return `false` to **deny**. It cannot grant. So the talent-frame gate at
`Player.cpp:14290` is **not bypassable from a module**.

**But this barely matters**, because of a client-side constraint that is more
important than the server one — see §3.

### 2.3 Talent point budget — hooked, fully module-controllable

`Player::CalculateTalentsPoints()` — `game/Entities/Player/Player.cpp` (near 12570)

```cpp
talentPointsForLevel += m_extraBonusTalentCount;
sScriptMgr->OnPlayerCalculateTalentsPoints(this, talentPointsForLevel);
return uint32(talentPointsForLevel * sWorld->getRate(RATE_TALENT));
```

The hook receives `uint32&` — a module can set the budget to anything,
including zero. **This is how we retire the Blizzard talent tree without a
core patch.** Already wired up in `mod-classless` behind
`Classless.SuppressBlizzardTalents`.

### 2.4 Item equip and use — SQL-driven

`Player::CanUseItem(ItemTemplate const*)` — `game/Entities/Player/PlayerStorage.cpp:2353`

```
line 2372:  if ((proto->AllowableClass & getClassMask()) == 0 || ...)
                return EQUIP_ERR_YOU_CAN_NEVER_USE_THAT_ITEM;   // <- early return
...
line 2407:  if (!sScriptMgr->OnPlayerCanUseItem(this, proto, result))
                return result;                                   // <- hook, too late
```

Data source: **`item_template.AllowableClass`** — a plain SQL column, loaded at
`game/Globals/ObjectMgr.cpp:3385`.

The `OnPlayerCanUseItem` hook sits at line 2407, **after** the class gate
returns at 2372. Combined with the hook dispatch semantics (§2.6), a module can
never loosen an item restriction.

**Therefore item restrictions must be changed in SQL.** That is exactly the
data-driven path the mandate prefers, so this is a good outcome, not a problem.

Other sites reading the same column:
| Site | Location | Effect |
|---|---|---|
| LFG need-roll | `PlayerStorage.cpp:2442` | can't roll Need on off-class gear |
| BoP loot binding | `Player.cpp:10909` | won't soulbind off-class items |
| Vendor purchase | `Handlers/ItemHandler.cpp:911` | same, at vendors |
| Auction search | `AuctionHouse/AuctionHouseSearcher.cpp:672` | "usable only" filter |

All four read `AllowableClass`, so one SQL change fixes all of them coherently.

### 2.5 Skill-reward spells and the starting kit

`Player::learnSkillRewardedSpells()` — `game/Entities/Player/Player.cpp:12231`,
class gate at **12265**. Reads `SkillLineAbility.dbc` again. Governs spells
granted automatically when a skill is learned or levels up.

Character creation is **pure SQL**, loaded in `game/Globals/ObjectMgr.cpp`:

| Table | Loader | Contents |
|---|---|---|
| `playercreateinfo` | `:4360` | start map/zone/position per race+class |
| `playercreateinfo_item` | `:4447` | starting items |
| `playercreateinfo_skills` | `:4518` | starting skills (uses raceMask/classMask) |
| `playercreateinfo_spell_custom` | `:4593` | starting spells (uses racemask/classmask) |

These are fully editable with `UPDATE` statements. No core involvement.

### 2.6 Hook dispatch semantics — the rule that shapes everything

`game/Scripting/ScriptMgrMacros.h:76`

```cpp
#define CALL_ENABLED_BOOLEAN_HOOKS(scriptType, hookType, action) \
    if (ScriptRegistry<scriptType>::EnabledHooks[hookType].empty()) \
        return true; \
    for (auto const& script : ...) { if (action) return false; } \
    return true;
```

**Boolean script hooks can only veto, never grant.** Any hook named
`OnPlayerCanX` is a one-way valve: a module can add a restriction, never remove
one. This single fact determines that every *loosening* we want must come from
data (SQL/DBC) or from a new acquisition path we control — never from a hook.

---

## 3. The constraint that is not in the server at all

The 3.3.5a client renders the talent window from **its own local DBCs**, keyed
off the character's class. Even if the server permitted a Warrior to learn a
Frost talent, the client would not draw the Frost tree for that Warrior, and
the player would have nowhere to click.

The same applies to the spellbook's tab layout and to trainer windows.

**This is the real reason not to build the classless system on top of Blizzard
talents.** It is not a server limitation we could patch around; it is client
behaviour, and changing it means shipping a custom MPQ patch that every player
must install. That is a distribution problem, not a coding problem, and it is
the single biggest threat to "eventually a public community server".

Server-authoritative surfaces that need **no** client modification:
- **NPC gossip menus** — arbitrary menu trees, driven entirely by the server
- **Chat commands** — `.classless learn fireball`
- **Spellbook contents** — a learned spell always appears, regardless of class

Surfaces that **do** need a client addon or patch:
- The talent frame
- Any custom panel/UI (needs an addon, e.g. AIO, which players must install)

---

## 4. Verdict: what can be done without forking the core

| Capability we need | Mechanism | Core patch? |
|---|---|---|
| Give any character any spell | `Player::learnSpell()` — already unguarded | **No** |
| Custom ability shop / trees | Own gossip NPC, calls `learnSpell` | **No** |
| Retire Blizzard talents | `OnPlayerCalculateTalentsPoints` → 0 | **No** |
| Skill-point budget + spend tracking | Own module tables in `characters` DB | **No** |
| Cross-class gear usability | `UPDATE item_template SET AllowableClass` | **No** (SQL) |
| Armor/weapon proficiency | Grant proficiency spells via `learnSpell` | **No** |
| Custom starting kit | `playercreateinfo_*` SQL | **No** (SQL) |
| Cross-class *Blizzard* talent trees | `Player.cpp:14290` | **Yes — and pointless**, client won't render them |

**Conclusion: the classless system is achievable as a pure AzerothCore module
plus SQL, with zero core modifications**, provided we accept one design
constraint: we build our own ability-acquisition UI (gossip first, addon later)
instead of reusing Blizzard's talent frame.

This is a better outcome than expected going in, and it is what makes staying
current with upstream realistic.

---

## 5. Risks this investigation surfaced

1. **Spell rank chains.** `learnSpell` auto-learns higher ranks via
   `GetNextSpellInChain` (`Player.cpp:3434`) and dependent spells via
   `GetSpellsRequiringSpellBounds` (`Player.cpp:3444`). Granting one ability may
   cascade. Every grant must be tested for what it drags in.

2. **Spec masks.** `GetLearnSpellSpecMask` (`Player.cpp:3453`) treats
   talent-derived spells differently — they are learned per-spec, not globally.
   Abilities we hand out that Blizzard classified as talents may vanish on spec
   switch. Needs explicit handling.

3. **Passive class scaling is invisible.** Attack power per Strength, spell
   crit per Intellect, mana per Spirit and base stats all come from the
   character's *class*, via `playercreateinfo_levelstats`, `player_classlevelstats`
   and hardcoded coefficients in `Player::UpdateAttackPowerAndDamage()`. A
   classless character still has a hidden class chassis underneath. **Balance
   will be dominated by which class the character secretly is**, long before
   the ability pool matters. This is the largest unsolved design question and
   it is a product decision, not a coding one.

4. **`AllowableClass` rewrites are broad.** Making gear class-agnostic touches
   tens of thousands of rows and interacts with loot, LFG rolls and the auction
   house. Must be a generated, reversible migration — never hand-edited.
