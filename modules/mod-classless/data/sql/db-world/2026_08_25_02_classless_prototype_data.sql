-- Tomorrow's Ash - Phase 1 prototype ability data
--
-- A deliberately small, deliberately OFF-CLASS set whose only job is to prove
-- the mechanism end to end. This is not a balance pass and these are not the
-- final trees.
--
-- Every spell id below was verified to exist by its presence as a rank-chain
-- root in `spell_ranks`, and each was run through tools/spell_cascade.py to
-- confirm what granting it drags in (answer: nothing, for a character who does
-- not already know a higher rank - see docs/PHASE1-FINDINGS.md).

DELETE FROM `classless_node` WHERE `id` BETWEEN 1 AND 999;
DELETE FROM `classless_tree` WHERE `id` BETWEEN 1 AND 999;

INSERT INTO `classless_tree` (`id`, `name`, `description`, `sort_order`) VALUES
  (1, 'Fire',          'Destructive flame. High damage, no subtlety.',        10),
  (2, 'Frost',         'Cold and control. Slower, safer, relentless.',        20),
  (3, 'Holy',          'Light and mending. Keeps others upright.',            30),
  (4, 'Sword Mastery', 'Weapon craft. Rewards closing the distance.',         40),
  (5, 'Stealth',       'Shadow and opportunity. Strike from where none look.',50);

-- tier 1 = entry rank, proves the grant works at any level
-- tier 2 = a mid/high rank, so the ability is actually worth casting
--
-- required_level is OUR gate. Player::learnSpell() performs no level check at
-- all, so without this a level 1 character could buy a rank 12 nuke.
INSERT INTO `classless_node`
  (`id`, `tree_id`, `spell_id`, `name`, `description`, `tier`, `cost`, `required_level`, `requires_node`, `sort_order`)
VALUES
  -- Fire: Fireball
  (101, 1,   133, 'Fireball',            'A slow bolt of flame.',            1, 1,  1,   0, 10),
  (102, 1, 25306, 'Fireball (Improved)', 'The same flame, far angrier.',     2, 3, 40, 101, 20),

  -- Frost: Frostbolt
  (201, 2,   116, 'Frostbolt',           'A chilling bolt that slows.',      1, 1,  1,   0, 10),
  (202, 2, 25304, 'Frostbolt (Improved)','Deeper cold, harder bite.',        2, 3, 40, 201, 20),

  -- Holy: Holy Light
  (301, 3,   635, 'Holy Light',          'A slow, efficient mend.',          1, 1,  1,   0, 10),
  (302, 3, 25292, 'Holy Light (Greater)','A far stronger mend.',             2, 3, 40, 301, 20),

  -- Sword Mastery: Mortal Strike
  -- NOTE: Mortal Strike is a Warrior TALENT spell in stock WoW. It is included
  -- deliberately - it is the test case for whether talent-derived spells are
  -- learned per-spec and vanish on spec switch. See docs/PHASE1-FINDINGS.md.
  (401, 4, 12294, 'Mortal Strike',       'A wound that resists healing.',    1, 1, 10,   0, 10),
  (402, 4, 25248, 'Mortal Strike (Improved)', 'A deeper, meaner wound.',     2, 3, 40, 401, 20),

  -- Stealth: Backstab
  (501, 5,    53, 'Backstab',            'A strike from behind. Requires a dagger.', 1, 1, 10,  0, 10),
  (502, 5, 25300, 'Backstab (Improved)', 'A practiced killing blow.',        2, 3, 40, 501, 20);
