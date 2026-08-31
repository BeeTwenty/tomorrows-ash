-- ---------------------------------------------------------------------------
-- Tomorrow's Ash - least-privilege database user for the ADMIN PANEL
--
-- `ash_admin` is a second, separate user. It is not `ash_web` with more rights:
-- the public site must never gain the ability to ban an account, and the panel
-- must never inherit the site's exposure. Two users, two passwords, two
-- processes - that separation is the actual boundary between the services.
--
-- The one grant that is deliberately incomplete is on the audit table:
--
--     GRANT INSERT ON admin_audit    -- yes
--     GRANT UPDATE ON admin_audit    -- NO
--     GRANT DELETE ON admin_audit    -- NO
--
-- The panel can write the record and cannot alter it. That holds even when the
-- panel itself is the thing that has been compromised, which is the only case
-- where an audit log is worth anything. Trimming old rows is a root job, done
-- deliberately, not something the application can be talked into.
--
-- Also absent everywhere: DROP, ALTER, CREATE, and any access to
-- `acore_auth`.`account`.`session_key`. Migrations are run by a human as root.
--
-- Run this AFTER admin-schema.sql and after the realm's databases exist.
--
-- 1. Replace CHANGE_ME with a long random password (`npm run gen-secret`).
-- 2. Replace 'localhost' with the host the panel connects from. If it also
--    connects locally, create the user for both hosts - a fresh MySQL keeps an
--    anonymous ''@'localhost' account that is a more specific match than '%'.
-- 3. Run as root, then put the same password in web-admin/.env.local.
--
--   mysql -u root -p < web-admin/sql/admin-grants.sql
-- ---------------------------------------------------------------------------

CREATE USER IF NOT EXISTS 'ash_admin'@'localhost' IDENTIFIED BY 'CHANGE_ME';
ALTER USER IF EXISTS 'ash_admin'@'localhost' IDENTIFIED BY 'CHANGE_ME';

-- ---------------------------------------------------------------------------
-- The panel's own schema.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON `ashmorrow_admin`.`admin_session`        TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ashmorrow_admin`.`admin_totp`           TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ashmorrow_admin`.`admin_recovery_code`  TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, DELETE         ON `ashmorrow_admin`.`admin_login_attempt`  TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE         ON `ashmorrow_admin`.`admin_setting`        TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE         ON `ashmorrow_admin`.`admin_item_change`    TO 'ash_admin'@'localhost';

-- The append-only one. Read it, add to it, never change it.
GRANT SELECT, INSERT                 ON `ashmorrow_admin`.`admin_audit`          TO 'ash_admin'@'localhost';

-- ---------------------------------------------------------------------------
-- Accounts. Column-level, so the panel can ban and reset but cannot touch a
-- live session key or the game client's own TOTP secret.
-- ---------------------------------------------------------------------------
GRANT SELECT (`id`, `username`, `salt`, `verifier`, `email`, `reg_mail`,
              `joindate`, `last_login`, `last_ip`, `online`, `locked`,
              `expansion`, `failed_logins`, `mutetime`)
  ON `acore_auth`.`account` TO 'ash_admin'@'localhost';

-- Notably absent from the UPDATE list: `session_key` (the live game session)
-- and `totp_secret` (the client's own second factor). A password reset does
-- need to clear session_key, so it is granted separately below rather than
-- being buried in this list.
GRANT UPDATE (`salt`, `verifier`, `session_key`, `email`, `reg_mail`, `locked`,
              `expansion`, `failed_logins`, `mutetime`)
  ON `acore_auth`.`account` TO 'ash_admin'@'localhost';

-- Staff levels. INSERT and UPDATE and DELETE, because removing a level is a
-- row deletion; the escalation rules in src/lib/roles.ts are what stop this
-- from being a way to make yourself an owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON `acore_auth`.`account_access` TO 'ash_admin'@'localhost';

-- Bans. Both kinds: account and address.
GRANT SELECT, INSERT, UPDATE ON `acore_auth`.`account_banned` TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE ON `acore_auth`.`ip_banned`      TO 'ash_admin'@'localhost';

-- Realm status, the realm list and the message of the day.
--
-- realmlist gets UPDATE for maintenance mode (`allowedSecurityLevel`); motd
-- gets INSERT and UPDATE, not DELETE, because the panel writes it with
-- INSERT ... ON DUPLICATE KEY rather than the core's REPLACE.
GRANT SELECT ON `acore_auth`.`uptime`            TO 'ash_admin'@'localhost';
GRANT SELECT, UPDATE ON `acore_auth`.`realmlist` TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE ON `acore_auth`.`motd` TO 'ash_admin'@'localhost';

-- ---------------------------------------------------------------------------
-- Characters. Read broadly, write narrowly.
--
-- The panel writes to a character row only while that character is OFFLINE.
-- While they are online the worldserver holds the authoritative copy in memory
-- and will write it back over anything changed underneath it - so an online
-- edit is not merely racy, it is silently discarded. src/lib/characters.ts
-- refuses those writes and routes them through SOAP instead.
-- ---------------------------------------------------------------------------
GRANT SELECT ON `acore_characters`.* TO 'ash_admin'@'localhost';

GRANT UPDATE ON `acore_characters`.`characters`             TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `acore_characters`.`character_banned` TO 'ash_admin'@'localhost';

-- The classless purchases, for a support-ticket refund or a forced respec.
GRANT SELECT, INSERT, UPDATE, DELETE ON `acore_characters`.`classless_character_node` TO 'ash_admin'@'localhost';

-- ---------------------------------------------------------------------------
-- World. The tree definitions and the budget curve are editable data; the rest
-- of the world database is read-only to the panel.
-- ---------------------------------------------------------------------------
GRANT SELECT ON `acore_world`.* TO 'ash_admin'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE ON `acore_world`.`classless_tree` TO 'ash_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `acore_world`.`classless_node` TO 'ash_admin'@'localhost';

-- Itemization. UPDATE only on the one column a promoted change touches; the
-- panel cannot rewrite stats, names or anything else about an item.
GRANT UPDATE (`AllowableClass`) ON `acore_world`.`item_template` TO 'ash_admin'@'localhost';

-- classless_config does not exist yet; it is the cross-session request in
-- docs/decisions/0008-admin-panel.md. Uncomment once the server branch ships it.
-- GRANT SELECT, INSERT, UPDATE ON `acore_world`.`classless_config` TO 'ash_admin'@'localhost';

FLUSH PRIVILEGES;
