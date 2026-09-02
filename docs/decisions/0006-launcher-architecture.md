# ADR 0006 — The Ashmorrow launcher: stack and architecture

**Date:** 2026-08-28
**Status:** **Accepted** (product owner, 2026-08-28) and built.

Companion to [ADR 0005](0005-client-distribution.md), which decides *what the
launcher is allowed to fetch*. This one decides *what it is built out of*.

---

## 1. What the launcher is actually for

Strip the brief down and there are five jobs, in descending order of how much
they matter:

1. **Tell the player the truth about their client.** Is this a 3.3.5a build
   12340 install? Are the files intact? What exactly is wrong?
2. **Launch the game correctly**, on Windows natively and on Linux through Wine
   or Proton, without the player learning what a prefix is.
3. **Write config.** `realmlist.wtf`, `Config.wtf`, and place any patch of ours.
4. **Keep itself and our patches current.**
5. **Know who the player is**, against the same accounts the website uses.

Two things the brief asks for turn out to be smaller than they sound, and it is
better to say so now than to discover it in week three:

- **The classless gossip UI needs nothing injected.** That is the whole point of
  the design — [ADR 0003](0003-no-blizzard-talents.md) and the Phase 1 research
  chose gossip menus precisely because an unmodified client renders them.
  There is no client-side config for the ability broker. There never was.
- **New ability-tree data and itemisation changes are server-side rows.** They
  reach players on the next login, not through a download. The update channel
  is real and worth building — Phase 3 may eventually want custom icons — but it
  will spend most of its life reporting "nothing to install", and the UI should
  be designed for that being the normal state rather than treating it as an
  error.

---

## 2. Stack options

| | Size | Hot path (hash 15 GB) | New language | Player-side risk | Velocity |
|---|---|---|---|---|---|
| **Electron + TS** | 90–130 MB | Workers + node:crypto, workable | none | we ship and must patch a Chromium | high |
| **Tauri 2 (Rust + web UI)** | 6–12 MB | rayon + blake3, disk-speed | Rust | OS webview, small surface | medium-high |
| **Native (Qt/C++, WPF+GTK)** | 5–20 MB | trivial | none (C++ already here) | small | low — two UIs or heavy Qt |
| **Go + Wails** | 15–25 MB | good | Go | OS webview | medium |
| **Python + PySide, PyInstaller** | 40–80 MB | poor (GIL, slow IO) | none | **chronic AV false positives** | medium |
| **No GUI — `ta.py play`** | 0 | fine | none | none | highest |

### Recommendation: **Tauri 2**, Rust core with an HTML/CSS/TypeScript UI.

Five reasons, weighted:

**The download we are judged on is ours.** The launcher is the first thing a
prospective player installs, before they have decided to care about us. Eight
megabytes versus a hundred is a real conversion difference, and it sits oddly
next to a 15 GB game to arrive as a 130 MB download that does nothing but check
files.

**The hot path is hashing, and it is the only place performance matters.**
Verifying a full client means reading ~15 GB. Rust with `rayon` and `blake3`
does that at whatever the disk will give. Node can get close with worker
threads, but with more ceremony and a much larger resident set on the machines
least able to afford it.

**We are asking people to run our binary with write access to their game
folder.** Bundling Chromium means owning a Chromium CVE treadmill on other
people's computers, for a program that shows a progress bar. Using the OS
webview hands that duty to Microsoft and the distro. Given §6 of ADR 0005 — we
will already be fighting antivirus heuristics — a small, boring, unpacked binary
is worth a lot.

**The UI is most of the product.** A launcher is judged on how it looks in the
four seconds before the game opens. HTML and CSS give the most design leverage
per hour and keep the design work in the same language as `web/`, so the tokens
in [LAUNCHER-DESIGN.md](../LAUNCHER-DESIGN.md) are directly usable.

**Signed auto-update is first-class in Tauri** and we need it — a launcher that
cannot update itself is a launcher that has to be re-downloaded manually the
first time we get something wrong.

