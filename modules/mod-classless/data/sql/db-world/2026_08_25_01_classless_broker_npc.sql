-- Tomorrow's Ash - the Ashmorrow Ability Broker
--
-- The gossip NPC players use to learn abilities. Gossip is server-authoritative
-- and needs no client modification, which is why the classless system is
-- delivered through it rather than Blizzard's talent frame
-- (docs/decisions/0003-no-blizzard-talents.md).
--
-- Entry 900000 is in a custom range verified clear of stock content.

SET @BROKER_ENTRY := 900000;
SET @BROKER_TEXT  := 900000;

DELETE FROM `creature_template` WHERE `entry` = @BROKER_ENTRY;
INSERT INTO `creature_template`
  (`entry`, `name`, `subname`, `minlevel`, `maxlevel`, `faction`, `npcflag`,
   `unit_class`, `type`, `rank`, `AIName`, `ScriptName`)
VALUES
  (@BROKER_ENTRY, 'Ashmorrow Ability Broker', 'Classless Training', 80, 80,
   35,       -- faction 35 = friendly to everyone, so both factions can use it
   1,        -- npcflag 1 = gossip
   1,        -- unit_class warrior (cosmetic for a vendor-like NPC)
   7,        -- type humanoid
   0,        -- normal rank
   '', 'npc_ashmorrow_broker');

-- A model is mandatory in 3.3.5 or the client shows nothing.
DELETE FROM `creature_template_model` WHERE `CreatureID` = @BROKER_ENTRY;
INSERT INTO `creature_template_model`
  (`CreatureID`, `Idx`, `CreatureDisplayID`, `DisplayScale`, `Probability`)
VALUES
  (@BROKER_ENTRY, 0, 19646, 1.0, 1.0);   -- generic human male mage model

DELETE FROM `npc_text` WHERE `ID` = @BROKER_TEXT;
INSERT INTO `npc_text` (`ID`, `text0_0`) VALUES
  (@BROKER_TEXT,
   'Ashmorrow does not care what you were born as. Choose a discipline, and I will teach you its craft.');

-- Spawning is deliberately left to the operator: `.npc add 900000` in-game
-- puts one wherever you are standing. Committing a hardcoded spawn point would
-- bake a map position into the repo before we have decided where the broker
-- lives on the realm.
