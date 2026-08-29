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

#include "ClasslessMgr.h"
#include "ClasslessConfig.h"
#include "DatabaseEnv.h"
#include "Log.h"
#include "Player.h"
#include <algorithm>

namespace TomorrowsAsh
{
    ClasslessMgr& ClasslessMgr::Instance()
    {
        static ClasslessMgr instance;
        return instance;
    }

    void ClasslessMgr::Load()
    {
        _trees.clear();
        _nodes.clear();

        if (QueryResult result = WorldDatabase.Query(
                "SELECT id, name, description, sort_order FROM classless_tree "
                "WHERE enabled = 1 ORDER BY sort_order, id"))
        {
            do
            {
                Field* fields = result->Fetch();
                ClasslessTree tree;
                tree.Id          = fields[0].Get<uint32>();
                tree.Name        = fields[1].Get<std::string>();
                tree.Description = fields[2].Get<std::string>();
                tree.SortOrder   = fields[3].Get<int32>();
                _trees[tree.Id]  = std::move(tree);
            } while (result->NextRow());
        }

        uint32 orphaned = 0;
        if (QueryResult result = WorldDatabase.Query(
                "SELECT id, tree_id, spell_id, name, description, tier, cost, "
                "required_level, requires_node, sort_order FROM classless_node "
                "WHERE enabled = 1 ORDER BY tree_id, tier, sort_order, id"))
        {
            do
            {
                Field* fields = result->Fetch();
                ClasslessNode node;
                node.Id            = fields[0].Get<uint32>();
                node.TreeId        = fields[1].Get<uint32>();
                node.SpellId       = fields[2].Get<uint32>();
                node.Name          = fields[3].Get<std::string>();
                node.Description   = fields[4].Get<std::string>();
                node.Tier          = fields[5].Get<uint8>();
                node.Cost          = fields[6].Get<uint32>();
                node.RequiredLevel = fields[7].Get<uint8>();
                node.RequiresNode  = fields[8].Get<uint32>();
                node.SortOrder     = fields[9].Get<int32>();

                if (_trees.find(node.TreeId) == _trees.end())
                {
                    // A node pointing at a disabled or missing tree would be
                    // invisible and confusing; say so rather than dropping it
                    // silently.
                    LOG_ERROR("sql.sql", "[Classless] node {} references unknown/disabled tree {}, skipped",
                              node.Id, node.TreeId);
                    ++orphaned;
                    continue;
                }
                _nodes[node.Id] = std::move(node);
            } while (result->NextRow());
        }

        // Second pass: link nodes to trees. Done after loading every node so
        // the pointers stay valid regardless of insertion order.
        for (auto const& [id, node] : _nodes)
            _trees[node.TreeId].Nodes.push_back(&node);

        for (auto& [id, tree] : _trees)
        {
            std::sort(tree.Nodes.begin(), tree.Nodes.end(),
                [](ClasslessNode const* a, ClasslessNode const* b)
                {
                    if (a->Tier != b->Tier) return a->Tier < b->Tier;
                    if (a->SortOrder != b->SortOrder) return a->SortOrder < b->SortOrder;
                    return a->Id < b->Id;
                });
        }

        // Validate prerequisites now rather than discovering them on a click.
        for (auto const& [id, node] : _nodes)
        {
            if (!node.RequiresNode)
                continue;
            auto itr = _nodes.find(node.RequiresNode);
            if (itr == _nodes.end())
                LOG_ERROR("sql.sql", "[Classless] node {} requires missing node {}", node.Id, node.RequiresNode);
            else if (itr->second.TreeId != node.TreeId)
                LOG_ERROR("sql.sql", "[Classless] node {} requires node {} from a different tree", node.Id, node.RequiresNode);
        }

        LOG_INFO("module.classless", "[Classless] Loaded {} trees, {} abilities{}",
                 _trees.size(), _nodes.size(),
                 orphaned ? Acore::StringFormat(" ({} skipped)", orphaned) : "");
    }

    std::vector<ClasslessTree const*> ClasslessMgr::GetTrees() const
    {
        std::vector<ClasslessTree const*> out;
        out.reserve(_trees.size());
        for (auto const& [id, tree] : _trees)
            out.push_back(&tree);
        std::sort(out.begin(), out.end(), [](ClasslessTree const* a, ClasslessTree const* b)
        {
            if (a->SortOrder != b->SortOrder) return a->SortOrder < b->SortOrder;
            return a->Id < b->Id;
        });
        return out;
    }

    ClasslessTree const* ClasslessMgr::GetTree(uint32 treeId) const
    {
        auto itr = _trees.find(treeId);
        return itr == _trees.end() ? nullptr : &itr->second;
    }

    ClasslessNode const* ClasslessMgr::GetNode(uint32 nodeId) const
    {
        auto itr = _nodes.find(nodeId);
        return itr == _nodes.end() ? nullptr : &itr->second;
    }

    bool ClasslessMgr::HasNode(Player const* player, uint32 nodeId) const
    {
        auto itr = _owned.find(player->GetGUID().GetCounter());
        if (itr == _owned.end())
            return false;
        return std::any_of(itr->second.begin(), itr->second.end(),
                           [nodeId](OwnedNode const& o) { return o.NodeId == nodeId; });
    }

    uint32 ClasslessMgr::GetSpentPoints(Player const* player) const
    {
        auto itr = _owned.find(player->GetGUID().GetCounter());
        if (itr == _owned.end())
            return 0;

        uint32 spent = 0;
        for (OwnedNode const& owned : itr->second)
            spent += owned.CostPaid;
        return spent;
    }

