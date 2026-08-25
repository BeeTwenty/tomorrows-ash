-- Tomorrow's Ash - realm registration for "Ashmorrow"
--
-- Applied to the AUTH database (default: acore_auth).
-- `tools/ta.py db realm` runs the equivalent of this with values taken from
-- tools/local.json, which is the preferred route. This file is the reviewable
-- reference and a manual fallback.
--
-- IMPORTANT: `address` is what the client is redirected to AFTER login.
-- Leaving it 127.0.0.1 while connecting from another machine produces the
-- classic "login works but the realm shows offline" symptom. For a homelab
-- server set it to that machine's LAN IP.

DELETE FROM `realmlist` WHERE `id` = 1;

INSERT INTO `realmlist`
  (`id`, `name`, `address`, `localAddress`, `localSubnetMask`, `port`,
   `icon`, `flag`, `timezone`, `allowedSecurityLevel`, `population`, `gamebuild`)
VALUES
  (1, 'Ashmorrow', '127.0.0.1', '127.0.0.1', '255.255.255.0', 8085,
   0, 0, 1, 0, 0, 12340);

-- gamebuild 12340 = WoW 3.3.5a, the only client this core supports.
