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
        NotEnoughPoints,
        AlreadyKnowsSpell,   // knows the spell natively - selling it would be a waste
    };

    // What a character owns of one node. Kept per-character in memory.
    struct OwnedNode
    {
        uint32 NodeId   = 0;
        uint32 SpellId  = 0;
        uint32 CostPaid = 0;
        // False when the character already knew the spell, in which case respec
        // must NOT remove it - it is not ours to take back.
        bool   Granted  = true;
    };

    struct ClasslessBodyType
    {
        uint8       ClassId = 0;
        std::string Name;
        std::string Armor;
        std::string Description;
    };

    class ClasslessMgr
    {
    public:
        static ClasslessMgr& Instance();

        void Load();

        // The body type a class is, or nullptr for a class that is not one of
        // the three. Never assume the player IS a body type: a GM or a
        // character made before the restriction existed can be anything.
        [[nodiscard]] ClasslessBodyType const* GetBodyType(uint8 classId) const;
        [[nodiscard]] ClasslessBodyType const* GetBodyType(Player const* player) const;

        [[nodiscard]] std::vector<ClasslessTree const*> GetTrees() const;
        [[nodiscard]] ClasslessTree const* GetTree(uint32 treeId) const;
        [[nodiscard]] ClasslessNode const* GetNode(uint32 nodeId) const;

        // Does this player already have this node recorded as purchased?
        [[nodiscard]] bool HasNode(Player const* player, uint32 nodeId) const;

        // Points already committed. Sums what was PAID, not what nodes cost
        // today, so re-pricing never retroactively bankrupts anyone.
        [[nodiscard]] uint32 GetSpentPoints(Player const* player) const;
        [[nodiscard]] uint32 GetTotalPoints(Player const* player) const;
        // Saturating: a character over budget after a re-tune reads 0, not a
        // huge number from unsigned wraparound.
        [[nodiscard]] uint32 GetAvailablePoints(Player const* player) const;

        [[nodiscard]] LearnCheck CanLearn(Player const* player, ClasslessNode const& node) const;

        // Grants the spell and records the purchase. Returns the same check
        // result; only LearnCheck::Ok means anything happened.
        LearnCheck Learn(Player* player, ClasslessNode const& node);

        // Refunds every point and removes the spells we granted. Returns how
        // many nodes were cleared.
        uint32 Respec(Player* player);

        void LoadCharacter(Player* player);
        void UnloadCharacter(ObjectGuid::LowType guid);

        [[nodiscard]] static char const* Explain(LearnCheck reason);

    private:
        std::unordered_map<uint8, ClasslessBodyType> _bodyTypes;
        std::unordered_map<uint32, ClasslessTree> _trees;
        std::unordered_map<uint32, ClasslessNode> _nodes;

        // guid -> owned nodes. Cached so gossip rendering stays off the DB.
        std::unordered_map<ObjectGuid::LowType, std::vector<OwnedNode>> _owned;
    };
}

#define sClasslessMgr TomorrowsAsh::ClasslessMgr::Instance()

#endif // TA_CLASSLESS_MGR_H
