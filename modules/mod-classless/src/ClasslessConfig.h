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

        // Points a character of this level is entitled to in total.
        [[nodiscard]] uint32 BudgetForLevel(uint8 level) const;

        static ClasslessConfig& Instance();

        void Load();
    };
}

#define sClasslessConfig TomorrowsAsh::ClasslessConfig::Instance()

#endif // TA_CLASSLESS_CONFIG_H
