# Start the built .exe on a real Windows machine and make it say whether it works.
#
# The launcher has shipped broken twice, both times reported from Windows, and
# both times every check was green because nothing anywhere started the binary.
# `cargo test` cannot (the shell needs a webview) and the interface harness
# stubs the very bridge that was failing. This runs the real .exe, with the real
# WebView2, under the real ACL.
#
# It asks the interface itself. `--self-check` waits for the report the
# interface files at the end of startup and exits on it: zero when all four
# pieces of local state loaded and the event subscription was granted, one
# otherwise, and one if no report arrives at all — which is what a hang is.
#
# What this does NOT prove: that the game starts. That needs a spawn, and the
# spawn needs a real Wow.exe. `smoke-linux.sh` covers the rest of the chain on
# the platform where a stand-in for Wine is possible.
#
#   pwsh launcher/test/smoke-windows.ps1 [path\to\ashmorrow-launcher.exe]

$ErrorActionPreference = 'Stop'

$bin = if ($args.Count -ge 1) { $args[0] }
       else { 'launcher\src-tauri\target\release\ashmorrow-launcher.exe' }

if (-not (Test-Path $bin)) {
    Write-Host "no launcher at $bin - build it first"
    exit 1
}
$bin = (Resolve-Path $bin).Path

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("ashmorrow-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work -Force | Out-Null
$out = Join-Path $work 'out.txt'
$err = Join-Path $work 'err.txt'

try {
    # A fresh install: the launcher keeps its settings under %APPDATA%\Ashmorrow,
    # so pointing APPDATA at an empty directory is the same as a first run.
    $env:APPDATA = $work
    # Never resolves, on purpose. The realm being unreachable must not stop the
    # launcher coming up, and on a runner it is unreachable whatever we do.
    $env:ASHMORROW_BASE_URL = 'https://ashmorrow.invalid'

    Write-Host "== starting $bin --self-check"
    $proc = Start-Process -FilePath $bin -ArgumentList '--self-check' `
        -RedirectStandardOutput $out -RedirectStandardError $err `
        -PassThru -WindowStyle Hidden

    # The binary's own watchdog gives up at 60s; this is the outer bound for the
    # case where it never gets far enough to arm one.
    if (-not $proc.WaitForExit(120000)) {
        Write-Host "== the launcher never exited - killing it"
        try { $proc.Kill() } catch { }
        Write-Host "== stderr"; if (Test-Path $err) { Get-Content $err }
        Write-Host ""
        Write-Host "The .exe started and then hung. That is the failure players have"
        Write-Host "reported; do not ship past it."
        exit 1
    }

    $code = $proc.ExitCode
    Write-Host "== exit $code"
    Write-Host "== stderr"
    $stderr = if (Test-Path $err) { Get-Content $err -Raw } else { '' }
    if ($stderr) { Write-Host $stderr }
    if (Test-Path $out) { $stdout = Get-Content $out -Raw; if ($stdout) { Write-Host $stdout } }

    if ($code -ne 0) {
        Write-Host ""
        Write-Host "The interface came up incomplete. The line above names which"
        Write-Host "pieces failed; 'events=False' means src-tauri\capabilities\ is"
        Write-Host "wrong, which is exactly how this shipped before."
        exit 1
    }

    if ($stderr -notmatch 'startup ok') {
        Write-Host ""
        Write-Host "Exit code 0 but no startup report. Something answered for the"
        Write-Host "launcher without being it; treat this as a failure."
        exit 1
    }

    Write-Host ""
    Write-Host "== the .exe started, and its interface loaded everything local"
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
