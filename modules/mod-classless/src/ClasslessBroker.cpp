/*
 * Tomorrow's Ash - Classless module
 *
 * The Ashmorrow Ability Broker: the NPC players use to learn abilities from any
 * tree regardless of class.
 *
 * Gossip is used rather than Blizzard's talent frame because the 3.3.5a client
 * renders that frame from local class-keyed DBCs - a Warrior client will not
 * draw a Frost tree no matter what the server permits. Gossip is entirely
 * server-driven and works on an unmodified client
 * (docs/decisions/0003-no-blizzard-talents.md).
 */

#include "ClasslessConfig.h"
#include "ClasslessMgr.h"
#include "Chat.h"
#include "Player.h"
#include "ScriptMgr.h"
#include "ScriptedGossip.h"

using namespace TomorrowsAsh;

namespace
{
    constexpr uint32 BROKER_NPC_TEXT = 900000;

    // Gossip carries two uint32s: sender and action. We use sender to say which
    // menu we are in and action to carry the id, which keeps the handler flat.
    enum BrokerMenu : uint32
    {
        MENU_TREE_LIST = GOSSIP_SENDER_MAIN + 100,  // action = unused
        MENU_TREE      = GOSSIP_SENDER_MAIN + 101,  // action = tree id
        MENU_LEARN     = GOSSIP_SENDER_MAIN + 102,  // action = node id
    };

    void SendTreeList(Player* player, Creature* creature)
    {
        ClearGossipMenuFor(player);

        for (ClasslessTree const* tree : sClasslessMgr.GetTrees())
        {
            AddGossipItemFor(player, GOSSIP_ICON_TRAINER,
                             tree->Name, MENU_TREE, tree->Id);
        }

        SendGossipMenuFor(player, BROKER_NPC_TEXT, creature->GetGUID());
    }

    void SendTree(Player* player, Creature* creature, uint32 treeId)
    {
        ClasslessTree const* tree = sClasslessMgr.GetTree(treeId);
        if (!tree)
        {
            SendTreeList(player, creature);
            return;
        }

        ClearGossipMenuFor(player);

        for (ClasslessNode const* node : tree->Nodes)
        {
            LearnCheck check = sClasslessMgr.CanLearn(player, *node);

            // The menu tells the player why something is unavailable rather
            // than hiding it - a tree you cannot see is a tree you cannot plan
            // towards.
            std::string label;
            uint32 icon = GOSSIP_ICON_TRAINER;
            switch (check)
            {
                case LearnCheck::Ok:
                    label = node->Name;
                    break;
                case LearnCheck::AlreadyKnown:
                    label = "|cff808080" + node->Name + " (known)|r";
                    icon  = GOSSIP_ICON_CHAT;
                    break;
                case LearnCheck::LevelTooLow:
                    label = "|cff808080" + node->Name +
                            " (level " + std::to_string(node->RequiredLevel) + ")|r";
                    icon  = GOSSIP_ICON_CHAT;
                    break;
                case LearnCheck::MissingPrerequisite:
                    label = "|cff808080" + node->Name + " (locked)|r";
                    icon  = GOSSIP_ICON_CHAT;
                    break;
                default:
                    label = "|cff808080" + node->Name + "|r";
                    icon  = GOSSIP_ICON_CHAT;
                    break;
            }

            if (check == LearnCheck::Ok)
            {
                // Confirmation popup, so a misclick does not spend anything.
                AddGossipItemFor(player, icon, label, MENU_LEARN, node->Id,
                                 "Learn " + node->Name + "?", 0, false);
            }
            else
            {
                AddGossipItemFor(player, icon, label, MENU_TREE, treeId);
            }
        }

        AddGossipItemFor(player, GOSSIP_ICON_CHAT, "< Back", MENU_TREE_LIST, 0);
        SendGossipMenuFor(player, BROKER_NPC_TEXT, creature->GetGUID());
    }
}

class npc_ashmorrow_broker : public CreatureScript
{
public:
    npc_ashmorrow_broker() : CreatureScript("npc_ashmorrow_broker") { }

    bool OnGossipHello(Player* player, Creature* creature) override
    {
        if (!sClasslessConfig.Enable)
        {
            ChatHandler(player->GetSession()).SendSysMessage(
                "The broker has nothing to teach yet.");
            CloseGossipMenuFor(player);
            return true;
        }

        SendTreeList(player, creature);
        return true;
    }

    bool OnGossipSelect(Player* player, Creature* creature, uint32 sender, uint32 action) override
    {
        if (!sClasslessConfig.Enable)
        {
            CloseGossipMenuFor(player);
            return true;
        }

        switch (sender)
        {
            case MENU_TREE_LIST:
                SendTreeList(player, creature);
                break;

            case MENU_TREE:
                SendTree(player, creature, action);
                break;

            case MENU_LEARN:
            {
                ClasslessNode const* node = sClasslessMgr.GetNode(action);
                if (!node)
                {
                    ChatHandler(player->GetSession()).SendSysMessage(
                        ClasslessMgr::Explain(LearnCheck::UnknownNode));
                    SendTreeList(player, creature);
                    break;
                }

                LearnCheck result = sClasslessMgr.Learn(player, *node);
                ChatHandler(player->GetSession()).PSendSysMessage(
                    "%s%s|r",
                    result == LearnCheck::Ok ? "|cff00ff00" : "|cffff2020",
                    result == LearnCheck::Ok
                        ? ("You have learned " + node->Name + ".").c_str()
                        : ClasslessMgr::Explain(result));

                // Re-render the tree so the new state (and any node it just
                // unlocked) is visible immediately.
                SendTree(player, creature, node->TreeId);
                break;
            }

            default:
                CloseGossipMenuFor(player);
                break;
        }

        return true;
    }
};

void AddClasslessBrokerScripts()
{
    new npc_ashmorrow_broker();
}
