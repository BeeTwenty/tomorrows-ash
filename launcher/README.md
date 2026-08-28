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
ui/           the interface. TypeScript, no framework, 14 kB
manifests/    the manifest schema, and Ashmorrow's own manifest
tools/        icon and font generation, both reproducible from source
```

Why the split: `src-tauri` cannot be built without a system webview, so anything
that lives in it is outside `cargo test`'s reach. Pushing logic into the shell
means pushing it out of CI. The HTTP transport lives in `core` behind a feature
flag for exactly that reason.

---

## Building it

**Prerequisites:** Rust 1.77+, Node 20+, and on Linux the WebKitGTK development
package.

```bash
# Linux
sudo apt install libwebkit2gtk-4.1-dev build-essential curl libssl-dev \
                 libayatana-appindicator3-dev librsvg2-dev

cd launcher/ui && npm install && cd ..
cargo install tauri-cli --version '^2' --locked

cargo tauri dev     # run it
cargo tauri build   # bundle it
```

**On Windows**, WebView2 ships with Windows 10 21H2 and later, so there is
nothing to install beyond Rust, Node and the MSVC build tools.

Bundles land in `src-tauri/target/release/bundle/`.

### Working on the interface without any of that

The UI answers from a demo adapter when Tauri is not present, so it opens in an
ordinary browser:

```bash
cd launcher/ui && npm run dev     # http://localhost:5173
```

That is how the design gets reviewed, and how the interface is worked on without
a Rust toolchain and a 15 GB client on the machine.

### Testing the part that matters

```bash
cargo test  --manifest-path launcher/core/Cargo.toml
cargo clippy --manifest-path launcher/core/Cargo.toml --all-targets -- -D warnings
cd launcher/ui && npm run typecheck
```

No webview needed for any of it.

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

**It will not install Wine.** It finds what you have — system Wine, Proton from
any Steam library — and tells you what to install when there is nothing.

---

## Shipping it

Releases build on a GitHub Actions matrix: `windows-latest` for `.exe`/`.msi`,
`ubuntu-22.04` for `.AppImage`/`.deb`.

**Unsigned, with published SHA-256 sums**, per ADR 0005 §6. Signing needs a
certificate bound to a verified legal identity on a hardware token, and putting
a real name on a certificate attached to a WoW private server is a decision to
take deliberately rather than by default. Expect SmartScreen warnings and the
occasional antivirus false positive until that changes — a program that writes
into a game folder and spawns a Windows binary under Wine is shaped exactly like
malware to a heuristic engine. There is no packer and no self-modifying code,
and every release is built from public CI, so a report can always be checked
against the source.
