/*
 * Tomorrow's Ash - Classless module
 *
 * GM commands for testing the classless system without hunting down a broker
 * NPC. These exist because the gossip flow cannot be exercised on a server
 * without client data loaded, so the first real verification happens on a
 * developer's machine - these make that fast.
 *
 * All commands are GM-gated and read the same data and rules as the gossip
 * path, so testing through them tests the real code.
 */

#include "ClasslessConfig.h"
#include "ClasslessMgr.h"
#include "Chat.h"
#include "CommandScript.h"
#include "Player.h"
#include "ScriptMgr.h"

using namespace Acore::ChatCommands;
using namespace TomorrowsAsh;

class classless_commandscript : public CommandScript
{
public:
    classless_commandscript() : CommandScript("classless_commandscript") { }

    ChatCommandTable GetCommands() const override
    {
        static ChatCommandTable classlessCommandTable =
        {
            { "trees",  HandleTreesCommand,  SEC_GAMEMASTER, Console::No },
            { "list",   HandleListCommand,   SEC_GAMEMASTER, Console::No },
            { "learn",  HandleLearnCommand,  SEC_GAMEMASTER, Console::No },
            { "status", HandleStatusCommand, SEC_GAMEMASTER, Console::No },
            { "reload", HandleReloadCommand, SEC_ADMINISTRATOR, Console::Yes },
        };

        static ChatCommandTable commandTable =
        {
            { "classless", classlessCommandTable },
        };

        return commandTable;
    }

    static bool RequireEnabled(ChatHandler* handler)
    {
        if (sClasslessConfig.Enable)
            return true;
        handler->SendSysMessage("Classless is disabled (Classless.Enable = 0).");
        handler->SetSentErrorMessage(true);
        return false;
    }

    static bool HandleTreesCommand(ChatHandler* handler)
    {
        if (!RequireEnabled(handler))
            return false;

        for (ClasslessTree const* tree : sClasslessMgr.GetTrees())
        {
            handler->PSendSysMessage("|cffffcc00%u|r - %s (%u abilities)",
                                     tree->Id, tree->Name.c_str(), uint32(tree->Nodes.size()));
        }
        return true;
    }

    static bool HandleListCommand(ChatHandler* handler, uint32 treeId)
    {
        if (!RequireEnabled(handler))
            return false;

        ClasslessTree const* tree = sClasslessMgr.GetTree(treeId);
        if (!tree)
        {
            handler->PSendSysMessage("No such tree: %u. Use .classless trees", treeId);
            handler->SetSentErrorMessage(true);
            return false;
        }

        Player* player = handler->GetSession()->GetPlayer();
        handler->PSendSysMessage("|cffffcc00%s|r", tree->Name.c_str());
        for (ClasslessNode const* node : tree->Nodes)
        {
            LearnCheck check = sClasslessMgr.CanLearn(player, *node);
            handler->PSendSysMessage("  |cffffcc00%u|r %s (spell %u, tier %u, cost %u) - %s",
                                     node->Id, node->Name.c_str(), node->SpellId,
                                     uint32(node->Tier), node->Cost,
                                     check == LearnCheck::Ok ? "available" : ClasslessMgr::Explain(check));
        }
        return true;
    }

    static bool HandleLearnCommand(ChatHandler* handler, uint32 nodeId)
    {
        if (!RequireEnabled(handler))
            return false;

        ClasslessNode const* node = sClasslessMgr.GetNode(nodeId);
        if (!node)
        {
            handler->PSendSysMessage("No such ability node: %u", nodeId);
            handler->SetSentErrorMessage(true);
            return false;
        }

        Player* player = handler->GetSession()->GetPlayer();
        LearnCheck result = sClasslessMgr.Learn(player, *node);

        if (result == LearnCheck::Ok)
        {
            handler->PSendSysMessage("Learned |cffffcc00%s|r (spell %u).",
                                     node->Name.c_str(), node->SpellId);
            return true;
        }

        handler->PSendSysMessage("%s", ClasslessMgr::Explain(result));
        handler->SetSentErrorMessage(true);
        return false;
    }

    static bool HandleStatusCommand(ChatHandler* handler)
    {
        if (!RequireEnabled(handler))
            return false;

        Player* player = handler->GetSession()->GetPlayer();
        uint32 owned = 0;

        for (ClasslessTree const* tree : sClasslessMgr.GetTrees())
        {
            for (ClasslessNode const* node : tree->Nodes)
            {
                if (!sClasslessMgr.HasNode(player, node->Id))
                    continue;
                ++owned;
                // HasSpell is the ground truth - if these ever disagree, the
                // spell was lost (spec switch is the suspected cause; see
                // docs/PHASE1-FINDINGS.md).
                handler->PSendSysMessage("  %s [%s] - spell %u %s",
                                         tree->Name.c_str(), node->Name.c_str(), node->SpellId,
                                         player->HasSpell(node->SpellId)
                                             ? "|cff00ff00(in spellbook)|r"
                                             : "|cffff2020(MISSING FROM SPELLBOOK)|r");
            }
        }

        if (!owned)
            handler->SendSysMessage("No classless abilities learned.");
        else
            handler->PSendSysMessage("%u classless abilities learned.", owned);

        return true;
    }

    static bool HandleReloadCommand(ChatHandler* handler)
    {
        sClasslessMgr.Load();
        handler->SendSysMessage("Classless trees reloaded from the database.");
        return true;
    }
};

void AddClasslessCommandScripts()
{
    new classless_commandscript();
}
