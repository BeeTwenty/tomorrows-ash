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
 */

#include "ClasslessConfig.h"
#include "Config.h"
#include "Log.h"

namespace TomorrowsAsh
{
    ClasslessConfig& ClasslessConfig::Instance()
    {
        static ClasslessConfig instance;
        return instance;
    }

    uint32 ClasslessConfig::BudgetForLevel(uint8 level) const
    {
        if (level < PointsFirstLevel)
            return PointsBonus;

        return (level - PointsFirstLevel + 1) * PointsPerLevel + PointsBonus;
    }

    void ClasslessConfig::Load()
    {
        Enable                   = sConfigMgr->GetOption<bool>("Classless.Enable", false);
        Announce                 = sConfigMgr->GetOption<bool>("Classless.Announce", true);
        SuppressBlizzardTalents  = sConfigMgr->GetOption<bool>("Classless.SuppressBlizzardTalents", false);
        PointsFirstLevel         = sConfigMgr->GetOption<uint32>("Classless.Points.FirstLevel", 10);
        PointsPerLevel           = sConfigMgr->GetOption<uint32>("Classless.Points.PerLevel", 1);
        PointsBonus              = sConfigMgr->GetOption<uint32>("Classless.Points.Bonus", 0);
        RespecCost               = sConfigMgr->GetOption<uint32>("Classless.Respec.Cost", 0);
        ChassisHunterPets        = sConfigMgr->GetOption<bool>("Classless.Chassis.HunterPets", false);

        if (Enable)
        {
            LOG_INFO("module.classless",
                     "[Classless] Enabled. Budget: {} point(s)/level from level {}, +{} bonus. "
                     "SuppressBlizzardTalents={}, ChassisHunterPets={}",
                     PointsPerLevel, PointsFirstLevel, PointsBonus, SuppressBlizzardTalents,
                     ChassisHunterPets);
        }
        else
        {
            LOG_INFO("module.classless", "[Classless] Loaded but DISABLED - stock AzerothCore behaviour.");
        }
    }
}
