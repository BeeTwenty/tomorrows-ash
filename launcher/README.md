# The Ashmorrow launcher

Verifies a World of Warcraft 3.3.5a client **you already own**, points it at
the Ashmorrow realm, installs Ashmorrow's own patches, and starts the game —
natively on Windows, through Wine or Proton on Linux.

It replaces "edit `realmlist.wtf` and run `Wow.exe`" as the *recommended* route.
It does not replace it as the *only* route: the manual instructions on `/play`
stay documented forever, because they are the fallback when this is broken,
unavailable, or simply not trusted.

---

## The six rules

From [ADR 0005](../docs/decisions/0005-client-distribution.md). They are not
aspirations; four of the six are enforced by something that runs.

1. **The launcher never downloads, hosts, seeds, mirrors, links to, or embeds a
   locator for any Blizzard-authored file.**
2. Our patch channel carries only content we authored or licensed.
3. **We never modify a Blizzard binary** — not on disk, not in memory, not at
   runtime.
4. Manifests contain hashes, paths and sizes. Facts only, never bytes.
5. The launcher is branded Ashmorrow. No Blizzard marks, no game art.
6. No money, anywhere near any of it.

**How rules 1 and 4 are enforced rather than promised.** In
[`core/src/manifest.rs`](core/src/manifest.rs), a `ClientFile` — an entry
describing a file of Blizzard's — has a path, a size and a hash, and no field a
download location could go in. It is `deny_unknown_fields`, so a manifest that
adds one fails to parse rather than being quietly ignored. Only a `Patch`, which
describes a file *we* wrote, carries a URL. There is a test for it, an
integration test that greps the shipped manifests, and a CI job that greps the
whole directory.

Rule 3 is why the launcher can pre-fill your account *name* on the login screen
but not your password: filling the password field means writing into the running
client's memory. See "What it will not do" below.

---

## Layout

```
core/         the whole of the launcher's behaviour, as a plain Rust library
              with no GUI dependency — so the half that can corrupt someone's
              game directory is testable in CI without a webview or a game
core/src/bin/ ashmorrow-manifest: generate and check the hash manifest
src-tauri/    the window. Thin: every command is marshalling over core
src-tauri/capabilities/
              what the window is allowed to ask for. Not boilerplate — see below
ui/           the interface. TypeScript, no framework, 14 kB
test/         the headless smoke test: starts the real binary and launches a game
manifests/    the manifest schema, and Ashmorrow's own manifest
tools/        icon and font generation, both reproducible from source
```

Why the split: `src-tauri` cannot be built without a system webview, so anything
that lives in it is outside `cargo test`'s reach. Pushing logic into the shell
means pushing it out of CI. The HTTP transport lives in `core` behind a feature
flag for exactly that reason.

### `src-tauri/capabilities/` is load-bearing

Tauri 2 refuses every `plugin:` command that no capability grants — *including
its own core ones*, and including them at runtime, on the player's machine,
rather than at build time. With no `capabilities/` directory the interface's
`listen()` is rejected, `plugin:dialog|open` is rejected, and nothing in
`cargo fmt`, `clippy`, the tests or the typecheck notices.

That is exactly how the launcher shipped broken: subscribing to progress events
threw before a single line of state had loaded, so every tab came up empty and
the window had nothing on it to say why. `default.json` grants `core:default`
and `dialog:allow-open`, and the interface is now written so that a refusal
costs the progress bar and nothing else.

Two things keep it that way, and both fail on the pre-fix build:

- CI checks that every plugin the interface imports has a matching permission,
  and that the capability targets a window label that exists.
- `launcher/test/smoke-linux.sh` starts the real binary and asserts it got to a
  launch.

---

## Building it

**The short version.** You need Rust, Node, and — on Linux only — a handful of
system libraries. Then two commands from `launcher/`:

```
npm install
npm run build
```

That is the whole build. It compiles the Rust, builds the interface, and
produces installers. There is no global tool to install: the Tauri CLI is a dev
dependency of `launcher/package.json`, so `npm install` brings it — and brings
`ui/`'s dependencies too, through a `postinstall`, so one install covers both.

