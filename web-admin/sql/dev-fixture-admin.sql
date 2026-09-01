-- ---------------------------------------------------------------------------
-- Tomorrow's Ash admin panel - development fixture
--
-- Adds only what the PANEL reaches and the public site's fixture does not:
-- bans, mutes, the MOTD, teleport destinations and the item-class backup.
-- It layers on top of web/sql/dev-fixture.sql rather than duplicating it - two
-- copies of a schema drift, and the armory's fixture is already the canonical
-- one for accounts and characters.
--
-- Order:
--   1. mysql < web/sql/dev-fixture.sql
--   2. mysql acore_world      < modules/mod-classless/data/sql/db-world/*.sql
--   3. mysql acore_characters < modules/mod-classless/data/sql/db-characters/*.sql
--   4. mysql < web/sql/dev-fixture-classless.sql
--   5. mysql < web-admin/sql/dev-fixture-admin.sql      (this file)
--
-- `python3 tools/ta.py admin dev-db --yes` does all five.
--
-- DEVELOPMENT ONLY. It creates a staff account with a known password.
-- ---------------------------------------------------------------------------

-- Columns the panel needs that the armory's fixture has no use for. Written as
-- separate statements rather than a rewritten CREATE TABLE so this file stays
-- additive.
SET @add_mutetime := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `acore_auth`.`account` ADD COLUMN `mutetime` BIGINT NOT NULL DEFAULT 0',
    'SELECT "mutetime already present"')
  FROM information_schema.columns
  WHERE table_schema = 'acore_auth' AND table_name = 'account' AND column_name = 'mutetime');
PREPARE stmt FROM @add_mutetime; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The armory's fixture only needs a realm's name and address. The panel edits
-- maintenance mode, which is `allowedSecurityLevel`.
SET @add_asl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `acore_auth`.`realmlist` '
    ' ADD COLUMN `icon` TINYINT UNSIGNED NOT NULL DEFAULT 0,'
    ' ADD COLUMN `flag` TINYINT UNSIGNED NOT NULL DEFAULT 2,'
    ' ADD COLUMN `allowedSecurityLevel` TINYINT UNSIGNED NOT NULL DEFAULT 0,'
    ' ADD COLUMN `population` FLOAT NOT NULL DEFAULT 0',
    'SELECT "realmlist already has allowedSecurityLevel"')
  FROM information_schema.columns
  WHERE table_schema = 'acore_auth' AND table_name = 'realmlist' AND column_name = 'allowedSecurityLevel');
PREPARE stmt FROM @add_asl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The armory renders a character's level, race and zone; the panel also edits
-- gold and shows where they logged out, so it needs a few more columns.
SET @add_char_cols := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `acore_characters`.`characters` '
    ' ADD COLUMN `money` INT UNSIGNED NOT NULL DEFAULT 0,'
    ' ADD COLUMN `map` SMALLINT UNSIGNED NOT NULL DEFAULT 0,'
    ' ADD COLUMN `at_login` SMALLINT UNSIGNED NOT NULL DEFAULT 0,'
    ' ADD COLUMN `xp` INT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT "characters already has money"')
  FROM information_schema.columns
  WHERE table_schema = 'acore_characters' AND table_name = 'characters' AND column_name = 'money');
PREPARE stmt FROM @add_char_cols; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Something to look at on a character page, and a reason for the gold field to
-- have a value other than zero.
UPDATE `acore_characters`.`characters`
   SET `money` = `level` * 1373 + 40000, `map` = 0
 WHERE `money` = 0;

-- The armory shows what an item is; the panel also shows how many of it, so a
-- support ticket about a missing stack has an answer.
SET @add_item_count := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `acore_characters`.`item_instance` ADD COLUMN `count` INT UNSIGNED NOT NULL DEFAULT 1',
    'SELECT "item_instance already has count"')
  FROM information_schema.columns
  WHERE table_schema = 'acore_characters' AND table_name = 'item_instance' AND column_name = 'count');
PREPARE stmt FROM @add_item_count; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `acore_auth`.`account_banned` (
  `id`        INT UNSIGNED NOT NULL DEFAULT 0,
  `bandate`   INT UNSIGNED NOT NULL DEFAULT 0,
  `unbandate` INT UNSIGNED NOT NULL DEFAULT 0,
  `bannedby`  VARCHAR(50)  NOT NULL,
  `banreason` VARCHAR(255) NOT NULL,
  `active`    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`, `bandate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_auth`.`ip_banned` (
  `ip`        VARCHAR(15)  NOT NULL DEFAULT '127.0.0.1',
  `bandate`   INT UNSIGNED NOT NULL,
  `unbandate` INT UNSIGNED NOT NULL,
  `bannedby`  VARCHAR(50)  NOT NULL DEFAULT '[Console]',
  `banreason` VARCHAR(255) NOT NULL DEFAULT 'no reason',
  PRIMARY KEY (`ip`, `bandate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_auth`.`motd` (
  `realmid` INT NOT NULL,
  `text`    LONGTEXT,
  PRIMARY KEY (`realmid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`character_banned` (
  `guid`      INT UNSIGNED NOT NULL DEFAULT 0,
  `bandate`   INT UNSIGNED NOT NULL DEFAULT 0,
  `unbandate` INT UNSIGNED NOT NULL DEFAULT 0,
  `bannedby`  VARCHAR(50)  NOT NULL,
  `banreason` VARCHAR(255) NOT NULL,
  `active`    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`guid`, `bandate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_world`.`game_tele` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `position_x`  FLOAT NOT NULL DEFAULT 0,
  `position_y`  FLOAT NOT NULL DEFAULT 0,
  `position_z`  FLOAT NOT NULL DEFAULT 0,
  `orientation` FLOAT NOT NULL DEFAULT 0,
  `map`         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `name`        VARCHAR(100) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The Phase 3 backup table, so the itemization page can show that the pass is
-- reversible rather than reporting it missing.
CREATE TABLE IF NOT EXISTS `acore_world`.`classless_item_class_backup` (
  `entry`          INT UNSIGNED NOT NULL,
  `AllowableClass` INT NOT NULL,
  PRIMARY KEY (`entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Sample data
-- ---------------------------------------------------------------------------

-- Some gear to look at, including two rows still class-locked so the "still
-- restricted" filter has something to find.
INSERT IGNORE INTO `acore_world`.`item_template`
  (`entry`, `class`, `subclass`, `name`, `Quality`, `InventoryType`, `AllowableClass`, `ItemLevel`, `RequiredLevel`)
VALUES
  (12640, 4, 4, 'Lionheart Helm',        4, 1,  -1, 63, 57),
  (19019, 2, 7, 'Thunderfury',           5, 13, -1, 80, 60),
  (22691, 4, 1, 'Cryptfiend Silk Robes', 3, 20, 0x0190, 61, 56),
  (18832, 2, 8, 'Brutality Blade',       4, 21, 0x004D, 63, 58),
  (32837, 2, 5, 'Warglaive of Azzinoth', 5, 13, -1, 156, 70);

INSERT IGNORE INTO `acore_world`.`classless_item_class_backup` (`entry`, `AllowableClass`) VALUES
  (12640, 0x0483),
  (19019, 0x04DF),
  (32837, 0x0008);

INSERT IGNORE INTO `acore_world`.`game_tele` (`id`, `position_x`, `position_y`, `position_z`, `orientation`, `map`, `name`) VALUES
  (1, -8833.38, 628.628, 94.0066, 1.0, 0, 'Stormwind'),
  (2, 1633.75,  -4439.9, 15.7929, 0.0, 1, 'Orgrimmar'),
  (3, 5804.15,   624.77, 647.767, 1.6, 530, 'Shattrath'),
  (4, 5807.75,   587.62, 660.951, 3.5, 571, 'Dalaran');

INSERT INTO `acore_auth`.`motd` (`realmid`, `text`) VALUES
  (1, 'Welcome to Ashmorrow. No classes. One budget. Spend it well.')
ON DUPLICATE KEY UPDATE `text` = VALUES(`text`);

-- ---------------------------------------------------------------------------
-- Staff accounts, one per tier, so the permission model can be exercised end
-- to end rather than reasoned about.
--
-- The salts are derived from the username and the verifiers computed with the
-- same SRP6 port the panel uses, so these accounts work in the game client too.
-- Passwords are printed below and are obviously not production values; the
-- fixture is refused outside development by `ta.py admin dev-db`.
--
--   ASHOWNER    / ownerpass     level 4  owner
--   ASHSTAFF    / (armory fixture)       level 3  administrator
--   ASHGM       / gmpass        level 2  game master
--   ASHSUPPORT  / supportpass   level 1  support
--   ASHCULPRIT  / culpritpass   level 0  a player to act on
-- ---------------------------------------------------------------------------
INSERT INTO `acore_auth`.`account` (`username`, `salt`, `verifier`, `email`, `reg_mail`, `expansion`, `joindate`)
VALUES
  ('ASHOWNER',   UNHEX('415A566473716F8379928E9CABA9A7BBB1CAC6D4E3E1DFF3E902FE0C1B19172B'),
                 UNHEX('617E8EA17A82EB5CD7F274186CC2B7FE37224ED7F88145EE72A1D11BAE74F358'),
                 'owner@example.invalid',   'owner@example.invalid',   2, NOW()),
  ('ASHGM',      UNHEX('415A565C69647D797F8C87A09CA2AFAAC3BFC5D2CDE6E2E8F5F009050B18132C'),
                 UNHEX('B4681AF8CA0C3245D3B0929CB0A0DF1C13B895EE9956A43BE96FD87190031983'),
                 'gm@example.invalid',      'gm@example.invalid',      2, NOW()),
  ('ASHSUPPORT', UNHEX('415A566871737A808A9387A09CAEB7B9C0C6D0D9CDE6E2F4FDFF060C161F132C'),
                 UNHEX('9780BA2D9787A62426E0C50C2D06DBEC3E1DEBBE02D69DEA0E1182EE84720F59'),
                 'support@example.invalid', 'support@example.invalid', 2, NOW()),
  ('ASHCULPRIT', UNHEX('415A5658716F7A83819387A09C9EB7B5C0C9C7D9CDE6E2E4FDFB060F0D1F132C'),
                 UNHEX('B467F80E42235C1F2A4302CD8A821655D3AB3E0259DB52841A8B44080B4A3688'),
                 'culprit@example.invalid', 'culprit@example.invalid', 2, NOW())
ON DUPLICATE KEY UPDATE `salt` = VALUES(`salt`), `verifier` = VALUES(`verifier`);

-- Levels. Level 0 is the ABSENCE of a row, which is why ASHCULPRIT gets none:
-- a zero row would read as staff to any query that tests for a row's existence.
INSERT INTO `acore_auth`.`account_access` (`id`, `gmlevel`, `RealmID`, `comment`)
SELECT `id`, 4, -1, 'dev fixture' FROM `acore_auth`.`account` WHERE `username` = 'ASHOWNER'
ON DUPLICATE KEY UPDATE `gmlevel` = VALUES(`gmlevel`);
INSERT INTO `acore_auth`.`account_access` (`id`, `gmlevel`, `RealmID`, `comment`)
SELECT `id`, 2, -1, 'dev fixture' FROM `acore_auth`.`account` WHERE `username` = 'ASHGM'
ON DUPLICATE KEY UPDATE `gmlevel` = VALUES(`gmlevel`);
INSERT INTO `acore_auth`.`account_access` (`id`, `gmlevel`, `RealmID`, `comment`)
SELECT `id`, 1, -1, 'dev fixture' FROM `acore_auth`.`account` WHERE `username` = 'ASHSUPPORT'
ON DUPLICATE KEY UPDATE `gmlevel` = VALUES(`gmlevel`);

-- A permanent ban, so the ban filter and the ban history have something real.
-- unbandate = bandate is how the core spells "permanent".
INSERT IGNORE INTO `acore_auth`.`account_banned` (`id`, `bandate`, `unbandate`, `bannedby`, `banreason`, `active`)
SELECT `id`, UNIX_TIMESTAMP() - 86400, UNIX_TIMESTAMP() - 86400, 'ASHOWNER', 'Gold advertising in /say', 1
  FROM `acore_auth`.`account` WHERE `username` = 'ASHCULPRIT';

-- An EXPIRED ban that is still active = 1, because the worldserver's periodic
-- sweep has not run. The panel must NOT show this account as banned. That
-- mismatch is exactly why the ban predicate is copied from LoginDatabase.cpp
-- (`active = 1 AND (unbandate > UNIX_TIMESTAMP() OR unbandate = bandate)`)
-- rather than testing `active` alone.
INSERT IGNORE INTO `acore_auth`.`account_banned` (`id`, `bandate`, `unbandate`, `bannedby`, `banreason`, `active`)
SELECT `id`, UNIX_TIMESTAMP() - 172800, UNIX_TIMESTAMP() - 3600, 'ASHOWNER', 'Expired 24h ban, sweep not yet run', 1
  FROM `acore_auth`.`account` WHERE `username` = 'ASHTEST';

-- Keep `account.online` in step with `characters.online`. The armory has no
-- use for the account flag, but the panel counts both, and a fixture that says
-- "3 players online, 0 accounts" teaches an operator to distrust the number.
UPDATE `acore_auth`.`account` a
   SET a.`online` = (
     SELECT COUNT(*) > 0 FROM `acore_characters`.`characters` c
      WHERE c.`account` = a.`id` AND c.`online` > 0);

-- The realm accepts everyone by default; maintenance is off.
UPDATE `acore_auth`.`realmlist` SET `allowedSecurityLevel` = 0 WHERE `id` = 1;
