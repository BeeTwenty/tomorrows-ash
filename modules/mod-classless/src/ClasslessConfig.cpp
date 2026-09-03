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
#include "DatabaseEnv.h"
#include "Field.h"
#include "Log.h"
#include "QueryResult.h"
#include "RBAC.h"

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
        OpenRelicSlot            = sConfigMgr->GetOption<bool>("Classless.OpenRelicSlot", false);
        ChassisHunterPets        = sConfigMgr->GetOption<bool>("Classless.Chassis.HunterPets", false);

        // Not ours - this is a core setting, read here only so the module can
        // report whether it is actually in effect. See CheckCreationClassMask.
        CreationDisabledClassMask =
            sConfigMgr->GetOption<uint32>("CharacterCreating.Disabled.ClassMask", 0, false);
        ValidateSkillLearnedBySpells =
            sConfigMgr->GetOption<bool>("ValidateSkillLearnedBySpells", true, false);

        if (Enable)
        {
            LOG_INFO("module.classless",
                     "[Classless] Enabled. Budget: {} point(s)/level from level {}, +{} bonus. "
                     "SuppressBlizzardTalents={} OpenRelicSlot={} ChassisHunterPets={}",
                     PointsPerLevel, PointsFirstLevel, PointsBonus, SuppressBlizzardTalents,
                     OpenRelicSlot, ChassisHunterPets);
        }
        else
        {
            LOG_INFO("module.classless", "[Classless] Loaded but DISABLED - stock AzerothCore behaviour.");
        }

        CheckCreationClassMask();
        CheckCreationRbac();
        CheckSpellValidation();
    }

    void ClasslessConfig::CheckCreationRbac() const
    {
        // The classmask can be perfectly configured and still never run.
        //
        // HandleCharCreateOpcode only consults it when the account LACKS RBAC
        // permission 15 (CharacterHandler.cpp:344). Stock AzerothCore attaches
        // that permission to "Role: Sec Level Moderator", and the roles nest -
        // Administrator -> Gamemaster -> Moderator -> Player - so every
        // account at gmlevel 1 or above skips the check while a gmlevel 0
        // player is blocked correctly.
        //
        // On a realm run by its owner, the person doing the testing is the one
        // account the restriction does not apply to. That is exactly how this
        // was reported: the config was right, the log said restricted, and a
        // Warrior still created.
        if (!Enable)
            return;

        QueryResult result = LoginDatabase.Query(
            "SELECT COUNT(*) FROM rbac_linked_permissions WHERE linkedId = {}",
            uint32(rbac::RBAC_PERM_SKIP_CHECK_CHARACTER_CREATION_CLASSMASK));

        if (!result)
            return;                             // cannot tell; do not cry wolf

        Field* fields = result->Fetch();
        if (!fields[0].Get<uint64>())
            return;                             // nobody can skip the check

        LOG_ERROR("module.classless",
                  "[Classless] Character creation is restricted, but RBAC permission {} "
                  "(skip character creation class mask check) is still granted through a role. "
                  "Any account at gmlevel 1 or above - including yours - bypasses the "
                  "restriction entirely and can create any class. The classmask above is "
                  "correct and simply never consulted for those accounts.",
                  uint32(rbac::RBAC_PERM_SKIP_CHECK_CHARACTER_CREATION_CLASSMASK));
        LOG_ERROR("module.classless",
                  "[Classless] Fix: apply the module's db-auth migration "
                  "(2026_09_01_00_classless_creation_rbac.sql) and restart, or test with a "
                  "gmlevel 0 account.");
    }

    void ClasslessConfig::CheckSpellValidation() const
    {
        // The quietest way this realm can lose player data.
        //
        // Player::_LoadSpells runs CheckSkillLearnedBySpell over every stored
        // spell on every login (PlayerStorage.cpp:6610). That asks
        // GetSkillRaceClassInfo whether the spell's skill line is valid for the
        // character's race and class - and for an off-class ability bought from
        // the broker, it never is. The spell is then deleted from
        // character_spell outright. The player logs in one day missing what
        // they spent points on, and the only trace is a single LOG_ERROR.
        //
        // Off-class spells are the whole realm, so this guard has to be off.
        if (!Enable || !ValidateSkillLearnedBySpells)
            return;

        LOG_ERROR("module.classless",
                  "[Classless] ValidateSkillLearnedBySpells is ON. Every off-class ability "
                  "bought from a broker will be DELETED from character_spell at the player's "
                  "next login (Player::_LoadSpells). Set ValidateSkillLearnedBySpells = 0 "
                  "in worldserver.conf, or run `ta.py conf`, and restart.");
    }

    void ClasslessConfig::CheckCreationClassMask() const
    {
        // Why the module audits a setting it does not own.
        //
        // A realm ran a whole playtest with character creation wide open. The
        // value was right in the repo, right in worldserver.conf.dist, and
        // right on the machine that generated it - but the deployed
        // worldserver.conf had been written before the setting existed, and
        // nothing rewrote it or said so. The config was verified; the realm
        // was not.
        //
        // So the server now states, every start, whether the restriction it is
        // running with is the one the design asks for. A log line beats a
        // verification somebody has to remember to repeat.
        uint32 const allowed = CLASSMASK_BODY_TYPES;
        uint32 const expected = CLASSMASK_ALL_PLAYABLE & ~allowed;

        if (!Enable)
            return;

        // Always name the file. On Windows ConfigMgr::GetConfigPath() returns
        // the RELATIVE "configs/" (Config.cpp:709), so the config a server
        // reads depends on the directory it was launched from - and an MSBuild
        // build leaves a second copy in build/bin/<Config>/configs/ that
        // `ta.py conf` never touched. "I edited the config" and "the server
        // read my edit" are different claims, and only the server can settle
        // the second one.
        LOG_INFO("module.classless", "[Classless] Config in effect: {}", sConfigMgr->GetFilename());

        if (CreationDisabledClassMask == expected)
        {
            LOG_INFO("module.classless",
                     "[Classless] Character creation is limited to the three body types "
                     "(CharacterCreating.Disabled.ClassMask = {}).", expected);
            return;
        }

        LOG_ERROR("module.classless",
                  "[Classless] CHARACTER CREATION IS NOT RESTRICTED. "
                  "CharacterCreating.Disabled.ClassMask is {}, expected {}. "
                  "Players can create any class, not just the three body types.",
                  CreationDisabledClassMask, expected);
        LOG_ERROR("module.classless",
                  "[Classless] The file above is the one to fix - NOT necessarily the one "
                  "`ta.py conf` writes. Run `ta.py doctor` to see every copy on disk.");

        for (uint32 classId = 1; classId <= 11; ++classId)
        {
            if (classId == 10)
                continue;                       // no class 10 in 3.3.5
            uint32 const bit = 1 << (classId - 1);
            if (!(allowed & bit) && !(CreationDisabledClassMask & bit))
                LOG_ERROR("module.classless",
                          "[Classless]   class {} is creatable and should not be.", classId);
        }
    }
}
