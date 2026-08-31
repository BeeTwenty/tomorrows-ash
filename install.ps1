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

function Test-PythonCandidate {
    <#
        Is this executable really a Python 3.8+? Returns the version string, or
        $null. Never throws.

        Checks the OUTPUT rather than the exit code. Plenty of things exit 0
        when handed `-c <string>` without being Python at all - /bin/echo does,
        and so does the Microsoft Store's python.exe stub. Accepting one of
        those produces a confusing failure much later instead of here.

        The marker is assembled from the version numbers at runtime, so an
        executable that merely echoes its arguments back cannot produce it: the
        literal source text has no digits where the pattern needs them.

        Deliberately avoids splatting (@array) and lets nothing reach the error
        stream: on Windows PowerShell 5.1 a dropped argument makes python start
        its REPL, whose banner then surfaces as a NativeCommandError rather than
        as "wrong version". Both look nothing like the real cause.
    #>
    param(
        [Parameter(Mandatory)] [string] $Exe,
        [switch] $UsePyLauncher
    )

    $code = 'import sys; print("TA_PYTHON %d %d" % sys.version_info[:2])'
    try {
        if ($UsePyLauncher) {
            $output = & $Exe -3 -c $code 2>&1
        } else {
            $output = & $Exe -c $code 2>&1
        }
    } catch {
        return $null
    }

    $text = ($output | Out-String)
    if ($text -notmatch 'TA_PYTHON (\d+) (\d+)') { return $null }

    $major = [int] $Matches[1]
    $minor = [int] $Matches[2]
    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 8)) { return $null }
    return "$major.$minor"
}

function Find-Python {
    # -CommandType Application so a PowerShell alias or function named 'python'
    # cannot shadow the real interpreter.
    foreach ($candidate in @('python', 'python3', 'py')) {
        $cmd = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if (-not $cmd) { continue }

        $isPyLauncher = ($candidate -eq 'py')
        $version = Test-PythonCandidate -Exe $cmd.Source -UsePyLauncher:$isPyLauncher
        if ($version) {
            return [pscustomobject]@{
                Exe = $cmd.Source; UsePyLauncher = $isPyLauncher; Version = $version
            }
        }
    }
    return $null
}

if ($PythonPath) {
    if (-not (Test-Path $PythonPath)) {
        Write-Host "No such file: $PythonPath" -ForegroundColor Red
        exit 1
    }
    $resolved = (Resolve-Path $PythonPath).Path
    $version = Test-PythonCandidate -Exe $resolved
    if (-not $version) {
        Write-Host "$resolved is not a usable Python 3.8+." -ForegroundColor Red
        exit 1
    }
    $python = [pscustomobject]@{ Exe = $resolved; UsePyLauncher = $false; Version = $version }
} else {
    $python = Find-Python
}

if (-not $python) {
    Write-Host "Python 3.8+ is required and was not found." -ForegroundColor Red
    Write-Host ""
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

# An array passed to a native command is unrolled into separate arguments, so
# this needs no splatting - which is what went wrong in the probe above.
if ($python.UsePyLauncher) {
    & $python.Exe -3 $taArgs
} else {
    & $python.Exe $taArgs
}
exit $LASTEXITCODE
