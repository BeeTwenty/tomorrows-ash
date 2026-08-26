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

        if (Enable)
        {
            LOG_INFO("module.classless",
                     "[Classless] Enabled. Budget: {} point(s)/level from level {}, +{} bonus. "
                     "SuppressBlizzardTalents={}",
                     PointsPerLevel, PointsFirstLevel, PointsBonus, SuppressBlizzardTalents);
        }
        else
        {
            LOG_INFO("module.classless", "[Classless] Loaded but DISABLED - stock AzerothCore behaviour.");
        }
    }
}
