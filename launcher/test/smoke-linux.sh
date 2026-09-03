#!/usr/bin/env bash
#
# Start the built launcher for real and drive it to a launch.
#
# The launcher has now shipped broken twice with every other check green, both
# times for the same reason: nothing anywhere actually ran it. `cargo test`
# cannot — the shell needs a webview — and the interface harness stubs the Tauri
# bridge, so it can only test what we thought to stub. This runs the real
# binary, with a real webview, under a real ACL, and asserts on what it did to
# the filesystem afterwards.
#
# Nothing here needs a game. The client is three files we generate, one of them
# a stub PE with a genuine version resource reading build 12340, and Wine is a
# shell script that records how it was called — so "did the launcher start the
# game" becomes "did it invoke the runtime with the right prefix, working
# directory and arguments", which is answerable in CI.
#
#   launcher/test/smoke-linux.sh [path/to/ashmorrow-launcher]
#
# Needs: Xvfb, xdotool, ImageMagick's `import` (screenshots on failure), python3.

set -euo pipefail

BIN="${1:-launcher/src-tauri/target/release/ashmorrow-launcher}"
[ -x "$BIN" ] || { echo "no launcher binary at $BIN — build it first"; exit 1; }
BIN="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"

WORK="$(mktemp -d)"
DISPLAY_NUM=":${SMOKE_DISPLAY:-99}"
PORT="${SMOKE_PORT:-8099}"
pids=()

