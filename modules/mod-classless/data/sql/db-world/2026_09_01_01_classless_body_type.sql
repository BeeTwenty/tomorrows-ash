--
-- Body types, as rows.
--
-- The client shows the underlying class name - Paladin, Shaman, Mage - and has
-- no idea the realm calls those Vanguard, Skirmisher and Adept. Nothing
-- server-side can change the class name in the UI (docs/BODY-TYPES.md 4), so
-- the realm has to say it out loud instead.
--
-- A table rather than constants because the names are explicitly placeholders
-- (BODY-TYPES.md 4: "say the word if you want different ones"). Renaming a
-- body type should be an UPDATE and a `.classless reload`, not a recompile.
--

DROP TABLE IF EXISTS `classless_body_type`;

CREATE TABLE `classless_body_type` (
  `class_id`    TINYINT UNSIGNED NOT NULL COMMENT 'the stock class this body type is built on',
  `name`        VARCHAR(32)      NOT NULL,
  `armor`       VARCHAR(32)      NOT NULL DEFAULT '' COMMENT 'heaviest armor it can train',
  `description` VARCHAR(255)     NOT NULL DEFAULT '',
  PRIMARY KEY (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Body types (docs/BODY-TYPES.md), keyed by the class they are built on';

INSERT INTO `classless_body_type` (`class_id`, `name`, `armor`, `description`) VALUES
  (2, 'Vanguard',   'plate', 'Stands in front. The heaviest armor and the only real melee.'),
  (7, 'Skirmisher', 'mail',  'Trades blows and casts. Mail, and a shield if you want one.'),
  (8, 'Adept',      'cloth', 'Glass, but unrestricted. Cloth only, and no melee to speak of.');
