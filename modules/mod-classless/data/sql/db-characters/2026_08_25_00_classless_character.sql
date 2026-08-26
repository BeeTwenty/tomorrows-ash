-- Tomorrow's Ash - per-character classless state (characters database)
--
-- Tracks which nodes a character has bought, so we can (a) show correct menu
-- state, (b) refund on respec in Phase 2, and (c) know which spells WE granted
-- as opposed to ones the character earned normally. That last distinction
-- matters: a respec must not strip a Mage's own Fireball.

CREATE TABLE IF NOT EXISTS `classless_character_node` (
  `guid`       INT UNSIGNED NOT NULL COMMENT 'characters.guid',
  `node_id`    INT UNSIGNED NOT NULL COMMENT 'classless_node.id',
  `spell_id`   INT UNSIGNED NOT NULL COMMENT 'denormalised: what we actually granted',
  `learned_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`guid`, `node_id`),
  KEY `idx_guid` (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Classless nodes purchased per character';
