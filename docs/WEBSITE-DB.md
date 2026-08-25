# Connecting a website to the Ashmorrow database

Everything a web app needs to talk to the realm: connection details, the schema
map, and — the part that trips everyone up — **how to create accounts**.

> **The one thing to know up front:** AzerothCore does **not** store a password
> hash. It stores an SRP6 `salt` and `verifier`. If your site writes
> `sha_pass_hash`, or hashes the password any other way, registration will
> appear to succeed and **login will silently fail**. Section 3 has verified,
> copy-pasteable implementations.

---

## 1. Quick start

```bash
# 1. create the least-privilege website DB user
#    (set a password in tools/local.json first: {"website_db_pass": "..."} )
python3 tools/ta.py db website-user

# 2. copy the connection template into your web project
cp web/.env.example /path/to/your/site/.env
#    then edit DB_PASSWORD to match what you set above
```

That's it for connectivity. Read on for the schema and account creation.

---

## 2. Connection details

### The three databases

AzerothCore splits data across three schemas. Your site will read from all
three and should only ever write to one table.

| Database | Contents | Website should |
|---|---|---|
| `acore_auth` | accounts, realm list, bans | **read + write `account`** (register, change password) |
| `acore_characters` | characters, guilds, achievements, mail | **read only** — armory, roster, rankings |
| `acore_world` | items, quests, creatures, spells | **read only** — item/quest lookups |

They are separate schemas on the **same MySQL server**, so one connection with
access to all three works — qualify table names (`acore_world.item_template`)
or open a connection per schema.

### Credentials

`ta.py db website-user` creates `ashweb` with deliberately narrow grants:

```
GRANT SELECT, INSERT, UPDATE ON acore_auth.account       -- register / change password
GRANT SELECT                 ON acore_auth.realmlist     -- realm status
GRANT SELECT                 ON acore_characters.*       -- armory
GRANT SELECT                 ON acore_world.*            -- item lookups
```

No `DELETE` anywhere. No access to `account_access` (GM levels) or
`account_banned`. **A compromise of the website cannot grant itself GM, unban
an account, or delete a character.** That is the point — do not widen these
without a specific reason. The SQL and its rationale are in
[`sql/website/001_website_db_user.sql`](../sql/website/001_website_db_user.sql).

Never point the website at the account the game server uses.

### Remote access

If the website runs on a different machine from MySQL:

1. Bind MySQL to the LAN interface — in `my.cnf`:
   `bind-address = 0.0.0.0` (then restart MySQL).
2. Open port 3306 **to the web host only**, not to the internet.
3. Set `DB_HOST` to the database machine's LAN IP.

Exposing MySQL to the public internet is not an acceptable shortcut. Use a
private network or an SSH tunnel.

---

## 3. Creating accounts (SRP6)

### Why it's not a password hash

AzerothCore authenticates with **SRP6**. The `account` table stores:

| Column | Type | Meaning |
|---|---|---|
| `username` | `varchar(32)` | **stored uppercase** |
| `salt` | `binary(32)` | 32 random bytes, per account |
| `verifier` | `binary(32)` | derived from username + password + salt |

There is no `sha_pass_hash` column on this core. Password verification is:

```
v = g ^ H(s || H(UPPER(u) || ':' || UPPER(p))) mod N

g = 7
N = 894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7
H = SHA1
```

Two details cause almost every broken implementation:

1. The inner SHA1 digest is read as a **little-endian** integer.
2. The verifier is stored **little-endian**, zero-padded to 32 bytes.

Get either wrong and you produce a verifier the server rejects at login, with
no useful error message anywhere.

### Verified implementations

[`web/srp6/`](../web/srp6/) has ready-to-use implementations:

| File | Runtime | Status |
|---|---|---|
| `srp6.py` | Python 3, stdlib only | **verified against the server** |
| `srp6.js` | Node.js, no dependencies | **verified against the server** |
| `srp6.php` | PHP 8, needs `ext-gmp` | ships with a self-test — run it first |

"Verified against the server" means the output was compared byte-for-byte with
AzerothCore's own `Acore::Crypto::SRP6`, by linking against the compiled core
and calling `MakeRegistrationData` / `CheckLogin` directly — in **both**
directions:

- given the server's salt, our code reproduces the server's verifier exactly;
- credentials our code generates are accepted by the server's `CheckLogin`.

The PHP version could not be executed in the build sandbox (`ext-gmp` was not
installable there), so it is **unverified by execution**. Run the self-test on
your machine before trusting it:

```bash
cd web/srp6 && ./selftest.sh
```

