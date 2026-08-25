# mod-classless

The classless ability system for **Tomorrow's Ash**, as an AzerothCore module.

## Status: Phase 0 — inert skeleton

Registers with the core, compiles, and **changes no gameplay**. The ability
system arrives in Phase 1.

What exists:
- config loading (`Classless.*`)
- a login notice
- the `OnPlayerCalculateTalentsPoints` hook that Phase 2 uses to retire
  Blizzard talents

## Design rules

These are not style preferences — they are what keeps this module safe to
carry against a moving upstream.

**1. Fail-safe by default.** Every hook returns early unless `Classless.Enable`
is `1`. Dropping this module into a stock realm must change nothing.

**2. Own your tables.** State lives in `classless_*` tables applied from
`data/sql/db-world/` and `data/sql/db-characters/`. AzerothCore's updater picks
those up automatically. **Never** add columns to core tables.

**3. Data over code.** Trees, costs and prerequisites are rows, not `switch`
statements. Rebalancing a public server must not need a recompile.

**4. No core modifications.** If you think you need one, re-read
[docs/CLASS-RESTRICTIONS.md](../../docs/CLASS-RESTRICTIONS.md) — the acquisition
path is almost certainly open already. `Player::learnSpell()` has no class
check.

## Layout

```
conf/mod_classless.conf.dist   configuration (installed to dist/etc/)
src/                           C++ sources, compiled into worldserver
data/sql/db-world/             world-DB migrations, auto-applied
data/sql/db-characters/        character-DB migrations, auto-applied
```

The loader entry point is `Addmod_classlessScripts()` in `ClasslessScripts.cpp`
— AzerothCore derives that name from the directory (`mod-classless` →
`Addmod_classlessScripts`), so **the directory name and the function name must
stay in sync**.

## Hook rules worth remembering

Boolean hooks (`OnPlayerCanX`) can only **veto**, never grant
(`ScriptMgrMacros.h:76`). Anything that needs to *loosen* a restriction must be
done in SQL, or via a new acquisition path we control. There is no hook that
will let a module hand out an item the character's class can't use — that is
`item_template.AllowableClass`, and it is SQL.

## Building

The module is built automatically as part of the server; see
[SETUP.md](../../SETUP.md). After editing sources, if `ta.py` reported *copy*
mode rather than symlink/junction, run `python3 tools/ta.py sync` first.
