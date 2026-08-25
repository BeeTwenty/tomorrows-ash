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

    void ClasslessConfig::Load()
    {
        Enable                   = sConfigMgr->GetOption<bool>("Classless.Enable", false);
        Announce                 = sConfigMgr->GetOption<bool>("Classless.Announce", true);
        SuppressBlizzardTalents  = sConfigMgr->GetOption<bool>("Classless.SuppressBlizzardTalents", false);

        if (Enable)
        {
            LOG_INFO("module.classless", "[Classless] Enabled. SuppressBlizzardTalents={}", SuppressBlizzardTalents);
        }
        else
        {
            LOG_INFO("module.classless", "[Classless] Loaded but DISABLED - stock AzerothCore behaviour.");
        }
    }
}
