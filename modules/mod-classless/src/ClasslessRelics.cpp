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
 * Relics: the one gear category SQL cannot open.
 *
 * Every other class restriction on gear is data. Librams, idols, totems and
 * sigils are not: their equip slot is chosen by a hardcoded class check in
 * Player::FindEquipSlot (PlayerStorage.cpp:220),
 *
 *     case ITEM_SUBCLASS_ARMOR_LIBRAM:
 *         if (IsClass(CLASS_PALADIN, CLASS_CONTEXT_EQUIP_RELIC))
 *             slots[0] = EQUIPMENT_SLOT_RANGED;
 *         break;
 *
 * so with no matching class there is no slot, and AllowableClass never gets a
 * say. Clearing the mask on those 250 rows would change nothing at all, which
 * is why the Phase 3 SQL pass excludes them (docs/PHASE3-ITEMIZATION.md 4).
 *
 * Player::IsClass is the exception to the rule that script hooks can only
 * veto:
 *
 *     // Player.cpp:1350
 *     bool Player::IsClass(Classes unitClass, ClassContext context) const
 *     {
 *         Optional<bool> scriptResult = sScriptMgr->OnPlayerIsClass(this, unitClass, context);
 *         if (scriptResult != std::nullopt)
 *             return *scriptResult;
 *         return (getClass() == unitClass);
 *     }
 *
 * ScriptMgr::OnPlayerIsClass (ScriptDefines/PlayerScript.cpp:570) returns the
 * first script that returns a value - including true. It is not one of the
 * CALL_ENABLED_BOOLEAN_HOOKS, so it can loosen a hardcoded check rather than
 * only tighten one. That makes this the whole fix, with no core edit.
 *
 * Two properties keep it surgical:
 *
 *   - It answers for CLASS_CONTEXT_EQUIP_RELIC and nothing else. ClassContext
 *     (UnitDefines.h:231) has 18 values covering stats, talents, pets, taxi,
 *     graveyards and class trainers; returning nullopt for all of them leaves
 *     every one of those paths on stock behaviour. In particular the trainer
 *     gate does not even consult this hook - Trainer::IsTrainerValidForPlayer
 *     compares getClass() directly - so the armor proficiency ladder that
 *     locks plate to the Vanguard is untouched by anything here.
 *
 *   - It only ever answers true. A hook that returned false would be inventing
 *     a restriction the core did not ask for.
 *
 * There are exactly nine CLASS_CONTEXT_EQUIP_RELIC call sites in the core, all
 * in PlayerStorage.cpp: five in FindEquipSlot and four in CanRollForItemInLFG.
 * Loosening both together is deliberate - being able to equip a relic you may
 * not roll on would be worse than either alone.
 */

#include "ClasslessConfig.h"
#include "Player.h"
#include "ScriptMgr.h"
#include "UnitDefines.h"

using namespace TomorrowsAsh;

class ClasslessRelicScript : public PlayerScript
{
public:
    ClasslessRelicScript() : PlayerScript("ClasslessRelicScript",
        {
            PLAYERHOOK_ON_PLAYER_IS_CLASS
        }) { }

    [[nodiscard]] Optional<bool> OnPlayerIsClass(Player const* player, Classes playerClass,
                                                 ClassContext context) override
    {
        // Fail-safe: nullopt is "no opinion", which leaves the core's own
        // getClass() comparison in charge. Dropping this module into a stock
        // realm, or running with Classless.Enable = 0, changes nothing.
        if (!sClasslessConfig.Enable || !sClasslessConfig.OpenRelicSlot)
            return std::nullopt;

        if (context != CLASS_CONTEXT_EQUIP_RELIC)
            return std::nullopt;

        // Already the class being asked about: let the core answer, so the
        // stock path stays the stock path for a Vanguard and a libram.
        if (player->getClass() == playerClass)
            return std::nullopt;

        return true;
    }
};

void AddClasslessRelicScripts()
{
    new ClasslessRelicScript();
}
