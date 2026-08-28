-- Tomorrow's Ash - classless ability tree schema (world database)
--
-- Design rule (docs/ARCHITECTURE.md): trees, abilities, costs and prerequisites
-- are ROWS, not switch statements. Rebalancing a live realm must never require
-- a recompile.

DROP TABLE IF EXISTS `classless_node`;
DROP TABLE IF EXISTS `classless_tree`;

CREATE TABLE `classless_tree` (
  `id`          INT UNSIGNED     NOT NULL,
  `name`        VARCHAR(64)      NOT NULL,
  `description` VARCHAR(255)     NOT NULL DEFAULT '',
  `sort_order`  INT              NOT NULL DEFAULT 0,
  `enabled`     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Classless ability trees (Fire, Frost, Holy, ...)';

CREATE TABLE `classless_node` (
  `id`             INT UNSIGNED     NOT NULL,
  `tree_id`        INT UNSIGNED     NOT NULL,
  `spell_id`       INT UNSIGNED     NOT NULL,

  -- Display name. Spell.dbc names are only available with client data loaded,
  -- and we want the freedom to rename abilities for flavour anyway, so the
  -- menu text lives here rather than being looked up.
  `name`           VARCHAR(64)      NOT NULL,
  `description`    VARCHAR(255)     NOT NULL DEFAULT '',

  `tier`           TINYINT UNSIGNED NOT NULL DEFAULT 1,

  -- Skill-point cost. Phase 1 does NOT enforce a budget - the column exists so
  -- the Phase 2 budget system is a behaviour change, not a migration.
  `cost`           INT UNSIGNED     NOT NULL DEFAULT 1,

  -- Our own level gate. Player::learnSpell() does not check level, so this is
  -- the only thing standing between a level 1 character and a rank 12 nuke.
  `required_level` TINYINT UNSIGNED NOT NULL DEFAULT 1,

  -- Prerequisite node within the same tree. 0 = no prerequisite.
  `requires_node`  INT UNSIGNED     NOT NULL DEFAULT 0,

  `sort_order`     INT              NOT NULL DEFAULT 0,
  `enabled`        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_tree` (`tree_id`),
  KEY `idx_spell` (`spell_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Individual abilities within a classless tree';
