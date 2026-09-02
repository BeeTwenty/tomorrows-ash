--
-- Mastery points: a second currency, earned by playing, spent on ranks.
--
-- Skill points choose WHICH abilities a character has. Mastery chooses how
-- strong each one is. Rank 1 still comes with the tree purchase; rank 2 upward
-- is bought with mastery, and never below the rank's own stock level gate.
--
-- Design and reasoning: docs/TRAINING-SYSTEM.md.
--
-- Additive on purpose. classless_character_node and its cost_paid column are
-- untouched, so the website's spend join and its documented "no ranks"
-- assumption keep working exactly as they do (CLAUDE.md section 6).
--

-- ---------------------------------------------------------------------------
-- Earned total.
--
-- This one has to be STORED, and it is the one exception to "the budget is
-- derived, never stored" (CLAUDE.md section 2). That rule is about the
-- level-based skill budget, which is a function of level and so can be
-- recomputed on every read. Earned mastery is a record of what a player did -
-- quests finished, bosses first killed - and no formula reproduces it.
--
-- Spend is still derived, by summing classless_character_rank.cost_paid, so
-- the half of the rule that can hold, holds.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `classless_character_mastery`;
CREATE TABLE `classless_character_mastery` (
  `guid`   INT UNSIGNED NOT NULL,
  `earned` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Mastery points earned. Spend is derived from classless_character_rank.';

-- One row per rank bought.
DROP TABLE IF EXISTS `classless_character_rank`;
CREATE TABLE `classless_character_rank` (
  `guid`       INT UNSIGNED     NOT NULL,
  `node_id`    INT UNSIGNED     NOT NULL,
  `rank`       TINYINT UNSIGNED NOT NULL,
  `spell_id`   INT UNSIGNED     NOT NULL COMMENT 'the spell for this rank, from spell_ranks',
  -- The price PAID, never the price today. Same rule as classless_node.cost:
  -- re-pricing the curve must not retroactively bankrupt anyone.
  `cost_paid`  INT UNSIGNED     NOT NULL,
  `learned_at` TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`guid`, `node_id`, `rank`),
  KEY `idx_guid` (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Ranks bought with mastery points';

-- Where each point came from. Audit, and how the weekly is rate-limited.
DROP TABLE IF EXISTS `classless_mastery_log`;
CREATE TABLE `classless_mastery_log` (
  `id`        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guid`      INT UNSIGNED    NOT NULL,
  `source`    VARCHAR(32)     NOT NULL,
  `amount`    INT             NOT NULL,
  `ref_id`    INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'quest id, encounter id, ...',
  `at_level`  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'level when earned, for the per-level cap',
  `earned_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_guid_source` (`guid`, `source`),
  KEY `idx_guid_level` (`guid`, `at_level`),
  KEY `idx_guid_time` (`guid`, `earned_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Every mastery point granted, and why';

-- ---------------------------------------------------------------------------
-- The cost curve, as rows.
--
-- A rank costs by the LEVEL it unlocks at, not by its position in the chain.
-- Measured against the real chains, pricing by ordinal spans 3 to 120 and
-- charges the most for Fireball purely because its chain is long - but long
-- chains belong to the abilities you press constantly. Pricing by level spans
-- 8 to 79 and says "a level-70 rank costs 8, whatever it belongs to".
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `classless_rank_cost`;
CREATE TABLE `classless_rank_cost` (
  `min_level` TINYINT UNSIGNED NOT NULL COMMENT 'lowest level this band covers',
  `cost`      INT UNSIGNED     NOT NULL,
  PRIMARY KEY (`min_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Mastery cost of a rank, by the level that rank unlocks at';

INSERT INTO `classless_rank_cost` (`min_level`, `cost`) VALUES
  (0, 1), (10, 2), (20, 3), (30, 4), (40, 5), (50, 6), (60, 7), (70, 8), (80, 9);

-- ---------------------------------------------------------------------------
-- The sources, as rows.
--
-- `per_level_cap` is the correction the data forced. The first design granted
-- +1 per level-appropriate quest with no ceiling - but 5,786 non-repeatable
-- quests are reachable by a single Alliance character over levels 1-80, and
-- 1,250 mastery maxes every ability a level-80 can own. Unbounded questing
-- would have blown past the ceiling by more than double, which is exactly the
-- outcome the design exists to prevent.
--
-- So questing is capped per character level: the quests are the means, the
-- level is the pacing. 5 per level reaches ~400 by level 80 - a focused,
-- eight-ability build - and doing more quests than the cap earns nothing,
-- which also removes any reason to farm low-level zones.
--
-- Dungeons and exploration sit OUTSIDE the cap. They are the breadth bonus,
-- and they are bounded by content rather than by a number: 612 encounters
-- exist, each countable once.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `classless_mastery_source`;
CREATE TABLE `classless_mastery_source` (
  `source`        VARCHAR(32)      NOT NULL,
  `amount`        INT              NOT NULL COMMENT 'points per occurrence',
  `per_level_cap` INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '0 = uncapped',
  `enabled`       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `note`          VARCHAR(255)     NOT NULL DEFAULT '',
  PRIMARY KEY (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Where mastery points come from. Retune without a recompile.';

INSERT INTO `classless_mastery_source` (`source`, `amount`, `per_level_cap`, `enabled`, `note`) VALUES
  ('quest',       1, 5, 1, 'Non-repeatable quest within 5 levels below the character. Capped per level.'),
  ('boss',        2, 0, 1, 'First kill of a dungeon or raid encounter, once per character.'),
  ('exploration', 1, 0, 1, 'Per 10 newly discovered areas.'),
  ('weekly',      5, 0, 1, 'Once per week. The catch-up lever.');
