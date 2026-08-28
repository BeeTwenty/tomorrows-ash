-- ---------------------------------------------------------------------------
-- Tomorrow's Ash - sample classless purchases (development only)
--
-- Separate from dev-fixture.sql because these rows reference tables the
-- MODULE creates, not tables this repository's website owns. The order is
-- therefore fixed and cannot be collapsed into one file:
--
--   1. web/sql/dev-fixture.sql                     characters to buy things
--   2. modules/mod-classless/data/sql/**           the trees and the tables
--   3. this file                                   who bought what
--
-- `ta.py web fixture --yes` runs all three in that order.
-- ---------------------------------------------------------------------------

-- Sample purchases.
--
-- `cost_paid` is taken from the node's current cost rather than hardcoded,
-- because that is what the realm records at purchase time and what both the
-- module and the armory sum to get "points spent". Leaving it at its DEFAULT 0
-- would make every character read as Unkindled - which is correct behaviour
-- for a row that says nothing was paid, and useless as sample data.
--
-- Node ids come from the module's own tree data, so this follows a rebalance
-- instead of pinning stale numbers.

DELETE FROM `acore_characters`.`classless_character_node` WHERE `guid` IN (1, 3);

-- Emberlyn: deep Fire, with a second tree alongside it.
INSERT IGNORE INTO `acore_characters`.`classless_character_node`
  (`guid`, `node_id`, `spell_id`, `cost_paid`, `granted`)
SELECT 1, n.`id`, n.`spell_id`, n.`cost`, 1
  FROM `acore_world`.`classless_node` n
 WHERE n.`tree_id` = (SELECT `id` FROM `acore_world`.`classless_tree` WHERE `name` = 'Fire')
    OR (n.`tree_id` = (SELECT `id` FROM `acore_world`.`classless_tree` WHERE `name` = 'Sword Mastery')
        AND n.`tier` <= 3);

-- Sorrowmark: spread thinner, across three trees.
INSERT IGNORE INTO `acore_characters`.`classless_character_node`
  (`guid`, `node_id`, `spell_id`, `cost_paid`, `granted`)
SELECT 3, n.`id`, n.`spell_id`, n.`cost`, 1
  FROM `acore_world`.`classless_node` n
 WHERE n.`tier` <= 2
   AND n.`tree_id` IN (SELECT `id` FROM `acore_world`.`classless_tree`
                        WHERE `name` IN ('Stealth', 'Shadow', 'Frost'));
