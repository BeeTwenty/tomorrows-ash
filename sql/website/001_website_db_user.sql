-- Tomorrow's Ash - least-privilege MySQL user for the website
--
-- Run against the AUTH database connection as an admin user, or use:
--     python3 tools/ta.py db website-user
--
-- Rationale: the website is internet-facing and is the most likely thing to be
-- compromised. It must never hold the credentials the game server uses.
--
-- The grants below are deliberately narrow:
--   acore_auth        SELECT + INSERT + UPDATE on `account` only  (register / change password)
--   acore_characters  SELECT only                                  (armory, roster, rankings)
--   acore_world       SELECT only                                  (item/quest/creature lookups)
--
-- The website gets NO DELETE anywhere, and no access to `account_access`
-- (GM levels) or `account_banned` - privilege changes and bans stay out of
-- reach of a web compromise. Widen this only with a specific reason.

-- Replace the password before running in production.
CREATE USER IF NOT EXISTS 'ashweb'@'%' IDENTIFIED BY 'CHANGE_ME';

-- Account registration and password changes need write access to `account`.
GRANT SELECT, INSERT, UPDATE ON `acore_auth`.`account` TO 'ashweb'@'%';

-- Realm list, so the site can show realm status.
GRANT SELECT ON `acore_auth`.`realmlist` TO 'ashweb'@'%';

-- Read-only character data for armory / roster pages.
GRANT SELECT ON `acore_characters`.* TO 'ashweb'@'%';

-- Read-only world data for item and quest lookups.
GRANT SELECT ON `acore_world`.* TO 'ashweb'@'%';

FLUSH PRIVILEGES;

-- Verify with:
--   SHOW GRANTS FOR 'ashweb'@'%';
