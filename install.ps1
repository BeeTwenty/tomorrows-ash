# Tomorrow's Ash - one-command install (Windows).
#
#   .\install.ps1                                  guided setup - asks about the choices
#   .\install.ps1 -ClientPath 'C:\Games\WoW335'    ...and extract client data too
#   .\install.ps1 -Database local -DbUser root      answer some questions up front
#   .\install.ps1 -Yes                             ask nothing, take defaults
#
# If PowerShell refuses to run this, it is the execution policy, not the script:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# All this does is find a usable Python and hand over to tools\ta.py, which is
# where the actual logic lives so that Windows and Linux run the same code.

[CmdletBinding()]
param(
    # Leave everything unset to be asked about it interactively.
    # NOT -Db: 'db' is the built-in alias for the -Debug common parameter that
    # [CmdletBinding()] adds, and PowerShell rejects the script outright with
    # "conflicts with the parameter alias of the same name".
    [ValidateSet('docker', 'local', 'remote')]
    [string] $Database,
    [string] $DbHost,
    [string] $DbPort,
    [string] $DbUser,
    [string] $DbPassword,

    [string] $RealmName,
    [string] $RealmAddress,
    [string] $RealmPort,

    [ValidateSet('Release', 'RelWithDebInfo', 'Debug')]
    [string] $BuildType,
    [switch] $NoTools,
    [switch] $SkipBuild,
    [switch] $Rebuild,
    [int]    $Jobs,
    [string] $Generator,

    [string] $ClientPath,
    [switch] $SkipMmaps,

    [switch] $Reconfigure,
    [switch] $Yes
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
if ($Database)     { $taArgs += @('--db', $Database) }
if ($DbHost)       { $taArgs += @('--db-host', $DbHost) }
if ($DbPort)       { $taArgs += @('--db-port', $DbPort) }
if ($DbUser)       { $taArgs += @('--db-user', $DbUser) }
if ($DbPassword)   { $taArgs += @('--db-password', $DbPassword) }
if ($RealmName)    { $taArgs += @('--realm-name', $RealmName) }
if ($RealmAddress) { $taArgs += @('--realm-address', $RealmAddress) }
if ($RealmPort)    { $taArgs += @('--realm-port', $RealmPort) }
if ($BuildType)    { $taArgs += @('--build-type', $BuildType) }
if ($NoTools)      { $taArgs += '--no-tools' }
if ($SkipBuild)    { $taArgs += '--skip-build' }
if ($Rebuild)      { $taArgs += '--rebuild' }
if ($Jobs)         { $taArgs += @('-j', "$Jobs") }
if ($Generator)    { $taArgs += @('--generator', $Generator) }
if ($ClientPath)   { $taArgs += @('--client', $ClientPath) }
if ($SkipMmaps)    { $taArgs += '--skip-mmaps' }
if ($Reconfigure)  { $taArgs += '--reconfigure' }
if ($Yes)          { $taArgs += '--yes' }

& $python.Exe @($python.Prefix + $taArgs)
exit $LASTEXITCODE