    uint32 ClasslessMgr::GetTotalPoints(Player const* player) const
    {
        return sClasslessConfig.BudgetForLevel(player->GetLevel());
    }

    uint32 ClasslessMgr::GetAvailablePoints(Player const* player) const
    {
        uint32 total = GetTotalPoints(player);
        uint32 spent = GetSpentPoints(player);

        // Saturate rather than wrap. A character can legitimately be over
        // budget after the curve is re-tuned downward; that must read as "0
        // available", not as four billion.
        return spent >= total ? 0 : total - spent;
    }

    LearnCheck ClasslessMgr::CanLearn(Player const* player, ClasslessNode const& node) const
    {
        if (HasNode(player, node.Id))
            return LearnCheck::AlreadyKnown;

        if (player->GetLevel() < node.RequiredLevel)
            return LearnCheck::LevelTooLow;

        if (node.RequiresNode && !HasNode(player, node.RequiresNode))
            return LearnCheck::MissingPrerequisite;

        // Refuse to sell an ability the character already has by other means.
        // Charging points for a spell they already own is pure waste, and it
        // muddies the respec bookkeeping (see OwnedNode::Granted).
        if (player->HasSpell(node.SpellId))
            return LearnCheck::AlreadyKnowsSpell;

        if (GetAvailablePoints(player) < node.Cost)
            return LearnCheck::NotEnoughPoints;

        return LearnCheck::Ok;
    }

    LearnCheck ClasslessMgr::Learn(Player* player, ClasslessNode const& node)
    {
        LearnCheck check = CanLearn(player, node);
        if (check != LearnCheck::Ok)
            return check;

        // CanLearn already rejected spells the character knows natively, so
        // anything reaching here is genuinely ours to grant - and ours to take
        // back on respec.
        bool const granted = !player->HasSpell(node.SpellId);

        // This is the whole trick. Player::learnSpell() performs no class or
        // race check whatsoever (docs/CLASS-RESTRICTIONS.md), so a Warrior
        // learning Fireball needs no core modification.
        player->learnSpell(node.SpellId);

        ObjectGuid::LowType guid = player->GetGUID().GetCounter();
        _owned[guid].push_back({ node.Id, node.SpellId, node.Cost, granted });

        CharacterDatabase.Execute(
            "INSERT INTO classless_character_node (guid, node_id, spell_id, cost_paid, granted) "
            "VALUES ({}, {}, {}, {}, {}) "
            "ON DUPLICATE KEY UPDATE spell_id = VALUES(spell_id), "
            "cost_paid = VALUES(cost_paid), granted = VALUES(granted)",
            guid, node.Id, node.SpellId, node.Cost, granted ? 1 : 0);

        LOG_INFO("module.classless", "[Classless] {} learned '{}' (node {}, spell {}, cost {})",
                 player->GetName(), node.Name, node.Id, node.SpellId, node.Cost);

        return LearnCheck::Ok;
    }

    uint32 ClasslessMgr::Respec(Player* player)
    {
        ObjectGuid::LowType guid = player->GetGUID().GetCounter();
        auto itr = _owned.find(guid);
        if (itr == _owned.end() || itr->second.empty())
            return 0;

        uint32 cleared = 0;
        for (OwnedNode const& owned : itr->second)
        {
            // Only take back what we actually gave. A spell the character knew
            // before buying the node is theirs, not ours.
            if (owned.Granted)
                player->removeSpell(owned.SpellId, SPEC_MASK_ALL, false);
            ++cleared;
        }

        itr->second.clear();
        CharacterDatabase.Execute("DELETE FROM classless_character_node WHERE guid = {}", guid);

        LOG_INFO("module.classless", "[Classless] {} respecced, {} node(s) cleared",
                 player->GetName(), cleared);

        return cleared;
    }

    void ClasslessMgr::LoadCharacter(Player* player)
    {
        ObjectGuid::LowType guid = player->GetGUID().GetCounter();
        std::vector<OwnedNode>& owned = _owned[guid];
        owned.clear();

        if (QueryResult result = CharacterDatabase.Query(
                "SELECT node_id, spell_id, cost_paid, granted FROM classless_character_node "
                "WHERE guid = {}", guid))
        {
            do
            {
                Field* fields = result->Fetch();
                owned.push_back({
                    fields[0].Get<uint32>(),
                    fields[1].Get<uint32>(),
                    fields[2].Get<uint32>(),
                    fields[3].Get<uint8>() != 0
                });
            } while (result->NextRow());
        }
    }

    void ClasslessMgr::UnloadCharacter(ObjectGuid::LowType guid)
    {
        _owned.erase(guid);
    }

    char const* ClasslessMgr::Explain(LearnCheck reason)
    {
        switch (reason)
        {
            case LearnCheck::Ok:                  return "Learned.";
            case LearnCheck::UnknownNode:         return "That ability is no longer offered.";
            case LearnCheck::AlreadyKnown:        return "You already know that.";
            case LearnCheck::LevelTooLow:         return "You are not experienced enough for that yet.";
            case LearnCheck::MissingPrerequisite: return "You must learn its foundation first.";
            case LearnCheck::Disabled:            return "That ability is unavailable.";
            case LearnCheck::NotEnoughPoints:     return "You lack the skill points.";
            case LearnCheck::AlreadyKnowsSpell:   return "You already command that ability.";
        }
        return "You cannot learn that.";
    }
}
