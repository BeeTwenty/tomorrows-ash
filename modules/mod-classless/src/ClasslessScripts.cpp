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
 * Phase 1: data-only prototype.
 *
 * Abilities are granted from database rows through a gossip NPC. No core
 * modification is involved - Player::learnSpell() has no class check
 * (docs/CLASS-RESTRICTIONS.md), which is the entire basis of this design.
 *
 * Design rule (docs/ARCHITECTURE.md): every hook must be a no-op while
 * Classless.Enable is 0, so dropping this module into a stock realm is safe.
 */

#include "ClasslessConfig.h"
#include "ClasslessMgr.h"
#include "Chat.h"
#include "Player.h"
#include "ScriptMgr.h"

using namespace TomorrowsAsh;

class ClasslessWorldScript : public WorldScript
{
public:
    ClasslessWorldScript() : WorldScript("ClasslessWorldScript",
        {
            WORLDHOOK_ON_AFTER_CONFIG_LOAD
        }) { }

    void OnAfterConfigLoad(bool /*reload*/) override
    {
        sClasslessConfig.Load();

        // Tree data is loaded regardless of the master switch so that
        // configuration problems surface in the log at startup rather than the
        // first time somebody enables the module on a live realm.
        sClasslessMgr.Load();
    }
};

class ClasslessPlayerScript : public PlayerScript
{
public:
    ClasslessPlayerScript() : PlayerScript("ClasslessPlayerScript",
        {
            PLAYERHOOK_ON_LOGIN,
            PLAYERHOOK_ON_LOGOUT,
            PLAYERHOOK_ON_CALCULATE_TALENTS_POINTS
        }) { }

    void OnPlayerLogin(Player* player) override
    {
        if (!sClasslessConfig.Enable)
            return;

        sClasslessMgr.LoadCharacter(player);

        if (sClasslessConfig.Announce)
        {
            ChatHandler(player->GetSession()).SendSysMessage(
                "|cff00ff00[Ashmorrow]|r This realm runs the |cffffcc00classless|r ruleset. "
                "Seek an Ability Broker to learn from any discipline.");
        }
    }

    void OnPlayerLogout(Player* player) override
    {
        sClasslessMgr.UnloadCharacter(player->GetGUID().GetCounter());
    }

    // Replaces the Blizzard talent budget. Because AzerothCore exposes this as
    // a hook, retiring the built-in talent tree needs no core modification.
    void OnPlayerCalculateTalentsPoints(Player const* /*player*/, uint32& talentPointsForLevel) override
    {
        if (!sClasslessConfig.Enable || !sClasslessConfig.SuppressBlizzardTalents)
            return;

        talentPointsForLevel = 0;
    }
};

// Defined in their own translation units
void AddClasslessBrokerScripts();
void AddClasslessCommandScripts();

void Addmod_classlessScripts()
{
    new ClasslessWorldScript();
    new ClasslessPlayerScript();
    AddClasslessBrokerScripts();
    AddClasslessCommandScripts();
}
