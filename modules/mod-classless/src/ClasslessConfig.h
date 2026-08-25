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
        // empty. Only meaningful once the replacement system exists.
        bool SuppressBlizzardTalents = false;

        static ClasslessConfig& Instance();

        void Load();
    };
}

#define sClasslessConfig TomorrowsAsh::ClasslessConfig::Instance()

#endif // TA_CLASSLESS_CONFIG_H
