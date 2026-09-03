/*
 * Copyright (C) 2026 The Tomorrow's Ash contributors
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * Tomorrow's Ash - Classless module
 *
 * Configuration holder. Read once on world load / config reload so that the
 * per-player hooks stay cheap - they run on hot paths.
 */

#ifndef TA_CLASSLESS_CONFIG_H
#define TA_CLASSLESS_CONFIG_H

#include "Define.h"

namespace TomorrowsAsh
{
    // The three body types (docs/BODY-TYPES.md), as class bits: Paladin (2),
    // Shaman (7), Mage (8). Bit 512 is unused in 3.3.5, which is why every
    // playable class is 1535 and not 2047.
    constexpr uint32 CLASSMASK_BODY_TYPES   = (1 << 1) | (1 << 6) | (1 << 7);
    constexpr uint32 CLASSMASK_ALL_PLAYABLE = 1535;

    struct ClasslessConfig
    {
        // Master switch. While false the module must not change any gameplay
        // behaviour - see docs/ARCHITECTURE.md "Fail-safe by default".
        bool Enable = false;

        // Tell players on login that the realm is running classless rules.
        bool Announce = true;

        // Zero out the Blizzard talent budget so the built-in talent frame is
        // empty. Safe to enable from Phase 2 onward - the classless budget is
        // now the replacement.
        bool SuppressBlizzardTalents = false;

        // Skill-point budget. The total is DERIVED from level on every read
        // rather than stored, so re-tuning these takes effect immediately.
        uint32 PointsFirstLevel = 10;
        uint32 PointsPerLevel   = 1;
        uint32 PointsBonus      = 0;

        // Cost in copper to respec. 0 = free.
        uint32 RespecCost = 0;

        // Let any body type equip librams, idols, totems and sigils.
        // Relics are the one gear category a data change cannot open: the
        // equip slot is chosen by a hardcoded class check in
        // Player::FindEquipSlot. See ClasslessRelics.cpp.
        bool OpenRelicSlot = false;

        // Classes this realm refuses at character creation, read back from
        // worldserver.conf so the module can check it rather than trust it.
        uint32 CreationDisabledClassMask = 0;

        // Core setting that deletes off-class spells on login. Must be off.
        bool ValidateSkillLearnedBySpells = true;

        // May the Skirmisher chassis tame and keep a hunter pet?
        //
        // Off by default, and the reason is that the chassis must not be a
        // class: before the swap from Shaman to Hunter nobody on this realm
        // could tame anything, and a body type that alone grants a companion
        // is a class wearing a different word. See
        // docs/decisions/0008-body-type-client-patch.md §10.
        bool ChassisHunterPets = false;

        // Points a character of this level is entitled to in total.
        [[nodiscard]] uint32 BudgetForLevel(uint8 level) const;

        // Log whether character creation is actually restricted to the three
        // body types. Reports, never enforces - the core owns that check.
        void CheckCreationClassMask() const;

        // Warn if the core is set to delete every off-class ability on login.
        void CheckSpellValidation() const;

        // Warn if a role still grants the permission that skips the class mask
        // check, which silently exempts every GM account from the restriction.
        void CheckCreationRbac() const;

        static ClasslessConfig& Instance();

        void Load();
    };
}

#define sClasslessConfig TomorrowsAsh::ClasslessConfig::Instance()

#endif // TA_CLASSLESS_CONFIG_H
