--
-- Nobody skips the body-type restriction, not even an administrator.
--
-- CharacterCreating.Disabled.ClassMask is only consulted when the account
-- lacks RBAC permission 15, "Skip character creation class mask check"
-- (CharacterHandler.cpp:344):
--
--     if (!HasPermission(rbac::RBAC_PERM_SKIP_CHECK_CHARACTER_CREATION_CLASSMASK))
--     {
--         uint32 classMaskDisabled = sWorld->getIntConfig(CONFIG_CHARACTER_CREATING_DISABLED_CLASSMASK);
--         if ((1 << (createInfo->Class - 1)) & classMaskDisabled)
--             SendCharCreate(CHAR_CREATE_DISABLED);
--     }
--
-- Stock AzerothCore attaches that permission to "Role: Sec Level Moderator"
-- (194), and the roles nest: Administrator (192) -> Gamemaster (193) ->
-- Moderator (194) -> Player (195). So every account at gmlevel 1 or above
-- silently bypasses the check, while a gmlevel 0 player is blocked correctly.
-- On a realm run by its owner, that means the person doing the testing is the
-- one account the restriction does not apply to.
--
-- On Ashmorrow the three body types are not a moderation convenience, they are
-- the design. A Warrior created by a GM has no body type: no armor ladder, no
-- chassis stats, nothing the classless system knows how to price. So the
-- permission comes off the role entirely and nobody can create one.
--
-- Reversible: classless_rbac_backup holds the rows removed.
--

CREATE TABLE IF NOT EXISTS `classless_rbac_backup` (
  `id`          INT UNSIGNED NOT NULL,
  `linkedId`    INT UNSIGNED NOT NULL,
  `removed_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`, `linkedId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='mod-classless: RBAC links this realm removed, so they can be restored';

INSERT IGNORE INTO `classless_rbac_backup` (`id`, `linkedId`)
SELECT `id`, `linkedId` FROM `rbac_linked_permissions` WHERE `linkedId` = 15;

DELETE FROM `rbac_linked_permissions` WHERE `linkedId` = 15;
