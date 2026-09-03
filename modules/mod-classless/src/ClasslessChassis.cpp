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
 * What a body type is, for the core's purposes.
 *
 * A body type is a chassis: an armour class, a stat distribution and a power
 * type. It is deliberately *not* a class, and the whole design depends on it
 * not quietly becoming one. Wherever AzerothCore asks "is this player a
 * Hunter?" and the honest answer would hand the Skirmisher chassis something
 * no other body type has, this is where we answer.
 *
 * The seam is `Player::IsClass(class, context)`, which consults
 * `OnPlayerIsClass` before falling back to the raw class id. So this needs no
 * core modification, which is the same property the rest of the module has.
 *
 * See docs/decisions/0010-body-type-client-patch.md §10 for why Skirmisher is
 * Hunter (3) rather than Shaman (7): it is the only chassis triple that leaves
 * no race without a body type.
 */

#include "ClasslessConfig.h"
#include "Player.h"
#include "ScriptMgr.h"
#include "UnitDefines.h"

using namespace TomorrowsAsh;

namespace
{
    /// The class id the Skirmisher body type is built on.
    ///
    /// Named rather than spelled `CLASS_HUNTER` at each site, because what
    /// matters here is "the mail chassis", not "a hunter".
    constexpr Classes SKIRMISHER_CHASSIS = CLASS_HUNTER;
}

class ClasslessChassisScript : public PlayerScript
{
public:
    ClasslessChassisScript() : PlayerScript("ClasslessChassisScript",
        {
            PLAYERHOOK_ON_PLAYER_IS_CLASS
        }) { }

    /**
     * Answer, or decline to.
     *
     * `std::nullopt` means "no opinion, use the real class", and it is the
     * answer to almost everything: this hook is on a hot path and is asked
     * about every class in every context. Only the one question we actually
     * have a position on is answered.
     */
    [[nodiscard]] Optional<bool> OnPlayerIsClass(Player const* player, Classes unitClass,
                                                 ClassContext context) override
    {
        if (!sClasslessConfig.Enable)
            return std::nullopt;

        // "Can this player have a hunter pet?" — asked when taming, when the
        // stable master decides whether to talk to you, and when a pet's stats
        // are scaled. Everything else about the chassis is left alone.
        if (context != CLASS_CONTEXT_PET)
            return std::nullopt;
        if (unitClass != SKIRMISHER_CHASSIS)
            return std::nullopt;
        // Someone who is not on this chassis is already answered correctly by
        // the core; speaking for them would be a second bug waiting.
        if (player->getClass() != SKIRMISHER_CHASSIS)
            return std::nullopt;

        // The default is no, and the reasoning is availability rather than
        // taste. Before the chassis swap the mail body type was Shaman, and no
        // player on this realm could tame anything. The swap was made so that
        // Night Elves have a body type at all — not to hand one third of the
        // playerbase a companion the other two thirds cannot get. A pet that
        // only Skirmishers have makes the chassis a class again.
        //
        // If pets should exist on Ashmorrow they belong in the ability trees,
        // available to every body type, which is a deliberate decision and a
        // different piece of work. Flipping this option is the first half of it.
        return sClasslessConfig.ChassisHunterPets ? std::nullopt : Optional<bool>(false);
    }
};

void AddClasslessChassisScripts()
{
    new ClasslessChassisScript();
}