### The honest cost of choosing it

Rust is a third language in a repo that already runs Python and C++ and
TypeScript. Linux needs `libwebkit2gtk-4.1` present, which is a real dependency
on some distros — mitigated by shipping an AppImage alongside the `.deb`, and by
the fact that anyone installing Wine to play WoW is not going to be startled by
one package. Cross-compiling Windows from Linux is not realistically supported at all, so
**the `.exe` can only be produced on Windows** — releases build on a GitHub
Actions matrix (`windows-latest` + `ubuntu-22.04`), which is
[`.github/workflows/release.yml`](../../.github/workflows/release.yml) and
which we want anyway for reproducibility.

### If you would rather not add Rust

**Electron** is the acceptable fallback and I will not argue hard. It shares a
language with `web/`, the ecosystem is bottomless, and `electron-updater` is
mature. Pay for it in size, memory, and a Chromium you are responsible for.

**`ta.py play`** — worth knowing this exists as an option. A `play` subcommand
that verifies, writes realmlist and launches through Wine is roughly 250 lines
of Python we could have working today, on both platforms, with no new anything.
It is not a launcher for the player who cannot edit `realmlist.wtf`, which is
the player a launcher is for. I suggest building it *anyway*, as the debug tool
and the reference implementation the GUI is checked against.

---

## 3. Layout

```
launcher/
  README.md               the six rules from ADR 0005, in the code's own house
  core/                   ALL behaviour, as a plain library with no GUI dep
    src/
      app.rs              the state machine the shell drives
      manifest.rs         the types that make ADR 0005 rule 1 a parse error
      verify.rs           parallel BLAKE3, streaming progress, mtime cache
      client.rs           detection; the build read out of Wow.exe itself
      install.rs          realmlist.wtf, Config.wtf, patch placement
      launch.rs           Windows: spawn directly. Linux: wine/proton.
      wine.rs             prefix management, Proton discovery, env assembly
      net.rs              the HTTP transport, here so that CI compiles it
      source.rs           where a client may come from. One variant.
      settings.rs         per-user config in the OS config dir
  src-tauri/              the window, and nothing else
  ui/                     UI — TypeScript, no framework
  manifests/
    schema.json           the manifest contract
    ashmorrow.json        realm config; client hashes once we can generate them
  tools/
    hash_client.py        run against YOUR client, emits a manifest. Facts only.
  README.md
```

`launcher/` is its own service, deployed on its own cadence, exactly like `web/`
and for the same reason (ADR 0004): coupling something that ships weekly to
something that takes an hour to build is how the fast thing stops shipping.

The `core` / `src-tauri` split earned itself during the build. `src-tauri`
cannot compile without a system webview, so anything living in it is outside
`cargo test`'s reach — which is why even the HTTP transport ended up in `core`
behind a feature flag. The shell is now 150 lines of argument marshalling, and
the 58 tests cover everything else.

---

## 4. The website's side of it

Four endpoints in `web/`, reusing what is already there:

| Endpoint | Does | Reuses |
|---|---|---|
| `GET /api/launcher/manifest` | signed JSON: required build, client hash list, our patch list, realm address and ports, minimum launcher version | `lib/realm.ts` |
| `POST /api/launcher/session` | username + password → short-lived token | `lib/accounts.ts` `authenticate()`, `lib/rate-limit.ts` |
| `GET /api/launcher/account` | account state, characters, budget — bearer token | `lib/armory.ts` |
| `GET /api/launcher/release` | latest launcher version + signature | static |

The manifest is signed with a key the launcher ships as a public half, so a
compromised CDN cannot make the launcher write attacker-chosen files into a game
directory. That threat is the reason the patch channel needs signing at all.

---

## 5. Four things that will not work the way one might hope

