-- ---------------------------------------------------------------------------
-- Tomorrow's Ash - website schema
--
-- Everything the *site* owns lives here, in its own database. Nothing in this
-- file touches an AzerothCore table, and the site never adds a column to one.
-- That is the same rule the game module follows (docs/ARCHITECTURE.md §4), and
-- it means the realm's own SQL updater can never collide with ours.
--
-- Apply once, then again after any upgrade that mentions it:
--
--   Linux    mysql -u root -p < web/sql/web-schema.sql
--   Windows  mysql.exe -u root -p < web\sql\web-schema.sql
--
-- The database name must match DB_WEB in web/.env.local. If you change one,
-- change the other.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS `ashmorrow_web`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `ashmorrow_web`;

-- ---------------------------------------------------------------------------
-- Password reset tokens
--
-- Only the SHA-256 of a token is stored, so a copy of this table does not let
-- anyone reset a password. Tokens are single-use and short-lived; `used_at`
-- is stamped rather than the row deleted, so a reused link is distinguishable
-- from an unknown one in the audit log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `web_password_reset` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` INT UNSIGNED NOT NULL COMMENT 'acore_auth.account.id',
  `token_hash` CHAR(64)     NOT NULL COMMENT 'SHA-256 hex of the token we emailed',
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME     NOT NULL,
  `used_at`    DATETIME     NULL DEFAULT NULL,
  `address`    VARCHAR(45)  NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token_hash` (`token_hash`),
  KEY `idx_account` (`account_id`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Rate limiting (RATE_LIMIT_DRIVER=mysql)
--
-- Only needed when the site runs as more than one process, or when limits must
-- survive a restart. The default in-memory driver needs no table at all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `web_rate_limit` (
  `bucket`       VARCHAR(190) NOT NULL COMMENT 'action + subject, e.g. login:name:ASHEN',
  `window_start` INT UNSIGNED NOT NULL COMMENT 'unix seconds, floored to the window',
  `hits`         INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`bucket`),
  KEY `idx_window` (`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Audit log
--
-- What happened to which account, and from where. Never a password, a token or
-- a verifier. Its job is to answer "was this account taken over?".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `web_audit` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `at`         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `event`      VARCHAR(32)     NOT NULL,
  `account_id` INT UNSIGNED    NULL DEFAULT NULL,
  `username`   VARCHAR(32)     NULL DEFAULT NULL,
  `address`    VARCHAR(45)     NULL DEFAULT NULL,
  `detail`     VARCHAR(255)    NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_at` (`at`),
  KEY `idx_account` (`account_id`),
  KEY `idx_event_at` (`event`, `at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Housekeeping
--
-- The site prunes spent reset tokens as it goes, so this is only needed if a
-- realm wants to trim the audit log or stale rate-limit rows. Run it by hand,
-- or from cron / Task Scheduler.
--
--   DELETE FROM `web_rate_limit`     WHERE `updated_at` < NOW() - INTERVAL 2 DAY;
--   DELETE FROM `web_password_reset` WHERE `expires_at` < NOW() - INTERVAL 7 DAY;
--   DELETE FROM `web_audit`          WHERE `at`         < NOW() - INTERVAL 180 DAY;
-- ---------------------------------------------------------------------------
