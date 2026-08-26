/*
 * Tomorrow's Ash - Classless module
 *
 * In-memory view of the ability trees. Loaded once on world start (and on
 * `.reload classless`), so the gossip handlers never touch the database on a
 * player's click.
 */

#ifndef TA_CLASSLESS_MGR_H
#define TA_CLASSLESS_MGR_H

#include "Define.h"
#include "ObjectGuid.h"
#include <string>
#include <unordered_map>
#include <vector>

class Player;

namespace TomorrowsAsh
{
    struct ClasslessNode
    {
        uint32 Id            = 0;
        uint32 TreeId        = 0;
        uint32 SpellId       = 0;
        std::string Name;
        std::string Description;
        uint8  Tier          = 1;
        uint32 Cost          = 1;
        uint8  RequiredLevel = 1;
        uint32 RequiresNode  = 0;
        int32  SortOrder     = 0;
    };

    struct ClasslessTree
    {
        uint32 Id = 0;
        std::string Name;
        std::string Description;
        int32 SortOrder = 0;
        std::vector<ClasslessNode const*> Nodes;   // sorted by tier then sort_order
    };

    // Why a player may not buy a node right now. Ordered so the gossip layer
    // can turn it straight into a message.
    enum class LearnCheck
    {
        Ok,
        UnknownNode,
        AlreadyKnown,
        LevelTooLow,
        MissingPrerequisite,
        Disabled,
    };

    class ClasslessMgr
    {
    public:
        static ClasslessMgr& Instance();

        void Load();

        [[nodiscard]] std::vector<ClasslessTree const*> GetTrees() const;
        [[nodiscard]] ClasslessTree const* GetTree(uint32 treeId) const;
        [[nodiscard]] ClasslessNode const* GetNode(uint32 nodeId) const;

        // Does this player already have this node recorded as purchased?
        [[nodiscard]] bool HasNode(Player const* player, uint32 nodeId) const;

        [[nodiscard]] LearnCheck CanLearn(Player const* player, ClasslessNode const& node) const;

        // Grants the spell and records the purchase. Returns the same check
        // result; only LearnCheck::Ok means anything happened.
        LearnCheck Learn(Player* player, ClasslessNode const& node);

        void LoadCharacter(Player* player);
        void UnloadCharacter(ObjectGuid::LowType guid);

        [[nodiscard]] static char const* Explain(LearnCheck reason);

    private:
        std::unordered_map<uint32, ClasslessTree> _trees;
        std::unordered_map<uint32, ClasslessNode> _nodes;

        // guid -> node ids owned. Cached so gossip rendering stays off the DB.
        std::unordered_map<ObjectGuid::LowType, std::vector<uint32>> _owned;
    };
}

#define sClasslessMgr TomorrowsAsh::ClasslessMgr::Instance()

#endif // TA_CLASSLESS_MGR_H