cleanup() {
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

say() { printf '\n== %s\n' "$1"; }

# Not `sleep`: some sandboxed shells refuse a foreground sleep, and this script
# is meant to be runnable wherever the launcher can be built.
pause() { python3 -c "import time,sys; time.sleep(float(sys.argv[1]))" "$1"; }

# ------------------------------------------------------------------ #
# A client, a runtime and a realm — none of them real, all of them
# shaped exactly like the real thing.
# ------------------------------------------------------------------ #
say "building the fixture in $WORK"
mkdir -p "$WORK/client/Data/enUS" "$WORK/bin" "$WORK/prefix/drive_c/windows/system32" \
         "$WORK/home/.config/ashmorrow"

# Wow.exe with a real version resource, and a real MPQ holding the two DBCs the
# body-type patch edits. Built by an example in the core so that the tables here
# and the tables the Rust tests use are the same tables: a fixture that drifts
# from the one under test is how the recipe came to point one column past the
# class name for a week.
cargo run -q --manifest-path launcher/core/Cargo.toml \
  --example smoke-fixture -- client "$WORK/client" > /dev/null
# A base archive too, so the load order has more than one entry and the built
# patch has something to sit after.
head -c 4096 /dev/zero | tr '\0' 'x' > "$WORK/client/Data/common.MPQ"

cat > "$WORK/bin/wine" <<'W'
#!/bin/sh
{
  echo "prefix=${WINEPREFIX-unset}"
  echo "debug=${WINEDEBUG-unset}"
  echo "cwd=$(pwd)"
  for a in "$@"; do echo "arg=$a"; done
} >> "$WINE_LOG"
W
chmod +x "$WORK/bin/wine"

# The manifest a realm would serve, with this client's real hashes in it. The
# generator is the same binary players are told to run, so a change that breaks
# hashing breaks this too.
say "hashing the fixture with the shipped manifest tool"
MANIFEST_TOOL="${SMOKE_MANIFEST_TOOL:-launcher/core/target/debug/ashmorrow-manifest}"
if [ ! -x "$MANIFEST_TOOL" ]; then
  cargo build --manifest-path launcher/core/Cargo.toml --bin ashmorrow-manifest
fi
"$MANIFEST_TOOL" hash "$WORK/client" > "$WORK/hashes.json"

# The recipe is published exactly as the website will publish it: its own id and
# version, its byte count, and its BLAKE3 — the hash function every other entry
# in a manifest uses. Computed with the core's own hasher rather than typed,
# because a SHA-256 is the same shape and would fail only on a player's machine.
cp launcher/recipes/body-types.json "$WORK/recipe.json"
RECIPE_HASH="$(cargo run -q --manifest-path launcher/core/Cargo.toml \
  --example smoke-fixture -- hash "$WORK/recipe.json")"

python3 - "$WORK" "$PORT" "$RECIPE_HASH" <<'PY'
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
port, recipe_hash = sys.argv[2], sys.argv[3]
h = json.loads((work / "hashes.json").read_text())
raw = (work / "recipe.json").read_bytes()
recipe = json.loads(raw)
(work / "manifest.json").write_text(json.dumps({
    "schema": 1,
    "realm": {"name": "Ashmorrow", "address": "play.ashmorrow.test",
              "auth_port": 3724, "world_port": 8085},
    "client": {"build": h["build"], "version": h["version"], "locales": h["locales"],
               "measured_from": "the smoke test's synthetic client",
               "files": h["files"]},
    "patches": [], "runtime": [],
    "recipes": [{
        "id": recipe["id"],
        "version": recipe["version"],
        "size": len(raw),
        "hash": recipe_hash,
        "url": f"http://127.0.0.1:{port}/patches/body-types.json",
        "summary": recipe.get("summary", ""),
    }],
    "launcher": {"minimum_version": "0.1.0", "latest_version": "0.1.0"},
}, indent=2))
PY

# Loopback over plain HTTP is the one exception net.rs makes, precisely so a
# realm can be stood up locally.
cat > "$WORK/settings.json" <<J
{
  "client_path": "$WORK/client",
  "realm_address": null,
  "realm_site": "http://127.0.0.1:$PORT",
  "runtime_name": "Wine (system)",
  "prefix": "$WORK/prefix",
  "renderer": "direct3d",
  "windowed": true,
  "account_name": null,
  "extra_args": []
}
J
cp "$WORK/settings.json" "$WORK/home/.config/ashmorrow/settings.json"

say "serving the manifest on 127.0.0.1:$PORT"
python3 - "$WORK/manifest.json" "$PORT" "$WORK/recipe.json" <<'PY' &
import http.server, pathlib, socketserver, sys
served = {
    "/api/launcher/manifest": pathlib.Path(sys.argv[1]).read_bytes(),
    "/patches/body-types.json": pathlib.Path(sys.argv[3]).read_bytes(),
}
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = served.get(self.path)
        if body is None:
            return self.send_error(404)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", int(sys.argv[2])), H).serve_forever()
PY
pids+=($!)

say "starting Xvfb on $DISPLAY_NUM"
Xvfb "$DISPLAY_NUM" -screen 0 1100x800x24 > "$WORK/xvfb.log" 2>&1 &
pids+=($!)
export DISPLAY="$DISPLAY_NUM"
pause 2

# Phase one: ask the binary itself. `--self-check` waits for the report the
# interface files at the end of startup and exits on it, so this answers "does
# this build come up" with no clicking and no screenshot. Windows runs the same
# check and can run nothing else; keeping it here keeps the two symmetric.
say "self-check"
if ! env -i PATH="$WORK/bin:/usr/local/bin:/usr/bin:/bin" HOME="$WORK/home" \
     DISPLAY="$DISPLAY_NUM" WINE_LOG="$WORK/wine.log" \
     ASHMORROW_BASE_URL="http://127.0.0.1:$PORT" \
     GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
     "$BIN" --self-check; then
  echo "the interface did not come up complete - see the line above"
  exit 1
fi

say "starting the launcher"
env -i PATH="$WORK/bin:/usr/local/bin:/usr/bin:/bin" HOME="$WORK/home" \
  DISPLAY="$DISPLAY_NUM" WINE_LOG="$WORK/wine.log" \
  GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
  "$BIN" > "$WORK/launcher.log" 2>&1 &
APP=$!
pids+=("$APP")

# Give the webview time to come up and the manifest fetch time to finish.
pause 12
kill -0 "$APP" 2>/dev/null || { echo "the launcher exited on its own"; cat "$WORK/launcher.log"; exit 1; }

WIN="$(xdotool search --name '^Ashmorrow$' | head -1)"
[ -n "$WIN" ] || { echo "no Ashmorrow window appeared"; cat "$WORK/launcher.log"; exit 1; }
eval "$(xdotool getwindowgeometry --shell "$WIN")"
say "window $WIN at ${X},${Y} ${WIDTH}x${HEIGHT}"

# The launch bar is the full width of the bottom of the window. Its position is
# a design invariant, not a magic number: it is the one control that is always
# there and always says what the launcher will do next.
BAR_X=$(( X + WIDTH / 2 ))
BAR_Y=$(( Y + HEIGHT - 30 ))

# Verify, build the body-type patch, launch. Pressing the same place each time
# is the point: if the interface failed to load its own state the bar reads
# UNAVAILABLE and does nothing, which is exactly the bug this test exists for.
# The middle press is the recipe step — the launch bar refuses to say LAUNCH
# until the archive is built and matches (ADR 0009 §5), so a broken recipe path
# shows up here as a game that never starts.
for press in 1 2 3; do
  xdotool mousemove "$BAR_X" "$BAR_Y" click 1
  pause 6
done

import -window root "$WORK/final.png" 2>/dev/null || true

# ------------------------------------------------------------------ #
# What it actually did
# ------------------------------------------------------------------ #
fail=0
expect() {
  if eval "$2"; then
    echo "  PASS  $1"
  else
    echo "  FAIL  $1"
    fail=1
  fi
}

say "what the launcher did"
REALMLIST="$WORK/client/Data/enUS/realmlist.wtf"
expect "it wrote realmlist.wtf into the client" "[ -f '$REALMLIST' ]"
[ -f "$REALMLIST" ] && cat "$REALMLIST"
expect "the realmlist names the realm from the manifest" \
       "grep -q 'set realmlist play.ashmorrow.test' '$REALMLIST' 2>/dev/null"

PATCH="$WORK/client/Data/enUS/patch-enUS-4.MPQ"
expect "it built the body-type patch from the client's own tables" "[ -f '$PATCH' ]"
expect "the patch is an MPQ archive, not a stub" \
       "[ -f '$PATCH' ] && head -c 3 '$PATCH' | grep -q 'MPQ'"
# The archive has to hold the edited tables, and has to be the one the game
# reads last. `inspect-dbc` answers both, because it applies the same load order
# the client does.
if [ -f "$PATCH" ]; then
  "$MANIFEST_TOOL" inspect-dbc "$WORK/client" > "$WORK/patched.txt" 2>&1 || true
  expect "the patched client offers the three body types" \
         "grep -qE 'Vanguard|Skirmisher|Adept' '$WORK/patched.txt'"
  expect "and no longer offers a stock class" \
         "! grep -qE '^  (1|2|3) +(Warrior|Paladin|Hunter)$' '$WORK/patched.txt'"
  expect "the built archive wins the load order" \
         "grep -q 'patch-enUS-4.MPQ' '$WORK/patched.txt'"
fi

[ -f "$WORK/wine.log" ] && cat "$WORK/wine.log"
expect "it invoked the runtime" "[ -s '$WORK/wine.log' ]"
expect "it ran Wow.exe" "grep -q 'arg=$WORK/client/Wow.exe' '$WORK/wine.log' 2>/dev/null"
expect "it used the configured prefix" "grep -q 'prefix=$WORK/prefix' '$WORK/wine.log' 2>/dev/null"
expect "it ran from the client directory" "grep -q 'cwd=$WORK/client' '$WORK/wine.log' 2>/dev/null"
expect "it honoured the windowed setting" "grep -q 'arg=-windowed' '$WORK/wine.log' 2>/dev/null"

if [ "$fail" -ne 0 ]; then
  say "the launcher's own output"
  cat "$WORK/launcher.log" || true
  if [ -n "${SMOKE_ARTIFACTS:-}" ] && [ -f "$WORK/final.png" ]; then
    mkdir -p "$SMOKE_ARTIFACTS"
    cp "$WORK/final.png" "$SMOKE_ARTIFACTS/smoke-failure.png"
    echo "screenshot written to $SMOKE_ARTIFACTS/smoke-failure.png"
  fi
  echo
  echo "The launcher started but did not get to a launch. That is the failure"
  echo "players have reported twice; do not ship past it."
  exit 1
fi

say "the launcher started, verified a client and ran the game"
