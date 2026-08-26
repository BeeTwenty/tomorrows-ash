-- Tomorrow's Ash - skill-point budget accounting (characters database)
--
-- Adds two columns the Phase 2 budget needs. Both exist to make RESPEC safe.
--
-- `granted` - did WE actually teach this spell, or did the character already
--   know it? Without this, respec calls removeSpell() on a spell the character
--   earned normally and quietly steals it. A Mage who bought the Fire tree must
--   not lose their own Fireball when they respec.
--
-- `cost_paid` - what they were actually charged, rather than what the node
--   costs today. Re-pricing a node in `classless_node` then applies to new
--   purchases only, instead of retroactively bankrupting everyone who bought it
--   at the old price.

ALTER TABLE `classless_character_node`
  ADD COLUMN `cost_paid` INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'points charged at purchase time, not the node current cost'
    AFTER `spell_id`,
  ADD COLUMN `granted` TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '1 = we taught this spell and respec should remove it; 0 = already known, leave alone'
    AFTER `cost_paid`;
