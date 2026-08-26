-- ---------------------------------------------------------------------------
-- Tomorrow's Ash - development fixture
--
-- ####################################################################
-- ##  DEVELOPMENT ONLY. Never run this against a real realm.        ##
-- ##  Point it at a throwaway MySQL - `ta.py web fixture` starts    ##
-- ##  one in Docker for exactly this purpose.                       ##
-- ####################################################################
--
-- What this is for: running the website against a *real database* without
-- building AzerothCore first. It creates the small subset of AzerothCore's
-- schema that the site actually reads, plus the Phase 2 classless tables the
-- armory is written against, and fills them with a handful of characters.
--
-- Two things it is deliberately not:
--   * a substitute for AzerothCore's own schema. Only the columns the website
--     touches are here, so a real realm must be built the normal way.
--   * a source of truth. If AzerothCore changes a column the site reads, the
--     site is what has to change - this file just follows.
--
-- Every statement is IF NOT EXISTS / INSERT IGNORE, so it cannot overwrite an
-- existing install by accident.
--
--   mysql -u root -p < web/sql/dev-fixture.sql
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS `acore_auth`       DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `acore_characters` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `acore_world`      DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ===========================================================================
-- auth
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `acore_auth`.`account` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`    VARCHAR(32)  NOT NULL DEFAULT '',
  `salt`        BINARY(32)   NOT NULL,
  `verifier`    BINARY(32)   NOT NULL,
  `session_key` BINARY(40)   DEFAULT NULL,
  `totp_secret` VARBINARY(128) DEFAULT NULL,
  `email`       VARCHAR(255) NOT NULL DEFAULT '',
  `reg_mail`    VARCHAR(255) NOT NULL DEFAULT '',
  `joindate`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_ip`     VARCHAR(15)  NOT NULL DEFAULT '127.0.0.1',
  `failed_logins` INT UNSIGNED NOT NULL DEFAULT 0,
  `locked`      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `last_login`  TIMESTAMP    NULL DEFAULT NULL,
  `online`      INT UNSIGNED NOT NULL DEFAULT 0,
  `expansion`   TINYINT UNSIGNED NOT NULL DEFAULT 2,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_auth`.`account_access` (
  `id`      INT UNSIGNED NOT NULL,
  `gmlevel` TINYINT UNSIGNED NOT NULL,
  `RealmID` INT NOT NULL DEFAULT -1,
  `comment` VARCHAR(255) DEFAULT '',
  PRIMARY KEY (`id`, `RealmID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_auth`.`realmlist` (
  `id`      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`    VARCHAR(32) NOT NULL DEFAULT '',
  `address` VARCHAR(255) NOT NULL DEFAULT '127.0.0.1',
  `port`    INT NOT NULL DEFAULT 8085,
  `gamebuild` INT UNSIGNED NOT NULL DEFAULT 12340,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_auth`.`realmcharacters` (
  `realmid`  INT UNSIGNED NOT NULL DEFAULT 0,
  `acctid`   INT UNSIGNED NOT NULL,
  `numchars` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`realmid`, `acctid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_auth`.`uptime` (
  `realmid`    INT UNSIGNED NOT NULL,
  `starttime`  INT UNSIGNED NOT NULL DEFAULT 0,
  `uptime`     INT UNSIGNED NOT NULL DEFAULT 0,
  `maxplayers` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `revision`   VARCHAR(255) NOT NULL DEFAULT 'AzerothCore',
  PRIMARY KEY (`realmid`, `starttime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `acore_auth`.`realmlist` (`id`, `name`, `address`, `port`) VALUES
  (1, 'Ashmorrow', '127.0.0.1', 8085);

INSERT IGNORE INTO `acore_auth`.`uptime` (`realmid`, `starttime`, `uptime`, `maxplayers`, `revision`) VALUES
  (1, UNIX_TIMESTAMP() - 98040, 98040, 42, 'AzerothCore rev. dev-fixture');