It checks each implementation against a test vector captured from the server
and prints PASS/FAIL per language. A FAIL means accounts made with that
implementation will not be able to log in.

### Registering an account

```js
const mysql = require('mysql2/promise');
const { makeRegistrationData } = require('./srp6/srp6.js');

async function register(username, password, email) {
  const { salt, verifier } = makeRegistrationData(username, password);

  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_AUTH,
  });

  // username MUST be stored uppercase - the client uppercases before login
  await db.execute(
    `INSERT INTO account (username, salt, verifier, email, expansion)
     VALUES (UPPER(?), ?, ?, ?, 2)`,
    [username, salt, verifier, email]
  );
  await db.end();
}
```

`expansion = 2` is Wrath of the Lich King, which matches our 3.3.5a client.
(`0` = vanilla, `1` = TBC.)

### Changing a password

Generate a **new** salt and verifier — never reuse the old salt:

```js
const { salt, verifier } = makeRegistrationData(username, newPassword);
await db.execute(
  `UPDATE account SET salt = ?, verifier = ?, session_key = NULL
   WHERE username = UPPER(?)`,
  [salt, verifier, username]
);
```

Clearing `session_key` forces any live session to re-authenticate.

### Checking a password (site login)

Recompute the verifier from the **stored salt** and compare in constant time —
`verifyPassword()` in each implementation does this. Never `SELECT` on a
password value.

---

## 4. Useful queries

**Realm status**

```sql
SELECT name, address, port FROM acore_auth.realmlist WHERE id = 1;
```

**Players online**

```sql
SELECT COUNT(*) FROM acore_characters.characters WHERE online = 1;
```

**Character list for an account**

```sql
SELECT c.guid, c.name, c.race, c.class, c.gender, c.level, c.money, c.totaltime
FROM acore_characters.characters c
JOIN acore_auth.account a ON a.id = c.account
WHERE a.username = UPPER(?)
ORDER BY c.level DESC;
```

**Top 50 by level**

```sql
SELECT name, level, race, class, totaltime
FROM acore_characters.characters
WHERE deleteDate IS NULL
ORDER BY level DESC, totaltime ASC
LIMIT 50;
```

**Item lookup**

```sql
SELECT entry, name, Quality, ItemLevel, RequiredLevel, class, subclass
FROM acore_world.item_template
WHERE name LIKE CONCAT('%', ?, '%')
LIMIT 25;
```

> **Relevant to this project:** `item_template.AllowableClass` is the bitmask
> that gates gear by class, and Phase 3 will rewrite it wholesale for the
> classless ruleset. If your site shows "usable by" information, read it from
> that column rather than hardcoding class rules, or it will go stale the day
> that migration lands. See [CLASS-RESTRICTIONS.md §2.4](CLASS-RESTRICTIONS.md).

**Class/race IDs** — `class` and `race` are small integers, not names
(1 = Warrior, 2 = Paladin, ... 8 = Mage; 1 = Human, 2 = Orc, ...). Map them in
your app or join against `acore_world.chr_classes_xp_for_level` /
your own lookup table. Note that on a classless realm, `class` becomes the
character's stat chassis rather than their playstyle — see
[ARCHITECTURE.md §6](ARCHITECTURE.md#6-the-unsolved-problem-hidden-class-chassis).

---

## 5. Gotchas

| Symptom | Cause |
|---|---|
| Registration works, login always fails | verifier computed wrong — run `web/srp6/selftest.sh` |
| Login fails for mixed-case usernames | `username` must be stored **uppercase** |
| `Table 'acore_auth.account' doesn't exist` | databases not imported yet — run `ta.py run world` once and let it finish |
| Can't connect from another host | MySQL `bind-address`, firewall, or the user is `'ashweb'@'localhost'` not `'@%'` |
| Character shows online after a crash | `characters.online` is stale until the server cleans up; don't treat it as authoritative |
| Site can read but not register | check `SHOW GRANTS FOR 'ashweb'@'%';` |

---

## 6. Security notes

- **Never commit `.env`.** It is gitignored; keep it that way.
- **Rate-limit registration.** Nothing in the schema stops account spam.
- **Validate usernames** against `^[A-Za-z0-9_-]{3,16}$` before insert. The
  column allows 32 characters but the client is happier with shorter names.
- **Email is not verified** by the core. If you need verified email, that's
  entirely your site's job.
- **The website user cannot ban, unban, or grant GM** — by design. If you build
  an admin panel that needs those, use a **separate** credential with its own
  grants and its own auth, rather than widening `ashweb`.