**Auto-login stops at the account name.** The client performs its own SRP6
handshake against the auth server; there is no supported channel for handing it
a password. What *is* possible and harmless is pre-filling the account name
through `WTF/Config.wtf` (`SET accountName`), which is what real launchers do.
Filling the password field means writing into the running client's memory —
which rule 3 of ADR 0005 forbids, and which is also the single thing most likely
to get us flagged as malware. **So: name yes, password no.** The launcher's
login is for showing you your account and characters, not for skipping the game's
login screen.

**Verification has to be tiered, or it is useless.** Real 3.3.5a installs in the
wild vary by locale, by which optional MPQs are present, and by how many times
they have been repacked. A launcher that demands byte-exact equality with one
reference install will reject most genuine clients and become a support queue.

- *Tier 1, blocking:* is this a 12340 client at all? `Wow.exe` present, build
  number read from its version resource, the expected MPQ set present.
- *Tier 2, advisory:* per-file hashes against our known-good manifest. A
  mismatch is reported precisely — "3 files differ from known-good enUS" — and
  is a warning, not a refusal. We do not know that the player's copy is wrong;
  we know it is not the one we measured.
- *Tier 3, blocking:* files **we** installed must match **our** hashes exactly.
  That is the half of the manifest we actually control, and the half that
  matters for security.

**Nobody can generate the manifest but you.** Hashes are facts and safe to
publish, but they have to be measured from a real client, and there is not one
in this sandbox. `cargo run --bin ashmorrow-manifest -- hash <client>` emits it;
until someone has, Tier 2 is empty and the launcher is honest about that in the
UI.

That tool is Rust rather than a script beside the others for one reason: the
hashes it emits have to be the hashes the verifier computes, and the only way to
guarantee that is to call the same code. Python has no BLAKE3 in its standard
library, so a script would have meant either a second implementation or a
dependency players' machines would need — and a second implementation of a hash
is a second thing that can be subtly wrong.

**Proton is not Wine with a nicer name.** Running through Proton needs
`STEAM_COMPAT_DATA_PATH` and `STEAM_COMPAT_CLIENT_INSTALL_PATH` set and the
`proton run` wrapper, and Proton versions live in Steam library folders that must
be discovered by parsing `libraryfolders.vdf`. Plain Wine needs a prefix we own.
The launcher manages its own prefix at `~/.local/share/ashmorrow/prefix` and
never touches an existing one — the failure mode of "the launcher broke my other
games' prefix" is not one we want to own. We detect and instruct; we never bundle
or install Wine ourselves.

---

## 6. Packaging and CI

- Release matrix on GitHub Actions: `windows-latest` → `.exe` + `.msi`;
  `ubuntu-22.04` → `.AppImage` + `.deb`. Ubuntu is pinned rather than `latest`
  because an AppImage inherits the glibc of the machine that built it.
- The Tauri CLI is a dev dependency of `launcher/package.json` rather than a
  global `cargo install`: `npm install && npm run build` is the whole build,
  and `cargo install tauri-cli` compiles the CLI from source every time a new
  machine joins.
- **Unsigned initially**, with published SHA-256 sums, per ADR 0005 §6.
- CI additions in the spirit of the jobs already in `ci.yml`:
  - `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.
  - **The distribution guard:** fail on `magnet:`, `.torrent`, known client
    mirror hostnames, or any file over 1 MB under `launcher/`. ADR 0005's rules
    1 and 4, enforced by a machine rather than by memory.
  - Manifest validates against `manifests/schema.json`.

---

## 7. Open questions

1. **Does the launcher ship before the realm is playable?** It cannot be tested
   end-to-end without a client and a running realm, and Phase 1's play test is
   still blocked on the same thing. Suggest: build it, ship it as a pre-release,
   call it beta until someone has actually launched the game with it.
2. **`LICENSE`** — still missing from the repo (ADR 0005 §8).
3. **Nothing has been built end to end.** `launcher/core` is tested and
   `ta.py play` was exercised against a synthetic client, but no machine in
   this project has yet compiled the Tauri shell (it needs WebKitGTK) or
   started a real client with either of them.
