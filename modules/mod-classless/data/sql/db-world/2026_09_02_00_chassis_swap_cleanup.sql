--
-- Undo what the Shaman-era body-type migrations did to a realm.
--
-- Skirmisher moved from Shaman (7) to Hunter (3) on 2026-09-02
-- (docs/decisions/0008-body-type-client-patch.md section 10). The two generated
-- migrations have been regenerated for Hunter, and AzerothCore re-applies a
-- module file whose hash changed (UpdateFetcher.cpp:352, "Reapplying update ...
-- (it changed)"), so a realm will pick the new versions up on its next start.
--
-- But re-applying them does not UNDO the old ones. A realm that ran the Shaman
-- versions is left with:
--
--   * class 7 carrying the Skirmisher stat curve, on a class that is no longer
--     a body type and that nobody can create;
--   * playercreateinfo rows offering Shaman to all ten races, so the server
--     would accept a body type the design no longer has.
--
-- Both are reverted here from the backups the original migrations wrote, which
-- is why those tables existed. Class 8 (Adept) is untouched: it was a body type
-- before the swap and still is.
--
-- Safe on a realm that never ran the old versions: every statement is bounded
-- by the backup tables, which are empty or absent there. Safe to run twice.
--

-- ---------------------------------------------------------------------------
-- 1. Shaman's stats back to stock.
-- ---------------------------------------------------------------------------
UPDATE `player_class_stats` p
  JOIN `classless_class_stats_backup` b ON b.`Class` = p.`Class` AND b.`Level` = p.`Level`
   SET p.`BaseHP`    = b.`BaseHP`,
       p.`BaseMana`  = b.`BaseMana`,
       p.`Strength`  = b.`Strength`,
       p.`Agility`   = b.`Agility`,
       p.`Stamina`   = b.`Stamina`,
       p.`Intellect` = b.`Intellect`,
       p.`Spirit`    = b.`Spirit`
 WHERE p.`Class` = 7;

-- The backup rows for 7 have done their job; leaving them would let a later
-- re-run of this file overwrite a deliberately re-tuned Shaman.
DELETE FROM `classless_class_stats_backup` WHERE `Class` = 7;

-- ---------------------------------------------------------------------------
-- 2. Remove the Shaman race/class rows this project added.
--
-- Only the rows WE added, tracked in classless_createinfo_added. The four
-- race/Shaman pairs that ship with AzerothCore (Orc, Tauren, Troll, Draenei)
-- are stock data and are left exactly alone - deleting those would break a
-- plain AzerothCore install restored from this database.
-- ---------------------------------------------------------------------------
DELETE p FROM `playercreateinfo` p
  JOIN `classless_createinfo_added` a ON a.`race` = p.`race` AND a.`class` = p.`class`
 WHERE p.`class` = 7;

DELETE x FROM `playercreateinfo_action` x
  JOIN `classless_createinfo_added` a ON a.`race` = x.`race` AND a.`class` = x.`class`
 WHERE x.`class` = 7;

DELETE FROM `classless_createinfo_added` WHERE `class` = 7;
