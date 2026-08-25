# Realm: Ashmorrow

Realm-specific data for the first Tomorrow's Ash realm.

| File | Purpose |
|---|---|
| `realmlist.sql` | the realm's row in the auth database |

The realm **name lives in the database, not in a config file** — that trips
people up. `worldserver.conf` has a `RealmID` (which row to be), while the name,
address and port come from the `realmlist` table.

Set it with:

```bash
python3 tools/ta.py db realm
```

which reads `realm_name`, `realm_address` and `realm_port` from
`tools/local.json` (defaults: `Ashmorrow`, `127.0.0.1`, `8085`).
