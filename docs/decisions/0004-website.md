# ADR 0004 — The public website

**Date:** 2026-08-26
**Status:** Accepted

## Context

The realm needs a public face: somewhere to register an account, look up a
character, see whether the realm is up, and read how the classless system
works. The brief asked for the stack to be proposed before it was built.

Three constraints shaped the answer more than taste did:

1. **It must deploy independently of the game server.** The realm is a C++
   build with a 15 GB build tree and an hours-long client-data extraction step.
   Coupling a website to that is how a website stops being updated.
2. **It handles credentials.** Account creation writes to the same
   `acore_auth.account` table the login server reads. Being wrong here does not
   produce a bug report, it produces compromised accounts.
3. **Most of it is prose.** A wiki, patch notes, an explainer. The dynamic
   parts — armory, status, sign-in — are a minority of the pages.

## Decision

A separate Next.js 15 service in `web/`, in TypeScript, talking to AzerothCore's
MySQL directly through `mysql2`, with SRP6 credentials written by us and one
schema of our own for the site's state.

Six runtime dependencies: `next`, `react`, `react-dom`, `mysql2`, `marked`, `nodemailer`.

## Rationale

**Why Next.js rather than Astro.** Astro would ship less JavaScript for a site
this content-heavy, and was the recommendation. Next was chosen by the product
owner, and it earns its keep on the parts that matter here: Server Actions give
the account forms a first-class server boundary with origin checking built in,
and Server Components keep every database query on the server by construction.
The cost is a larger dependency tree and faster framework churn.

**Why direct SQL for account creation rather than SOAP.** The alternative is
the worldserver's `account create` console command over SOAP, which uses the
core's own `AccountMgr` and would be immune to SRP6 ever changing. It also
requires the worldserver to be running, a SOAP port open, and a GM account's
credentials in the website's environment. Registration failing whenever the
realm restarts is the worse failure, and a restarting realm is exactly when new
players arrive. SOAP is implemented and available behind
`ACCOUNT_WRITE_MODE=soap`, off by default.

**Why SRP6 is ported rather than shelled out to.** The website has to produce
the same `salt`/`verifier` pair `AccountMgr::CreateAccount` would. That is 40
lines of well-understood arithmetic; the risk is not the maths but the byte
order, which is little-endian in three separate places. So: the port is
commented with the upstream file it came from, and it is checked twice over.

The unit test asserts against a vector captured from the compiled
`Acore::Crypto::SRP6` itself (`docs/reference/srp6/testvector.json`, produced by
linking against `libcommon.a`), so CI proves agreement with the server rather
than self-consistency. And `ta.py web verify-srp6` re-checks it against a live
realm's own `account` row, which catches configuration drift the test cannot
see.

**Why one schema of our own.** The site needs reset tokens, rate-limit counters
and an audit log. Putting them in AzerothCore's schemas would collide with its
SQL updater and violate the rule the game module already follows
([ARCHITECTURE §4](../ARCHITECTURE.md)): own your tables. So `ashmorrow_web`
exists, and no AzerothCore table ever gains a column.

**Why demo mode.** With no `DB_HOST`, every page renders from fixtures and says
so. The design, the armory layout and the build display were reviewable before
a realm existed — and a contributor can work on the site without building a
game server first.

## The armory's problem, and what it asks for

A normal armory prints "Fire Mage". This one cannot: there is no class, and
there is no spec. What a character *has* is a distribution of skill points
across ability trees, so identity has to be derived from the shape of that
spending. `archetype.ts` does it deterministically — a dominant tree gives one
title, two dominant trees compound into one word, a flat spread gives a third —
and every unrecognised tree name still gets a sensible title, because the real
tree list does not exist yet.

That system reads the module's own tables, created by
`modules/mod-classless/data/sql`. Phase 1 landed them while this was being
built, which settled two open questions:

- **`classless_node.name` exists**, and for the same reason the armory needed
  it: spell names live in the client's DBC files and never reach the server
  database. Abilities render as "Fireball (Improved)", not `Ability #25306`.
- **There are no ranks.** A node is bought once; there is no `rank` column and
  no `max_rank`. So a purchased node shows as "bought" and counts its cost once.

Phase 2 then added `cost_paid` and `granted` to `classless_character_node`, and
the armory picked both up through the same probe: points spent now come from
what a character was actually *charged*, so re-pricing a node in
`classless_node` no longer rewrites history for everyone who bought it earlier.

The budget total is the one number the site cannot get right on its own.
[PHASE2-BUDGET.md §5](../PHASE2-BUDGET.md) settles why: spend is an exact join
on `cost_paid`, but the total comes from a level curve whose parameters live in
`mod_classless.conf` and are written nowhere a website can read. It also
rejects mirroring that curve in website env vars as "the drift the no-table
decision was avoiding, just relocated", and it is right.

So the armory takes the three options in order: a curve the module publishes to
a table if one ever exists (probed for, so building it needs no change here),
then `CLASSLESS_POINTS_*` if an operator opts in knowingly, and otherwise no
denominator at all - "29 points spent", which is always true. The default is
the honest one.

None of it is assumed. `build.ts` probes `information_schema` for `rank`,
`max_rank`, `cost_paid`, `sort_order`, `enabled` and `description`, so a realm
mid-upgrade renders correctly either way — and one that has not applied the
module SQL at all still gets the honest "not yet" panel.

## Consequences

- Node.js 20+ becomes a dependency for anyone running the public site. It is
  not needed to build or run the realm.
- The website is a second thing to keep current with upstream. The exposure is
  small and named: the `account` table's columns, and SRP6. `verify-srp6` is the
  check that catches both.
- Rendering realm data at request time means the site cannot be deployed as
  static files. That is the price of not baking a build machine's view of the
  world into the output.

## Rejected

- **A PHP panel** (the private-server default). It would be quicker to stand up
  and would sit outside every check this repository already runs — no types, no
  tests, no CI.
- **Sharing the realm's `ta.py`-managed MySQL credentials.** The site gets its
  own least-privilege user instead (`web/sql/grants.sql`): read on the game
  data, column-scoped writes on `account`, and nothing else.
- **Static export.** Half the site is live data, and the half that is not is not
  worth splitting the deployment for.
