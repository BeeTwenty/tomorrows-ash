# Tomorrow's Ash - one-command install (Windows).
#
#   .\install.ps1                                  set up everything but client data
#   .\install.ps1 -ClientPath 'C:\Games\WoW335'    ...and extract client data too
#   .\install.ps1 -Yes -SkipMmaps                  unattended, defer the slow step
#
# If PowerShell refuses to run this, it is the execution policy, not the script:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# All this does is find a usable Python and hand over to tools\ta.py, which is
# where the actual logic lives so that Windows and Linux run the same code.

[CmdletBinding()]
param(
    [string] $ClientPath,
    [switch] $Yes,
    [switch] $SkipMmaps,
    [switch] $SkipBuild,
    [switch] $Rebuild,
    [int]    $Jobs,
    [string] $Generator
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Find-Python {
    foreach ($candidate in @('python', 'python3', 'py')) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        # 'py' needs a version argument; everything else runs directly.
        $probe = if ($candidate -eq 'py') { @('-3', '-c') } else { @('-c') }
        & $cmd.Source @probe 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>$null
        if ($LASTEXITCODE -eq 0) { return @{ Exe = $cmd.Source; Prefix = @(if ($candidate -eq 'py') { '-3' }) } }
    }
    return $null
}

$python = Find-Python
if (-not $python) {
    Write-Host "Python 3.8+ is required and was not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Install it from https://www.python.org/downloads/"
    Write-Host "  Tick 'Add python.exe to PATH' during setup, then reopen PowerShell."
    exit 1
}

# Join-Path rather than a literal 'tools\ta.py': PowerShell Core also runs on
# Linux and macOS, where a backslash is not a path separator.
$taPath = Join-Path -Path 'tools' -ChildPath 'ta.py'
$taArgs = @($taPath, 'install')
if ($ClientPath) { $taArgs += @('--client', $ClientPath) }
if ($Yes)        { $taArgs += '--yes' }
if ($SkipMmaps)  { $taArgs += '--skip-mmaps' }
if ($SkipBuild)  { $taArgs += '--skip-build' }
if ($Rebuild)    { $taArgs += '--rebuild' }
if ($Jobs)       { $taArgs += @('-j', "$Jobs") }
if ($Generator)  { $taArgs += @('--generator', $Generator) }

& $python.Exe @($python.Prefix + $taArgs)
exit $LASTEXITCODE
