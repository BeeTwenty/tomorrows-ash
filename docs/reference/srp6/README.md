> **Moved.** These were under `web/` before the website existed. `web/` is
> now the Next.js application, whose own SRP6 lives in
> `web/src/lib/srp6.ts` and is checked against `testvector.json` by the
> unit tests. These implementations stay here for everything else that
> needs to create accounts - bots, scripts, a second site.

# SRP6 credential generation

AzerothCore stores an SRP6 `salt` + `verifier`, **not** a password hash. A
website that registers accounts or changes passwords must produce these.

See [docs/WEBSITE-DB.md](../../WEBSITE-DB.md) for the full guide.

## Run the self-test first

```bash
./selftest.sh
```

It checks each implementation against `testvector.json` — a
(username, password, salt, verifier) tuple captured from AzerothCore's own
`Acore::Crypto::SRP6` at the pinned commit.

**PASS** means accounts created with that implementation will authenticate.
**FAIL** means they will silently fail at login. There is no in-between and no
useful error at login time, which is exactly why this test exists.

## Files

| File | Runtime | Verification status |
|---|---|---|
| `srp6.py` | Python 3, stdlib only | verified against the compiled server, both directions |
| `srp6.js` | Node.js, no dependencies | verified against the compiled server, both directions |
| `srp6.php` | PHP 8 + `ext-gmp` | **not executed** — `ext-gmp` was unavailable in the build sandbox. Run `selftest.sh` before use. |
| `testvector.json` | — | ground truth from the server |
| `selftest.sh` | — | checks whichever runtimes are installed |

## Quick use

```bash
python3 srp6.py myuser mypassword
node     srp6.js myuser mypassword
php      srp6.php myuser mypassword
```

Each prints `salt=<hex>` and `verifier=<hex>`. In code, import
`make_registration_data` / `makeRegistrationData` and insert the raw bytes.

## The two things that break implementations

1. The inner SHA1 digest is read as a **little-endian** integer.
2. The verifier is stored **little-endian**, zero-padded to 32 bytes.

Both are load-bearing. Big-endian anywhere produces a verifier the server
rejects with no diagnostic.