**A platform builds only for itself.** `npm run build` on Linux produces an
AppImage and a `.deb`; on Windows it produces an `.exe` and an `.msi`.
Cross-compiling a Windows launcher from Linux is not realistically supported by
Tauri, so **there is no way to produce the `.exe` except on a Windows machine or
on a Windows CI runner.** If you have no Windows machine, skip to
[Releases](#releases) — that is what the workflow is for.

### Windows — producing the `.exe`

**Prerequisites**

| | Where |
|---|---|
| Rust | [rustup.rs](https://rustup.rs) — the default `stable-msvc` toolchain |
| Node 20+ | [nodejs.org](https://nodejs.org) |
| MSVC build tools | [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), workload **"Desktop development with C++"**. Full Visual Studio works too — SETUP §2.1 already has it for the server |
| WebView2 | Already present on Windows 10 21H2 and later. Nothing to do |

`rustup` will not install the MSVC linker for you; that is what the build tools
are for. Without them the first `cargo` step fails with `link.exe not found`.

**Build**

```powershell
cd launcher
npm install
npm run build
```

First build is 5–15 minutes — it compiles Tauri and its dependency tree from
source. Subsequent builds are seconds unless you touch the Rust.

**What you get**, under `launcher\src-tauri\target\release\`:

| File | What it is |
|---|---|
| `bundle\nsis\Ashmorrow_0.1.0_x64-setup.exe` | **The installer.** This is the one you hand to a player |
| `bundle\msi\Ashmorrow_0.1.0_x64_en-US.msi` | Same thing for anyone deploying by group policy |
| `ashmorrow-launcher.exe` | The bare executable. Runs, but installs no shortcut and cannot self-update |

The version in those names comes from `version` in
`src-tauri/tauri.conf.json`, so it moves when you bump a release.

### Linux — producing the AppImage and `.deb`

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl libssl-dev \
                 libayatana-appindicator3-dev librsvg2-dev file patchelf

cd launcher
npm install
npm run build
```

`patchelf` and `file` are only needed for the AppImage, and their absence
produces a confusing failure late in an otherwise successful build, so install
them up front. On Fedora the equivalents are `webkit2gtk4.1-devel`,
`openssl-devel`, `librsvg2-devel` and `patchelf`.

**What you get**, under `launcher/src-tauri/target/release/`:

| File | What it is |
|---|---|
| `bundle/appimage/Ashmorrow_0.1.0_amd64.AppImage` | Runs on any distribution. `chmod +x` and go |
| `bundle/deb/Ashmorrow_0.1.0_amd64.deb` | For Debian and Ubuntu |
| `ashmorrow-launcher` | The bare binary |

An AppImage inherits the glibc of the machine that built it, so one built on a
current Ubuntu will refuse to start on an older distribution. That is why the
release workflow pins `ubuntu-22.04`.

### Running it while you work on it

```bash
cd launcher
npm run dev
```

Hot-reloads the interface and rebuilds the Rust when it changes. Point it at a
website other than production with `ASHMORROW_BASE_URL`:

```bash
ASHMORROW_BASE_URL=http://127.0.0.1:3000 npm run dev
```

### Only some bundles

```bash
npm run build -- --bundles nsis        # just the .exe installer
npm run build -- --bundles appimage    # just the AppImage
```

### When the build fails

```bash
cd launcher && npx tauri info
```

That prints every prerequisite with a tick or a cross beside it, and is the
first thing to run — and the first thing to paste into a bug report.

| Symptom | Cause |
|---|---|
| `webkit2gtk-4.1: not installed` from `tauri info` | the Linux dependency list above |
| `try setting PKG_CONFIG_PATH to the directory containing gdk-3.0.pc` | the same thing, as the compiler phrases it. Install the Linux list |
| `link.exe not found` (Windows) | the MSVC build tools are missing, not Rust |
| `failed to bundle project` after a clean compile | a packaging tool is missing — `patchelf` or `file` on Linux. The Rust built fine |
| `beforeBuildCommand ... failed` | the interface did not build. Run `npm run build` in `launcher/ui` on its own to see the real error |
| Slow first build, no output for minutes | normal. Tauri's dependency tree is large and compiles once |

### Working on the interface without any of that

The UI answers from a demo adapter when Tauri is not present, so it opens in an
ordinary browser — no Rust, no webview, no client:

```bash
cd launcher/ui && npm install && npm run dev     # http://localhost:5173
```

(`ui/` stands on its own, so this works whether or not you have ever run an
install at `launcher/`.)

That is how the design gets reviewed, and how the interface is worked on
without a Rust toolchain and a 15 GB client on the machine.

### Testing the part that matters

```bash
cargo test   --manifest-path launcher/core/Cargo.toml
cargo clippy --manifest-path launcher/core/Cargo.toml --all-targets -- -D warnings
cd launcher/ui && npm run typecheck
```

No webview needed for any of it — that is the point of keeping every behaviour
in `core/`.

Two more, which cover the part `core/` cannot:

```bash
cd launcher/ui && npm run build && npm run test:startup   # the interface, in a real browser
launcher/test/smoke-linux.sh                              # the real binary, driven to a launch
```

`test:startup` drives the built bundle in Chromium with the Tauri bridge stubbed
at `window.__TAURI_INTERNALS__`, once against a reachable realm, once against an
unreachable one, and once with every `plugin:` command refused. Each of those
three is a failure that reached a player.

`smoke-linux.sh` is the one that would have caught both. It needs `Xvfb`,
`xdotool`, ImageMagick and a built launcher; it generates a three-file client
with a genuine build-12340 version resource, stands a realm up on loopback,
puts a recording shell script on `PATH` where Wine would be, presses the launch
bar twice, and then asserts that the launcher wrote `realmlist.wtf` and invoked
the runtime with the right prefix, working directory and arguments. It runs on
every push, on the Linux leg of the build workflow.

There is no Windows equivalent yet, so a Windows-only regression is still on
whoever runs the `.exe` to find.

### Getting a build without building it

**Every push builds both platforms and leaves the binaries on the workflow
run.** Actions tab → the run for your commit → *Artifacts* at the bottom:

| Artifact | Holds |
|---|---|
| `launcher-Windows-<sha>` | `Ashmorrow_*_x64-setup.exe`, the `.msi`, and the bare `ashmorrow-launcher.exe` |
| `launcher-Linux-<sha>` | the `.AppImage`, the `.deb`, and the bare binary |

For testing a change, take the **bare executable** rather than the installer —
it runs as-is, installs nothing, and leaves nothing behind when you delete it.

Artifacts are kept 14 days and named with the commit SHA, so several builds in
the list are tellable apart. GitHub serves them as `.zip` regardless of what is
inside.

### Releases

Tag it and CI builds both platforms *and* publishes:

```bash
git tag launcher-v0.1.0
git push origin launcher-v0.1.0
```

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs
`windows-latest` and `ubuntu-22.04` in parallel, tests the core, builds each
platform's bundles, writes `SHA256SUMS.txt`, and opens a **draft** release with
everything attached. Draft, so you look before anyone downloads.

To check a build without tagging, run the workflow manually from the Actions
tab — it builds and leaves the installers as workflow artifacts without
publishing anything.

**The Windows job is proven as far as the tests; the bundling step is not yet.**
Its first run found a genuine cross-platform bug — a test asserting Unix path
semantics that Windows disagreed with — which is a fair advertisement for having
it. Whether `cargo tauri build` completes and produces an installer on the
Windows runner has not been observed yet at the time of writing; the run after
the fix is the one that answers it.

---

## Without the GUI

`tools/ta.py play` does the same work from a terminal, in Python, with no
dependencies and no Rust build. It is the reference implementation, the way to
test a realm over SSH, and the thing to reach for when the launcher itself is
the suspect.

```bash
python3 tools/ta.py play doctor --client /path/to/WoW-3.3.5a
python3 tools/ta.py play verify --client /path/to/WoW-3.3.5a
python3 tools/ta.py play run    --client /path/to/WoW-3.3.5a --dry-run
```

Put `{"client_path": "/path/to/WoW-3.3.5a"}` in `tools/local.json` and the
`--client` flag becomes optional.

---

## The hash manifest

`manifests/ashmorrow.json` ships with an **empty** file list, and that is the
honest current state: hashes have to be measured against a real 3.3.5a client,
and nobody has done that yet. Until they are, the launcher checks structure and
build number and says so in its own interface rather than implying it verified
anything.

To fill it in, from a machine that has a client:

```bash
cargo run --manifest-path launcher/core/Cargo.toml \
      --bin ashmorrow-manifest -- hash /path/to/WoW-3.3.5a > /tmp/client.json
```

Paste `build`, `version`, `locales` and `files` into `manifests/ashmorrow.json`,
and record where the copy came from in `measured_from` — a player comparing
against our hashes deserves to know whose client they are being compared to.

The output is paths, sizes and hashes. No client bytes leave the machine that
runs it, and none are ever committed here.

### Verification is tiered, and has to be

Real 3.3.5a installs in the wild differ by locale, by which optional archives
are present, and by how many times they have been repacked. A launcher that
demanded byte-exact equality with one reference copy would reject most genuine
clients and become a support queue.

| Tier | Question | Verdict |
|---|---|---|
| 1 | Is this a build 12340 client at all? | **Blocks** |
| 2 | Does it match the copy we measured? | **Warns.** We know it is not ours; we do not know it is wrong |
| 3 | Do *our own* files match *our own* hashes? | **Blocks** |

---

## What it sets up for you

On Linux, "I have Wine installed" is nowhere near "I can play". A prefix has to
exist, DXVK has to be unpacked into the right one of two system directories, and
Wine has to be told to prefer it. Get the directory wrong and the game starts,
draws a black window, and tells you nothing. That is the single biggest source
of friction for a Linux player, and the launcher does all of it:

| Step | What happens |
|---|---|
| Prefix | `wineboot -u` against a prefix the launcher owns at `~/.local/share/ashmorrow/prefix`. Safe to re-run, so this is also the repair path |
| DXVK | Fetched over https, size and BLAKE3 checked **before** a byte is written, then the 32-bit `d3d9.dll` unpacked into `syswow64` or `system32` depending on the prefix architecture |
| Overrides | A `.reg` applied with `regedit`, setting `d3d9` to `native,builtin` — written as a file rather than by editing `user.reg`, because the on-disk format is Wine's business |

Only `d3d9.dll`. WoW 3.3.5a is a 32-bit Direct3D 9 executable, and installing
the D3D10/11 and DXGI libraries too would be cargo cult.

DXVK is zlib-licensed free software — not ours, and not Blizzard's, which is
what lets a manifest entry carry a URL at all. Every component states the
licence it is distributed under, and a test fails the build if one does not.

The launch bar will not say `LAUNCH` until this is done. A prefix without DXVK
starts the game and shows a black window, which is a worse outcome than not
starting it, so an unprovisioned runtime reaches the button rather than hiding
in a status row.

```bash
python3 tools/ta.py play provision            # the same work, no GUI
python3 tools/ta.py play provision --dry-run  # say what would happen
```

---

## What it will not do

**It will not download a client.** Not from us, not from a mirror, not from a
swarm. If you do not have a 3.3.5a build 12340 client, the launcher will tell
you precisely what is wrong with what you gave it and stop there. That message
is the most-read thing in the application and is written accordingly.

**It will not log you into the game.** It signs you into the *website's* account
system — the same `acore_auth.account` rows the login server reads — so it can
show you your account and characters, and it pre-fills your account name in
`Config.wtf`. It cannot fill the password: the client performs its own SRP6
handshake, and typing into that field on your behalf means writing into another
process's memory. That is rule 3, and it is also the fastest way to be
classified as malware.

**It will not touch your other Wine prefixes.** It manages one of its own at
`~/.local/share/ashmorrow/prefix`. "The launcher broke my other games" is not a
failure mode worth owning.

**It will not install Wine itself.** Wine belongs to your distribution's package
manager, and a launcher that installs system packages behind your back has
overstepped. It finds what you have — system Wine, Proton from any Steam
library — and tells you what to install when there is nothing.

Everything *after* Wine, it does do. See below.

---

## Shipping it

How a release is cut is under [Releases](#releases). What has to be true of one:

### Licence, at the point it matters

The repository is `GPL-2.0-or-later` ([ADR 0007](../docs/decisions/0007-licence.md)),
but **the launcher binary is conveyed under GPL-3.0-or-later**. Its TLS stack
pulls in `ring`, which is `Apache-2.0 AND ISC` with no permissive arm to choose,
and Apache-2.0 cannot be combined with GPL-2.0. There is no way around it —
`native-tls` means OpenSSL 3.x, also Apache-2.0 — and no need for one, because
upstream's "or any later version" grant covers it. Ship the release with a
GPL-3.0-or-later notice and the corresponding source, and note that the vendored
IBM Plex fonts stay under OFL-1.1 (`ui/src/fonts/OFL.txt`).

**Unsigned, with published SHA-256 sums**, per ADR 0005 §6 — the release
workflow writes `SHA256SUMS.txt` and attaches it, so this is not a step anyone
has to remember. Signing needs a
certificate bound to a verified legal identity on a hardware token, and putting
a real name on a certificate attached to a WoW private server is a decision to
take deliberately rather than by default. Expect SmartScreen warnings and the
occasional antivirus false positive until that changes — a program that writes
into a game folder and spawns a Windows binary under Wine is shaped exactly like
malware to a heuristic engine. There is no packer and no self-modifying code,
and every release is built from public CI, so a report can always be checked
against the source.
