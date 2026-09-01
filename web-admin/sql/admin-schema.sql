-- Tomorrow's Ash - admin panel schema
--
-- Everything the panel owns lives here, in its own database. It never adds a
-- column to an AzerothCore table: the core's updater would drop it on the next
-- upstream bump, and a schema the game server does not know about is a schema
-- the game server cannot corrupt.
--
-- Apply with:
--   mysql -u root -p < web-admin/sql/admin-schema.sql
--   mysql -u root -p < web-admin/sql/admin-grants.sql     (edit the password first)

CREATE DATABASE IF NOT EXISTS `ashmorrow_admin`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `ashmorrow_admin`;

-- ---------------------------------------------------------------------------
-- admin_audit - the record of who did what.
--
-- Append-only *by grant*: ash_admin holds INSERT here and not UPDATE or DELETE
-- (see admin-grants.sql). A compromised panel can therefore add to the record
-- but cannot rewrite it, which is the difference between a log and a diary.
--
-- Denials are rows too. The interesting pattern is rarely a single ban; it is
-- a support account trying the ban button eleven times.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_audit` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Who. Denormalised on purpose: the username and level are what they were at
  -- the time, so a later rename or demotion does not rewrite history.
  `actor_account_id`  INT UNSIGNED NULL,
  `actor_username`    VARCHAR(32)  NULL,
  `actor_gmlevel`     TINYINT UNSIGNED NULL,
  `actor_role`        VARCHAR(16)  NULL,

  -- What. `action` is the Permission string, or an auth.* event.
  `action`            VARCHAR(48)  NOT NULL,
  `outcome`           ENUM('ok','denied','error') NOT NULL DEFAULT 'ok',

  -- To what.
  `target_type`       VARCHAR(32)  NULL,
  `target_id`         VARCHAR(64)  NULL,
  `target_label`      VARCHAR(128) NULL,

  `summary`           VARCHAR(512) NULL,
  `reason`            VARCHAR(512) NULL,

  -- Before and after. "My item vanished" is only answerable if the row's old
  -- contents were written down at the time it changed.
  `before_json`       MEDIUMTEXT   NULL,
  `after_json`        MEDIUMTEXT   NULL,

  `address`           VARCHAR(45)  NULL,
  `session_id`        CHAR(64)     NULL,

  PRIMARY KEY (`id`),
  KEY `idx_audit_time`    (`created_at`),
  KEY `idx_audit_actor`   (`actor_account_id`, `created_at`),
  KEY `idx_audit_target`  (`target_type`, `target_id`, `created_at`),
  KEY `idx_audit_action`  (`action`, `created_at`),
  KEY `idx_audit_outcome` (`outcome`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- admin_session - stateful, revocable staff sessions.
--
-- `id` is SHA-256 of the token the browser holds, never the token itself, so
-- read access to this table does not produce a working cookie.
--
-- `stage` carries the half-authenticated state between password and TOTP, so
-- there is one thing to revoke instead of two cookies to keep in agreement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_session` (
  `id`             CHAR(64)     NOT NULL,
  `account_id`     INT UNSIGNED NOT NULL,
  `username`       VARCHAR(32)  NOT NULL,
  `stage`          ENUM('pending_totp','pending_enrolment','active') NOT NULL DEFAULT 'pending_totp',

  -- First 16 hex of SHA-256 over the account's SRP6 verifier. A password change
  -- moves it, and every session pinned to the old one dies on its next request.
  `verifier_fp`    CHAR(16)     NOT NULL,

  `address`        VARCHAR(45)  NULL,
  `user_agent`     VARCHAR(255) NULL,

  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`     DATETIME     NOT NULL,
  `revoked_at`     DATETIME     NULL,
  `revoked_reason` VARCHAR(64)  NULL,

  PRIMARY KEY (`id`),
  KEY `idx_session_account` (`account_id`, `revoked_at`),
  KEY `idx_session_live`    (`revoked_at`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- admin_totp - the second factor, one row per staff account.
--
-- The secret is sealed with AES-256-GCM before it is stored (src/lib/secretbox.ts).
-- A database dump on its own therefore does not let anyone mint codes; the key
-- lives in the panel's environment, not in the database.
--
-- `last_step` is replay protection. A code is valid for thirty seconds, which
-- is thirty seconds in which a shoulder-surfed or phished code could be reused;
-- refusing any step at or below the last accepted one closes that.
--
-- This is the panel's own TOTP, deliberately not `account.totp_secret`. That
-- column is the *game client's* second factor, entered at the login screen;
-- sharing it would mean the panel could read it, and enrolling in one would
-- silently change the other.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_totp` (
  `account_id`   INT UNSIGNED NOT NULL,
  `username`     VARCHAR(32)  NOT NULL,
  `secret`       VARBINARY(255) NOT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_at` DATETIME     NULL,
  `last_step`    BIGINT       NOT NULL DEFAULT 0,
  `failures`     INT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` DATETIME     NULL,
  PRIMARY KEY (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- admin_recovery_code - single-use codes for a lost authenticator.
--
-- Stored as SHA-256 hashes for the same reason passwords are: the table should
-- not be a list of ways in. Ten are issued at enrolment and shown exactly once.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_recovery_code` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` INT UNSIGNED NOT NULL,
  `code_hash`  CHAR(64)     NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `used_at`    DATETIME     NULL,
  `used_from`  VARCHAR(45)  NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_recovery_hash` (`code_hash`),
  KEY `idx_recovery_account` (`account_id`, `used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- admin_login_attempt - throttling, by address and by username.
--
-- Both keys matter and for different attacks: one address trying many accounts
-- is a scan, many addresses trying one account is a targeted guess. Counting
-- only one of them leaves the other unmeasured.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_login_attempt` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `address`    VARCHAR(45)  NULL,
  `username`   VARCHAR(32)  NULL,
  `stage`      ENUM('password','totp','recovery') NOT NULL DEFAULT 'password',
  `successful` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_attempt_address` (`address`, `at`),
  KEY `idx_attempt_user`    (`username`, `at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- admin_setting - realm-facing settings the panel owns.
--
-- Only settings that have nowhere else to live. Anything the worldserver reads
-- from its own tables is edited there; this is for panel-level state such as
-- whether the public site should show a maintenance banner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_setting` (
  `name`       VARCHAR(64)  NOT NULL,
  `value`      TEXT         NULL,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(32)  NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- admin_item_change - staged itemization changes.
--
-- Itemization is the one area where "make the change" and "decide the change"
-- are genuinely different acts. Phase 3 cleared `AllowableClass` on 4,746 gear
-- rows in one reviewed pass; the next such decision deserves the same
-- treatment, not a form that writes straight into `item_template`.
--
-- So a change is *staged* here first (administrator), reviewed, and then
-- *promoted* into the world database (owner). A staged row carries the old and
-- new value, so promoting is mechanical and reverting is possible.
--
-- This mirrors modules/mod-classless/data/sql-staged/ on the repository side:
-- generated migrations that are written but must not run until somebody decides
-- they should.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_item_change` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_entry`    INT UNSIGNED NOT NULL,
  `item_name`     VARCHAR(128) NULL,
  `field`         VARCHAR(32)  NOT NULL DEFAULT 'AllowableClass',
  `old_value`     BIGINT       NULL,
  `new_value`     BIGINT       NOT NULL,
  `state`         ENUM('staged','promoted','withdrawn') NOT NULL DEFAULT 'staged',
  `reason`        VARCHAR(512) NULL,
  `staged_by`     VARCHAR(32)  NOT NULL,
  `staged_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `promoted_by`   VARCHAR(32)  NULL,
  `promoted_at`   DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_item_state` (`state`, `staged_at`),
  KEY `idx_item_entry` (`item_entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
