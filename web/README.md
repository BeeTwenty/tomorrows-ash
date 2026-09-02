# Tomorrow's Ash — website

The public site for the **Ashmorrow** realm: landing page, account registration
and sign-in, armory, rankings, realm status, wiki and patch notes.

It is a **separate service**. It reads the realm's database and probes its
ports, but it builds, deploys, restarts and fails independently of the game
server. You can run the realm without this, and you can run this against a
realm on another machine.

> Deployment instructions for Windows and Linux live in
> **[SETUP.md §9](../SETUP.md#9-the-website)**. This file is the map of the
> code.

---

## Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router) + React 19, TypeScript |
| Styling | Tailwind CSS v4 with a hand-written design system in `src/app/globals.css` |
| Database | `mysql2` against AzerothCore's MySQL, plus one schema of our own |
| Auth | SRP6 written straight to `acore_auth.account`, signed cookie sessions |
| Runtime dependencies | six: `next`, `react`, `react-dom`, `mysql2`, `marked`, `nodemailer` |

That small a dependency set is deliberate. A public server's website is a
credential-handling surface, and every package added to it is another thing
that can be compromised on our behalf.

---

## Layout

```
web/
├── content/            the wiki and patch notes, as Markdown
├── sql/
│   ├── web-schema.sql  our own schema - reset tokens, rate limits, audit log
│   ├── grants.sql      least-privilege MySQL user
│   └── dev-fixture.sql sample AzerothCore-shaped data, development only
├── scripts/            start wrapper, standalone packaging, secret generator
└── src/
    ├── app/            routes (App Router) and the account Server Actions
    ├── components/     the design system in components
    └── lib/            everything that is not a page
```

### `src/lib` — where the work is

| Module | Responsibility |
|---|---|
| `env.ts` | validated configuration; refuses to hand out secrets to client code |
| `db.ts` | one pool, explicit schema names, capability probes |
| `srp6.ts` | SRP6 registration and verification, ported from the pinned core |
| `limits.ts` | constants and text rules the browser also needs (no `node:crypto`) |
| `accounts.ts` | register, authenticate, change password, reset |
| `session.ts` | HMAC-signed cookie sessions, invalidated by a password change |
| `rate-limit.ts` | fixed-window limits, in memory or in MySQL |
| `armory.ts` | character search and profiles |
| `build.ts` | reads the classless tables, or explains that they do not exist yet |
| `archetype.ts` | derives a build's title from its point distribution |
| `realm.ts` | status from TCP probes + `uptime` + online characters |
| `leaderboards.ts` | the five boards |
| `content.ts` | Markdown loading for the wiki and patch notes |
| `demo.ts` | a complete fake realm, for running with no database at all |
| `visibility.ts` | the one rule about which characters the public may see |
| `soap.ts` | optional worldserver console client |

---

## Running it

```bash
npm install
cp .env.example .env.local     # then edit
npm run gen-secret             # prints a SESSION_SECRET line to paste in
npm run dev                    # http://localhost:3000
```

With no `DB_HOST` configured the site starts in **demo mode**: every page
renders from `src/lib/demo.ts`, no database is touched, and the affected pages
say so on screen. That is what makes the design reviewable before a realm
exists.

Production:

```bash
npm run build
npm start                      # reads .env.local, serves the standalone build
```

Demo mode is not a database, though, and some things only break against a real
one. For a real MySQL with schema and sample data, without building the game
server:

```bash
python3 ../tools/ta.py web dev-db --yes   # database, schema, sample data, .env.local
python3 ../tools/ta.py web build && python3 ../tools/ta.py web start
```

Or through the repository's CLI, which works the same on Windows:

```bash
python3 ../tools/ta.py web setup    # install + configure + build
python3 ../tools/ta.py web sql      # create the site's schema
python3 ../tools/ta.py web start
```

---

## Checks

```bash
npm run check      # typecheck + lint + unit tests
npm test           # unit tests alone
```

The tests cover the parts where being wrong is silent: SRP6 byte order,
session signing, rate-limit arithmetic, archetype naming, input validation and
duration formatting.

The SRP6 test asserts against a vector captured from AzerothCore's own compiled
`Acore::Crypto::SRP6` ([docs/reference/srp6/testvector.json](../docs/reference/srp6/testvector.json)),
so CI proves this implementation agrees with the server whose accounts it
writes — not merely with itself.

One check cannot live in a unit test, because it needs a realm:

```bash
python3 ../tools/ta.py web verify-srp6 --username SOMEACCOUNT --password itspassword
```

Given an account **the server itself created**, that recomputes the verifier
from the stored salt and compares. A pass means the website can create accounts
the game client will accept. Run it once after any upstream bump.

---

## Things worth knowing before changing this

**The client's limits are the real limits.** Account names and passwords are
capped at 16 characters here because the 3.3.5a client cannot send more. A web
form that accepts more creates accounts nobody can log into.

**Everything the site owns lives in its own schema.** No column is ever added
to an AzerothCore table — the same rule the game module follows. The realm's
own SQL updater and ours can never collide.

**The classless tables belong to the module, not to us.** `build.ts` reads what
`modules/mod-classless/data/sql` creates and probes `information_schema` for the
columns that are still moving — ranks, a point budget — so Phase 2 can add them
without touching this code. On a realm that has not applied that SQL it falls
back to an honest "not yet" rather than inventing trees.

**Never prerender realm data.** Pages that read the database are
`force-dynamic`; caching happens inside the data layer. A page prerendered at
build time bakes in whatever data the build machine could see, which for a
container build is nothing.