-- ===========================================================================
-- characters
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `acore_characters`.`characters` (
  `guid`    INT UNSIGNED NOT NULL DEFAULT 0,
  `account` INT UNSIGNED NOT NULL DEFAULT 0,
  `name`    VARCHAR(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `race`    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `class`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `gender`  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `level`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `online`  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `totaltime`   INT UNSIGNED NOT NULL DEFAULT 0,
  `logout_time` INT UNSIGNED NOT NULL DEFAULT 0,
  `zone`        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `totalKills`  INT UNSIGNED NOT NULL DEFAULT 0,
  `totalHonorPoints` INT UNSIGNED NOT NULL DEFAULT 0,
  `deleteDate`  INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`guid`),
  KEY `idx_account` (`account`),
  KEY `idx_online` (`online`),
  KEY `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`character_stats` (
  `guid` INT UNSIGNED NOT NULL DEFAULT 0,
  `maxhealth` INT UNSIGNED NOT NULL DEFAULT 0,
  `maxpower1` INT UNSIGNED NOT NULL DEFAULT 0,
  `maxpower2` INT UNSIGNED NOT NULL DEFAULT 0,
  `maxpower3` INT UNSIGNED NOT NULL DEFAULT 0,
  `maxpower4` INT UNSIGNED NOT NULL DEFAULT 0,
  `maxpower7` INT UNSIGNED NOT NULL DEFAULT 0,
  `strength` INT UNSIGNED NOT NULL DEFAULT 0,
  `agility` INT UNSIGNED NOT NULL DEFAULT 0,
  `stamina` INT UNSIGNED NOT NULL DEFAULT 0,
  `intellect` INT UNSIGNED NOT NULL DEFAULT 0,
  `spirit` INT UNSIGNED NOT NULL DEFAULT 0,
  `armor` INT UNSIGNED NOT NULL DEFAULT 0,
  `attackPower` INT UNSIGNED NOT NULL DEFAULT 0,
  `spellPower` INT UNSIGNED NOT NULL DEFAULT 0,
  `resilience` INT UNSIGNED NOT NULL DEFAULT 0,
  `critPct` FLOAT NOT NULL DEFAULT 0,
  `spellCritPct` FLOAT NOT NULL DEFAULT 0,
  `dodgePct` FLOAT NOT NULL DEFAULT 0,
  `parryPct` FLOAT NOT NULL DEFAULT 0,
  `blockPct` FLOAT NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`character_spell` (
  `guid` INT UNSIGNED NOT NULL DEFAULT 0,
  `spell` INT UNSIGNED NOT NULL DEFAULT 0,
  `specMask` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`guid`, `spell`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`character_talent` (
  `guid` INT UNSIGNED NOT NULL,
  `spell` INT UNSIGNED NOT NULL,
  `specMask` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`, `spell`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`character_achievement` (
  `guid` INT UNSIGNED NOT NULL,
  `achievement` SMALLINT UNSIGNED NOT NULL,
  `date` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`, `achievement`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`character_inventory` (
  `guid` INT UNSIGNED NOT NULL DEFAULT 0,
  `bag`  INT UNSIGNED NOT NULL DEFAULT 0,
  `slot` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `item` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`item`),
  UNIQUE KEY `guid` (`guid`, `bag`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`item_instance` (
  `guid` INT UNSIGNED NOT NULL DEFAULT 0,
  `itemEntry` INT UNSIGNED DEFAULT 0,
  `owner_guid` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`guild` (
  `guildid` INT UNSIGNED NOT NULL DEFAULT 0,
  `name` VARCHAR(24) NOT NULL DEFAULT '',
  `leaderguid` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guildid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`guild_member` (
  `guildid` INT UNSIGNED NOT NULL,
  `guid` INT UNSIGNED NOT NULL,
  `rank` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY `guid_key` (`guid`),
  KEY `guildid_key` (`guildid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================================
-- world
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `acore_world`.`item_template` (
  `entry` INT UNSIGNED NOT NULL DEFAULT 0,
  `class` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `subclass` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `displayid` INT UNSIGNED NOT NULL DEFAULT 0,
  `Quality` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `InventoryType` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `AllowableClass` INT NOT NULL DEFAULT -1,
  `ItemLevel` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `RequiredLevel` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================================
-- The classless tables (Phase 2)
--
-- This is the contract the armory is written against - see
-- docs/ARCHITECTURE.md §5 and docs/decisions/0004-website.md. `name` and
-- `max_rank` on classless_node are additions the website asks for: without a
-- name it can only print "Ability #133", because spell names live in the
-- client's DBC files and never reach the server database.
--
-- Definitions live in the world database, per-character state in characters.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `acore_world`.`classless_tree` (
  `id`          INT UNSIGNED NOT NULL,
  `name`        VARCHAR(64)  NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_world`.`classless_node` (
  `id`               INT UNSIGNED NOT NULL,
  `tree_id`          INT UNSIGNED NOT NULL,
  `spell_id`         INT UNSIGNED NOT NULL,
  `tier`             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `cost`             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `requires_node_id` INT UNSIGNED DEFAULT NULL,
  `name`             VARCHAR(96)  DEFAULT NULL,
  `max_rank`         TINYINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tree` (`tree_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`classless_character` (
  `guid`         INT UNSIGNED NOT NULL,
  `points_total` INT UNSIGNED NOT NULL DEFAULT 0,
  `points_spent` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `acore_characters`.`classless_character_node` (
  `guid`    INT UNSIGNED NOT NULL,
  `node_id` INT UNSIGNED NOT NULL,
  `rank`    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`guid`, `node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================================
-- Sample data
-- ===========================================================================

INSERT IGNORE INTO `acore_auth`.`account` (`id`, `username`, `salt`, `verifier`, `email`, `reg_mail`, `expansion`) VALUES
  (1, 'ASHTEST',  UNHEX(REPEAT('11', 32)), UNHEX(REPEAT('22', 32)), 'ASHTEST@EXAMPLE.COM',  'ASHTEST@EXAMPLE.COM',  2),
  (2, 'ASHSTAFF', UNHEX(REPEAT('33', 32)), UNHEX(REPEAT('44', 32)), 'ASHSTAFF@EXAMPLE.COM', 'ASHSTAFF@EXAMPLE.COM', 2);

-- Account 2 is staff, so every character on it must stay hidden site-wide.
INSERT IGNORE INTO `acore_auth`.`account_access` (`id`, `gmlevel`, `RealmID`) VALUES (2, 3, -1);

INSERT IGNORE INTO `acore_auth`.`realmcharacters` (`realmid`, `acctid`, `numchars`) VALUES (1, 1, 3), (1, 2, 1);

INSERT IGNORE INTO `acore_characters`.`guild` (`guildid`, `name`, `leaderguid`) VALUES
  (1, 'The Long Ash', 1), (2, 'Nightfall Company', 3);

INSERT IGNORE INTO `acore_characters`.`characters`
  (`guid`, `account`, `name`, `race`, `class`, `gender`, `level`, `online`, `totaltime`, `logout_time`, `zone`, `totalKills`, `totalHonorPoints`) VALUES
  (1, 1, 'Emberlyn',   1, 8, 1, 80, 1, 770400, UNIX_TIMESTAMP() - 300,    1519, 1842, 13800),
  (2, 1, 'Cairnhold',  3, 1, 0, 80, 0, 864000, UNIX_TIMESTAMP() - 86400,  1537,  903,  6700),
  (3, 1, 'Sorrowmark', 5, 4, 0, 74, 1, 540000, UNIX_TIMESTAMP() - 60,     1497, 2611, 19600),
  (4, 1, 'Rekindra',  11, 5, 1, 23, 0,  32000, UNIX_TIMESTAMP() - 604800, 3524,    4,    20),
  -- Staff character: must never appear in search, rankings or population.
  (9, 2, 'Ashwarden',  1, 2, 0, 80, 1, 100000, UNIX_TIMESTAMP() - 10,     1519,    0,     0);

INSERT IGNORE INTO `acore_characters`.`guild_member` (`guildid`, `guid`, `rank`) VALUES
  (1, 1, 0), (1, 2, 1), (2, 3, 0);

INSERT IGNORE INTO `acore_characters`.`character_stats`
  (`guid`, `maxhealth`, `maxpower1`, `maxpower2`, `strength`, `agility`, `stamina`, `intellect`, `spirit`,
   `armor`, `attackPower`, `spellPower`, `resilience`, `critPct`, `spellCritPct`, `dodgePct`, `parryPct`, `blockPct`) VALUES
  (1, 21400, 16200, 0, 62,  98, 1240, 1430, 620, 4200,  340, 2870,  0, 12.4, 31.7,  8.2, 0.0, 0.0),
  (2, 38900,     0, 100, 1180, 420, 2260,  84, 190, 24800, 4210,   0, 340, 24.1,  4.2, 18.4, 16.2, 22.8),
  (3, 24100,     0, 100,  640, 1320, 1480, 120, 210, 11200, 3180,   0, 620, 33.6,  6.1, 26.4, 12.1, 0.0);

INSERT IGNORE INTO `acore_characters`.`character_talent` (`guid`, `spell`, `specMask`) VALUES
  (2, 12294, 1), (2, 12295, 1), (2, 12296, 1);

INSERT IGNORE INTO `acore_characters`.`character_spell` (`guid`, `spell`, `specMask`) VALUES
  (2, 133, 1), (2, 116, 1), (2, 100, 1), (2, 78, 1);

INSERT IGNORE INTO `acore_characters`.`character_achievement` (`guid`, `achievement`, `date`) VALUES
  (1, 6, UNIX_TIMESTAMP()), (1, 7, UNIX_TIMESTAMP()), (1, 8, UNIX_TIMESTAMP());

INSERT IGNORE INTO `acore_world`.`item_template` (`entry`, `name`, `Quality`, `ItemLevel`, `InventoryType`) VALUES
  (40001, 'Ash-Scarred Hood',           4, 232, 1),
  (40002, 'Mantle of the Long Burn',    4, 226, 3),
  (40003, 'Breastplate of the Rekindled', 4, 232, 5),
  (40004, 'Cindercleaver',              5, 245, 17);

INSERT IGNORE INTO `acore_characters`.`item_instance` (`guid`, `itemEntry`, `owner_guid`) VALUES
  (5001, 40001, 1), (5002, 40002, 1), (5003, 40003, 1), (5004, 40004, 1);

INSERT IGNORE INTO `acore_characters`.`character_inventory` (`guid`, `bag`, `slot`, `item`) VALUES
  (1, 0, 0, 5001), (1, 0, 2, 5002), (1, 0, 4, 5003), (1, 0, 15, 5004);

-- Classless data: Emberlyn is Fire + Sword Mastery, Sorrowmark spreads wide.
INSERT IGNORE INTO `acore_world`.`classless_tree` (`id`, `name`, `description`) VALUES
  (1, 'Fire',          'Direct damage that grows the longer a fight runs.'),
  (2, 'Frost',         'Control, slows and survivability.'),
  (3, 'Shadow',        'Damage over time and life drain.'),
  (4, 'Sword Mastery', 'Melee weapon skill and openers.'),
  (5, 'Warding',       'Armour, blocks and damage reduction.'),
  (7, 'Stealth',       'Positioning, evasion and burst from hiding.');

INSERT IGNORE INTO `acore_world`.`classless_node` (`id`, `tree_id`, `spell_id`, `tier`, `cost`, `name`, `max_rank`) VALUES
  (101, 1, 133,   1, 1, 'Kindling',      3),
  (102, 1, 2136,  2, 1, 'Banked Heat',   3),
  (103, 1, 11366, 3, 2, 'Long Ember',    2),
  (401, 4, 12294, 1, 1, 'Opening Cut',   3),
  (402, 4, 1464,  2, 1, 'Weight Behind', 3),
  (403, 4, 7384,  3, 2, 'Overreach',     2),
  (701, 7, 1784,  1, 1, 'Quiet Step',    3),
  (702, 7, 1776,  2, 1, 'Slip Away',     2),
  (301, 3, 172,   1, 1, 'Rot',           3),
  (501, 5, 71,    1, 1, 'Braced',        3);

INSERT IGNORE INTO `acore_characters`.`classless_character` (`guid`, `points_total`, `points_spent`) VALUES
  (1, 48, 20), (3, 44, 10);

INSERT IGNORE INTO `acore_characters`.`classless_character_node` (`guid`, `node_id`, `rank`) VALUES
  (1, 101, 3), (1, 102, 3), (1, 103, 2), (1, 401, 3), (1, 402, 3), (1, 403, 2),
  (3, 701, 3), (3, 702, 2), (3, 301, 3), (3, 501, 2);
