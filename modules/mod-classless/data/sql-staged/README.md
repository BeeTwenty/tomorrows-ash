# `sql-staged/` — migrations that are written but must not run

AzerothCore's updater walks `data/sql/db-world`, `db-characters` and `db-auth`
and applies everything it finds on startup. This directory is deliberately
outside that tree, so nothing here executes.

It exists for generated migrations that are ready but whose *decision* has not
been made — a bulk rewrite of world data being the obvious case. Writing the
SQL and applying it are two different acts, and the second one belongs to the
product owner.

Promoting a file is one move:

```bash
git mv modules/mod-classless/data/sql-staged/<name>.sql \
       modules/mod-classless/data/sql/db-world/<YYYY_MM_DD_NN>_<name>.sql
```

CI checks that a staged filename has not also been left in the applied tree,
which is what a half-finished promotion looks like.

Currently empty: the Phase 3 item unlock lived here and was promoted to
`data/sql/db-world/2026_08_31_00_item_unlock_allowable_class.sql`.
Regenerate it any time with `python3 tools/audit_items.py --emit-sql`.
