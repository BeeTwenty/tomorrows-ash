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

        // Points a character of this level is entitled to in total.
        [[nodiscard]] uint32 BudgetForLevel(uint8 level) const;

        static ClasslessConfig& Instance();

        void Load();
    };
}

#define sClasslessConfig TomorrowsAsh::ClasslessConfig::Instance()

#endif // TA_CLASSLESS_CONFIG_H
