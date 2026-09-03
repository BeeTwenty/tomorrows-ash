--
-- Close the gold-versus-mastery double economy.
--
-- A Vanguard IS a Paladin, and Trainer::IsTrainerValidForPlayer compares
-- getClass() (Trainer.cpp:209), so Paladin class trainers will sell a Vanguard
-- every Paladin rank for gold. Every other discipline costs scarce mastery.
-- That is a standing incentive to play your own chassis and ignore the
-- classless system entirely.
--
-- Decided 2026-09-01: strip the affected ranks rather than suppress class
-- trainers. Trainers stay as NPCs, keep their flavour, and keep selling
-- everything that is NOT part of a classless tree - professions, class utility,
-- riding. What comes off the list is exactly the ranks that would otherwise be
-- buyable twice: every rank of every spell chain a classless node heads.
--
-- The rule is the same for all three body types. Rank 1 comes from the tree,
-- ranks 2 and up come from mastery, and nobody can buy their way around it.
--
-- Scope, measured: 419 of 6,417 trainer_spell rows, 402 distinct spells,
-- across 14 trainers.
--
-- Reversible: classless_trainer_spell_backup holds every removed row.
--

CREATE TABLE IF NOT EXISTS `classless_trainer_spell_backup` (
  `TrainerId`     INT UNSIGNED     NOT NULL,
  `SpellId`       INT UNSIGNED     NOT NULL,
  `MoneyCost`     INT UNSIGNED     NOT NULL DEFAULT 0,
  `ReqSkillLine`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `ReqSkillRank`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `ReqAbility1`   INT UNSIGNED     NOT NULL DEFAULT 0,
  `ReqAbility2`   INT UNSIGNED     NOT NULL DEFAULT 0,
  `ReqAbility3`   INT UNSIGNED     NOT NULL DEFAULT 0,
  `ReqLevel`      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `removed_at`    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`TrainerId`, `SpellId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='mod-classless: trainer rows removed so ranks come only from mastery';

-- INSERT IGNORE so re-running never loses the original of a row already taken.
INSERT IGNORE INTO `classless_trainer_spell_backup`
  (`TrainerId`, `SpellId`, `MoneyCost`, `ReqSkillLine`, `ReqSkillRank`,
   `ReqAbility1`, `ReqAbility2`, `ReqAbility3`, `ReqLevel`)
SELECT ts.`TrainerId`, ts.`SpellId`, ts.`MoneyCost`, ts.`ReqSkillLine`, ts.`ReqSkillRank`,
       ts.`ReqAbility1`, ts.`ReqAbility2`, ts.`ReqAbility3`, ts.`ReqLevel`
FROM `trainer_spell` ts
WHERE ts.`SpellId` IN (
    SELECT r.`spell_id` FROM `spell_ranks` r
    WHERE r.`first_spell_id` IN (SELECT `spell_id` FROM `classless_node`));

DELETE ts FROM `trainer_spell` ts
WHERE ts.`SpellId` IN (
    SELECT r.`spell_id` FROM `spell_ranks` r
    WHERE r.`first_spell_id` IN (SELECT `spell_id` FROM `classless_node`));
