-- ---------------------------------------------------------------------------
-- Tomorrow's Ash - least-privilege database user for the website
--
-- The site must never connect as root. This grants exactly what it uses and
-- nothing else:
--
--   * read on the character and world data the armory renders
--   * read on the auth data the status page and sign-in need
--   * write on `account` only - and only the columns account creation and
--     password change actually touch
--   * full control of the site's own schema
--
-- Notably absent: DELETE anywhere in AzerothCore's schemas, any access to
-- `account_banned`, `ip_banned` or `logs`, and DDL of any kind.
--
-- Run this AFTER the realm's databases exist. Several grants below name
-- individual tables, and MySQL refuses to grant on a table it cannot find, so
-- on an empty acore_auth this fails with a bare "Table doesn't exist". Start
-- the worldserver once first (`ta.py run world`), or use
-- `ta.py web dev-db --yes` for a database with no realm behind it.
--
-- 1. Replace CHANGE_ME with a long random password.
-- 2. Replace 'localhost' with '%' if the site runs on another machine. If you
--    do that AND the site also connects from the database host itself, create
--    the user for both: a fresh MySQL keeps an anonymous ''@'localhost'
--    account which is a more specific host match than '%', so local
--    connections hit that instead and fail with a confusing
--    "Access denied for user 'ash_web'@'localhost'".
-- 3. Run as root, then put the same password in DB_PASSWORD in web/.env.local.
--
--   mysql -u root -p < web/sql/grants.sql
-- ---------------------------------------------------------------------------

CREATE USER IF NOT EXISTS 'ash_web'@'localhost' IDENTIFIED BY 'CHANGE_ME';

-- Armory, leaderboards, realm population.
GRANT SELECT ON `acore_characters`.* TO 'ash_web'@'localhost';

-- Item names and, later, the classless tree definitions.
GRANT SELECT ON `acore_world`.*      TO 'ash_web'@'localhost';

-- Realm status (uptime, realmlist) and the staff filter (account_access).
GRANT SELECT ON `acore_auth`.`uptime`         TO 'ash_web'@'localhost';
GRANT SELECT ON `acore_auth`.`realmlist`      TO 'ash_web'@'localhost';
GRANT SELECT ON `acore_auth`.`account_access` TO 'ash_web'@'localhost';

-- Sign-in reads the credentials; registration and password change write them.
-- Column-level grants keep the site away from ban flags, mute state, session
-- keys and TOTP secrets even though they live in the same row.
GRANT SELECT (`id`, `username`, `salt`, `verifier`, `email`, `reg_mail`,
              `joindate`, `last_login`, `online`, `locked`)
  ON `acore_auth`.`account` TO 'ash_web'@'localhost';

GRANT INSERT (`username`, `salt`, `verifier`, `expansion`, `email`, `reg_mail`,
              `joindate`, `last_ip`)
  ON `acore_auth`.`account` TO 'ash_web'@'localhost';

GRANT UPDATE (`salt`, `verifier`, `session_key`, `email`, `reg_mail`)
  ON `acore_auth`.`account` TO 'ash_web'@'localhost';

-- New accounts need their realm character-counter row, exactly as the core's
-- own account creation does.
GRANT INSERT ON `acore_auth`.`realmcharacters` TO 'ash_web'@'localhost';

-- The site's own schema: reset tokens, rate limits, audit log.
GRANT SELECT, INSERT, UPDATE, DELETE ON `ashmorrow_web`.* TO 'ash_web'@'localhost';

FLUSH PRIVILEGES;

-- Verify what was actually granted:
--   SHOW GRANTS FOR 'ash_web'@'localhost';
