# Tomorrow's Ash - one-command install (Windows).
#
#   .\install.ps1                                  guided setup - asks about the choices
#   .\install.ps1 -ClientPath 'C:\Games\WoW335'    ...and extract client data too
#   .\install.ps1 -Database local -DbUser root      answer some questions up front
#   .\install.ps1 -Yes                             ask nothing, take defaults
#   .\install.ps1 -PythonPath C:\Py\python.exe     if detection picks the wrong Python
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
    [switch] $Yes,

    # Escape hatch: skip interpreter detection entirely and use this one.
    [string] $PythonPath
)

# NOT 'Stop' at script scope. Windows PowerShell 5.1 turns *any* native command
# writing to stderr into a terminating NativeCommandError, and plenty of healthy
# tools write to stderr - Python prints its startup banner there. Errors we
# actually care about are checked explicitly via $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

function Get-PythonVersion {
    param(
        [Parameter(Mandatory)] [string] $Exe,
        [switch] $UsePyLauncher,
        [ref] $RawOutput
    )

    try {
        if ($UsePyLauncher) {
            $output = & $Exe -3 --version 2>&1
        } else {
            $output = & $Exe --version 2>&1
        }
    } catch {
        if ($RawOutput) { $RawOutput.Value = $_.Exception.Message }
        return $null
    }

    $text = ($output | Out-String).Trim()
    if ($RawOutput) { $RawOutput.Value = $text }

    if ($text -notmatch 'Python\s+(\d+)\.(\d+)') { return $null }

    $major = [int] $Matches[1]
    $minor = [int] $Matches[2]
    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 8)) { return $null }
    return "$major.$minor"
}

function Find-Python {
    $script:PythonAttempts = @()
    foreach ($candidate in @('python', 'python3', 'py')) {
        $cmd = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if (-not $cmd) {
            $script:PythonAttempts += "  $candidate : not on PATH"
            continue
        }

        $isPyLauncher = ($candidate -eq 'py')
        $raw = ''
        $version = Get-PythonVersion -Exe $cmd.Source -UsePyLauncher:$isPyLauncher -RawOutput ([ref] $raw)
        if ($version) {
            return [pscustomobject]@{
                Exe = $cmd.Source; UsePyLauncher = $isPyLauncher; Version = $version
            }
        }
        $shown = if ($raw) { $raw -replace '\r?\n', ' / ' } else { '(no output)' }
        $script:PythonAttempts += "  $($cmd.Source) -> $shown"
    }
    return $null
}

if ($PythonPath) {
    if (-not (Test-Path $PythonPath)) {
        Write-Host "No such file: $PythonPath" -ForegroundColor Red
        exit 1
    }
    $resolved = (Resolve-Path $PythonPath).Path
    $raw = ''
    $version = Get-PythonVersion -Exe $resolved -RawOutput ([ref] $raw)
    if (-not $version) {
        Write-Host "$resolved is not a usable Python 3.8+." -ForegroundColor Red
        Write-Host "  Running it with --version produced:" -ForegroundColor Yellow
        Write-Host "    $(if ($raw) { $raw } else { '(no output)' })"
        Write-Host "  Python 3.8 or newer is required."
        exit 1
    }
    $python = [pscustomobject]@{ Exe = $resolved; UsePyLauncher = $false; Version = $version }
} else {
    $python = Find-Python
}

if (-not $python) {
    Write-Host "Python 3.8+ is required and was not found." -ForegroundColor Red
    Write-Host ""
    if ($script:PythonAttempts) {
        Write-Host "  Tried, and what each returned for --version:" -ForegroundColor Yellow
        $script:PythonAttempts | ForEach-Object { Write-Host $_ }
        Write-Host ""
    }
    Write-Host "  Install it from https://www.python.org/downloads/"
    Write-Host "  Tick 'Add python.exe to PATH' during setup, then reopen PowerShell."
    Write-Host ""
    Write-Host "  If Python IS installed and this still fails, point at it directly:"
    Write-Host "    .\install.ps1 -PythonPath 'C:\Path\To\python.exe'"
    exit 1
}

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

# An array passed to a native command is unrolled into separate arguments.
# Do not use PowerShell splatting here.
if ($python.UsePyLauncher) {
    & $python.Exe -3 $taArgs
} else {
    & $python.Exe $taArgs
}
exit $LASTEXITCODE
