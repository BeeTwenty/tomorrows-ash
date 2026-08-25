/*
 * Tomorrow's Ash - Classless module
 *
 * Phase 0: module skeleton.
 *
 * The only behaviour wired up so far is configuration loading, a login notice,
 * and the Blizzard-talent-budget suppression hook that Phase 2 will build on.
 * No spell, talent or item rules are changed yet - see docs/ROADMAP.md.
 *
 * Design rule for this module (docs/ARCHITECTURE.md): every hook must be a
 * no-op while Classless.Enable is 0, so that dropping the module into a stock
 * realm is always safe.
 */

#include "ClasslessConfig.h"
#include "Chat.h"
#include "Player.h"
#include "ScriptMgr.h"

using namespace TomorrowsAsh;

class ClasslessWorldScript : public WorldScript
{
public:
    ClasslessWorldScript() : WorldScript("ClasslessWorldScript", { WORLDHOOK_ON_AFTER_CONFIG_LOAD }) { }

    void OnAfterConfigLoad(bool /*reload*/) override
    {
        sClasslessConfig.Load();
    }
};

class ClasslessPlayerScript : public PlayerScript
{
public:
    ClasslessPlayerScript() : PlayerScript("ClasslessPlayerScript",
        {
            PLAYERHOOK_ON_LOGIN,
            PLAYERHOOK_ON_CALCULATE_TALENTS_POINTS
        }) { }

    void OnPlayerLogin(Player* player) override
    {
        if (!sClasslessConfig.Enable || !sClasslessConfig.Announce)
            return;

        ChatHandler(player->GetSession()).SendSysMessage(
            "|cff00ff00[Ashmorrow]|r This realm runs the |cffffcc00classless|r ruleset.");
    }

    // Replaces the Blizzard talent budget. Because AzerothCore exposes this as
    // a hook, suppressing the built-in talent tree needs no core modification.
    void OnPlayerCalculateTalentsPoints(Player const* /*player*/, uint32& talentPointsForLevel) override
    {
        if (!sClasslessConfig.Enable || !sClasslessConfig.SuppressBlizzardTalents)
            return;

        talentPointsForLevel = 0;
    }
};

void Addmod_classlessScripts()
{
    new ClasslessWorldScript();
    new ClasslessPlayerScript();
}
