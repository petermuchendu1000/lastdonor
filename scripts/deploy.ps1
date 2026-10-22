#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy LastDonor to Fly.io from Windows.

.DESCRIPTION
  The PowerShell counterpart to scripts/deploy.sh, for deploying from a
  developer machine rather than from an agent session.

  It does three things the bash script does not, because a manual deploy
  is now the ONLY gate this project has:

    1. Runs lint, typecheck and the unit suite before building. GitHub
       Actions has never executed a single job (docs/50), so nothing else
       checks a change before it reaches production.
    2. Refuses to deploy a dirty tree or a branch that is behind its
       remote, so what ships is a commit that exists on GitHub.
    3. Reads the health endpoint afterwards and says what came back.

  Written for Windows PowerShell 5.1, which is what ships with Windows
  and what `powershell.exe` starts. It also runs unchanged on PowerShell 7.
  That is why there are no ternary or null-coalescing operators here: both
  are 7-only and would fail to parse on 5.1 with a confusing error.

.PARAMETER App
  Fly app name. Defaults to lastdonor.

.PARAMETER Prerender
  Pass DATABASE_URL to the build as a BuildKit secret, so the 24 routes
  that combine `export const revalidate` with a database read pre-render
  real content instead of empty. Needs $env:DATABASE_URL. A read-only
  pooled (6543) URL is enough; the build only SELECTs.

.PARAMETER SkipGate
  Skip lint/typecheck/tests. Only for redeploying a commit already proven
  green, e.g. after a failed upload.

.PARAMETER ClassicBuilder
  Use Fly's classic remote builder instead of Depot. Needed behind a
  TLS-inspecting proxy, where Depot's gRPC handshake fails with
  "x509: certificate signed by unknown authority". On a normal network
  Depot is the default and is faster.

.PARAMETER DryRun
  Run every check, then print the flyctl command instead of running it.
  Use this for the first run.

.PARAMETER AllowDirty
  Deploy with uncommitted changes. What ships will not match any commit.

.PARAMETER AllowBranch
  Deploy from a branch other than main.

.EXAMPLE
  .\scripts\deploy.ps1 -DryRun
  .\scripts\deploy.ps1
  .\scripts\deploy.ps1 -Prerender
#>
[CmdletBinding()]
param(
    [string] $App = 'lastdonor',
    [switch] $Prerender,
    [switch] $SkipGate,
    [switch] $ClassicBuilder,
    [switch] $DryRun,
    [switch] $AllowDirty,
    [switch] $AllowBranch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 still defaults to older TLS on some builds, which
# makes HTTPS calls to fly.io and lastdonor.org fail for a reason that has
# nothing to do with the deploy.
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
    Write-Verbose "Could not raise TLS version: $($_.Exception.Message)"
}

function Write-Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Text) Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Warn { param([string] $Text) Write-Host "    !   $Text" -ForegroundColor Yellow }

function Stop-With {
    param([string] $Message, [string] $Fix)
    Write-Host "`nERROR: $Message" -ForegroundColor Red
    if ($Fix) { Write-Host "       $Fix" -ForegroundColor Red }
    exit 1
}

<#
  Run a native command and fail on a non-zero exit code.

  $ErrorActionPreference does NOT apply to native executables: npm, git
  and flyctl can all fail while the script sails on to deploy. Checking
  $LASTEXITCODE after each one is the only thing that stops a red test
  run from shipping.
#>
function Invoke-Native {
    param(
        [Parameter(Mandatory)][string] $Exe,
        [string[]] $Arguments = @(),
        [string] $FailMessage,
        [string] $Fix
    )
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        $msg = $FailMessage
        if (-not $msg) { $msg = "$Exe $($Arguments -join ' ') exited with $LASTEXITCODE" }
        Stop-With -Message $msg -Fix $Fix
    }
}

<#
  Capture a native command's output WITHOUT letting its stderr abort the
  script, and return the exit code alongside the text.

  Windows PowerShell 5.1 turns native stderr into ErrorRecord objects. With
  $ErrorActionPreference = 'Stop' in force, merging them (`2>&1`) raises a
  terminating NativeCommandError — so `fly auth whoami` when NOT signed in
  would blow up here instead of reaching the friendly message below, which
  is the one case the check exists for. Dropping to 'Continue' for the call
  is what keeps stderr as text.
#>
function Invoke-NativeCapture {
    param(
        [Parameter(Mandatory)][string] $Exe,
        [string[]] $Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{
        ExitCode = $code
        Text     = ($output -join "`n").Trim()
    }
}

# ---------------------------------------------------------------------------
# Repository root. The script lives in scripts/, so the root is its parent.
# ---------------------------------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
Write-Host "LastDonor deploy" -ForegroundColor White
Write-Host "repo: $RepoRoot"
Write-Host "app:  $App"

# ---------------------------------------------------------------------------
# 1. flyctl
# ---------------------------------------------------------------------------
Write-Step 'Checking flyctl'
$fly = Get-Command flyctl -ErrorAction SilentlyContinue
if (-not $fly) { $fly = Get-Command fly -ErrorAction SilentlyContinue }
if (-not $fly) {
    Stop-With -Message 'flyctl is not on PATH.' -Fix @'
Install it, then open a NEW terminal so PATH is picked up:
    pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
or: winget install --id Fly-io.flyctl
'@
}
$flyExe = $fly.Source
Write-Ok "flyctl at $flyExe"

# ---------------------------------------------------------------------------
# 2. Authentication
#
# Either an interactive `fly auth login` session or an org-scoped
# FLY_API_TOKEN works. A DEPLOY-scoped or builder-scoped token cannot see
# the app and fails later with a confusing "app not found".
# ---------------------------------------------------------------------------
Write-Step 'Checking Fly authentication'
$auth = Invoke-NativeCapture -Exe $flyExe -Arguments @('auth', 'whoami')
if ($auth.ExitCode -ne 0) {
    $hasToken = $false
    if (Test-Path Env:\FLY_API_TOKEN) {
        if ($env:FLY_API_TOKEN.Trim().Length -gt 0) { $hasToken = $true }
    }
    if (-not $hasToken) {
        Stop-With -Message 'Not signed in to Fly, and FLY_API_TOKEN is not set.' -Fix @'
Either sign in once:
    fly auth login
or set an ORG-SCOPED token for this session:
    $env:FLY_API_TOKEN = "FlyV1 ..."
A builder-scoped or deploy-scoped token cannot see the app.
'@
    }
    Write-Ok 'using FLY_API_TOKEN from the environment'
} else {
    Write-Ok "signed in as $($auth.Text)"
}

# ---------------------------------------------------------------------------
# 3. Git state
# ---------------------------------------------------------------------------
Write-Step 'Checking git state'
$branchResult = Invoke-NativeCapture -Exe 'git' -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')
if ($branchResult.ExitCode -ne 0) { Stop-With -Message 'Not a git repository.' }
$branch = $branchResult.Text

$dirty = (Invoke-NativeCapture -Exe 'git' -Arguments @('status', '--porcelain')).Text
if ($dirty -and -not $AllowDirty) {
    Write-Host $dirty
    Stop-With -Message 'Working tree has uncommitted changes.' `
              -Fix 'Commit or stash them, or pass -AllowDirty to ship code that matches no commit.'
}
if ($dirty) { Write-Warn 'deploying a DIRTY tree: this will not match any commit' }

if ($branch -ne 'main' -and -not $AllowBranch) {
    Stop-With -Message "On branch '$branch', not main." `
              -Fix 'Merge to main first, or pass -AllowBranch.'
}
if ($branch -ne 'main') { Write-Warn "deploying from branch '$branch'" }

# Behind the remote means someone else's commits are about to be left out.
Invoke-NativeCapture -Exe 'git' -Arguments @('fetch', 'origin', $branch, '--quiet') | Out-Null
$revList = Invoke-NativeCapture -Exe 'git' -Arguments @('rev-list', '--left-right', '--count', "origin/$branch...HEAD")
if ($revList.ExitCode -eq 0 -and $revList.Text) {
    $parts  = ($revList.Text -split "\s+") | Where-Object { $_ -ne '' }
    $behind = [int]$parts[0]
    $ahead  = [int]$parts[1]
    if ($behind -gt 0) {
        Stop-With -Message "Local $branch is $behind commit(s) behind origin/$branch." `
                  -Fix "Run: git pull --ff-only origin $branch"
    }
    if ($ahead -gt 0) { Write-Warn "$ahead local commit(s) not pushed to origin/$branch" }
}
$sha = (Invoke-NativeCapture -Exe 'git' -Arguments @('rev-parse', '--short', 'HEAD')).Text
Write-Ok "$branch at $sha"

# ---------------------------------------------------------------------------
# 4. Node and dependencies
#
# A fresh clone has no node_modules, so `npm run lint` fails with "Missing
# script" or a missing binary and reads like a broken repository rather
# than a missing install. Installing here means a new machine can go from
# `git clone` to a deploy without a separate setup step to forget.
# ---------------------------------------------------------------------------
if (-not $SkipGate) {
    Write-Step 'Checking Node.js'
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Stop-With -Message 'Node.js is not on PATH.' -Fix @'
Install the LTS release, then open a NEW terminal:
    winget install --id OpenJS.NodeJS.LTS
'@
    }
    $nodeVersion = (Invoke-NativeCapture -Exe 'node' -Arguments @('--version')).Text
    Write-Ok "node $nodeVersion"

    # `npm ci` wipes and reinstalls from the lockfile. It is the right call
    # on a fresh clone and after a pull that moved package-lock.json; it is
    # slow and pointless otherwise, so it only runs when something is
    # actually missing or out of date.
    #
    # The test is the STAMP, not the directory.
    #
    # `Test-Path node_modules` is the obvious check and it is wrong: a failed
    # or interrupted `npm ci` leaves the directory behind, half-populated.
    # That is not hypothetical - it is what happened on the first real run
    # of this script, where the ECONNRESET from a broken `npm ci` left a
    # partial tree, the directory check passed, the script announced
    # "dependencies already installed", and the gate then died on
    #
    #     'next' is not recognized as an internal or external command
    #
    # which reads like a broken repository and is actually a missing install.
    #
    # `node_modules\.package-lock.json` is npm's hidden lockfile. npm 7+
    # writes it at the END of a successful reify (verified on npm 10.9.4:
    # present, lockfileVersion 3, 1,339 packages), so its ABSENCE next to an
    # existing node_modules means the last install did not finish. Treat
    # that as needing an install rather than as nothing to check.
    $needsInstall = $false
    $lock  = Join-Path $RepoRoot 'package-lock.json'
    $stamp = Join-Path $RepoRoot 'node_modules\.package-lock.json'

    if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
        $needsInstall = $true
        Write-Warn 'node_modules is missing'
    } elseif (-not (Test-Path $stamp)) {
        $needsInstall = $true
        Write-Warn 'node_modules exists but the install never completed'
    } elseif ((Test-Path $lock) -and
              (Get-Item $lock).LastWriteTimeUtc -gt (Get-Item $stamp).LastWriteTimeUtc) {
        $needsInstall = $true
        Write-Warn 'package-lock.json is newer than the installed tree'
    }

    if ($needsInstall) {
        Write-Step 'Installing dependencies (npm ci)'
        Write-Host '    first run on a new clone takes a few minutes'
        Invoke-Native -Exe 'npm' -Arguments @('ci') `
            -FailMessage 'npm ci failed.' `
            -Fix 'If package-lock.json is out of sync with package.json, run npm install and commit the lockfile.'
        Write-Ok 'dependencies installed'
    } else {
        Write-Ok 'dependencies already installed'
    }
}

# ---------------------------------------------------------------------------
# 5. The gate
#
# This is the whole point of the script. CI has never run (docs/50), so if
# these do not run here, nothing checks the change at all.
# ---------------------------------------------------------------------------
if ($SkipGate) {
    Write-Step 'Gate SKIPPED (-SkipGate)'
    Write-Warn 'nothing has checked this commit'
} else {
    Write-Step 'Running the gate (lint, typecheck, unit tests)'
    Write-Host '    this takes a few minutes; it is the only gate this project has'

    Invoke-Native -Exe 'npm' -Arguments @('run', 'lint') `
        -FailMessage 'Lint failed.' -Fix 'Fix the errors above, or pass -SkipGate if you know why.'
    Write-Ok 'lint'

    Invoke-Native -Exe 'npx' -Arguments @('tsc', '--noEmit') `
        -FailMessage 'Typecheck failed.'
    Write-Ok 'typecheck'

    Invoke-Native -Exe 'npm' -Arguments @('run', 'test:unit') `
        -FailMessage 'Unit tests failed.'
    Write-Ok 'unit tests'
}

# ---------------------------------------------------------------------------
# 6. Deploy
# ---------------------------------------------------------------------------
$flyArgs = @('deploy', '--remote-only', '--app', $App, '--yes')

if ($ClassicBuilder) {
    # Depot talks gRPC to its workers; behind a TLS-inspecting proxy that
    # handshake dies with "x509: certificate signed by unknown authority"
    # after about two minutes of "Waiting for depot builder...".
    $flyArgs += '--depot=false'
    Write-Warn 'using the classic remote builder (Depot disabled)'
}

if ($Prerender) {
    $hasDb = $false
    if (Test-Path Env:\DATABASE_URL) {
        if ($env:DATABASE_URL.Trim().Length -gt 0) { $hasDb = $true }
    }
    if (-not $hasDb) {
        Stop-With -Message '-Prerender needs $env:DATABASE_URL.' `
                  -Fix 'A read-only pooled (6543) URL is enough; the build only SELECTs.'
    }
    # A BuildKit secret, so it never lands in a layer or in `docker history`.
    $flyArgs += @('--build-secret', "database_url=$($env:DATABASE_URL)")
    Write-Ok 'pre-rendering with live data via a build secret'
}

Write-Step "Deploying $App"
Write-Host "    $flyExe $($flyArgs -join ' ')" -ForegroundColor DarkGray

if ($DryRun) {
    Write-Host "`nDRY RUN: every check passed, nothing was deployed." -ForegroundColor Yellow
    Write-Host 'Re-run without -DryRun to deploy.' -ForegroundColor Yellow
    exit 0
}

$started = Get-Date
Invoke-Native -Exe $flyExe -Arguments $flyArgs -FailMessage 'fly deploy failed.'
$elapsed = [int]((Get-Date) - $started).TotalSeconds
Write-Ok "deploy finished in ${elapsed}s"

# ---------------------------------------------------------------------------
# 7. Verify
# ---------------------------------------------------------------------------
Write-Step 'Verifying'
& $flyExe status --app $App

# `curl` is an ALIAS for Invoke-WebRequest in Windows PowerShell and does
# not take curl's flags, so the real cmdlet is called directly.
$healthUrl = "https://$App.fly.dev/api/v1/health"
if ($App -eq 'lastdonor') { $healthUrl = 'https://lastdonor.org/api/v1/health' }

try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 60
    Write-Host "`nhealth: $healthUrl"
    foreach ($name in $health.checks.PSObject.Properties.Name) {
        $check  = $health.checks.$name
        $colour = 'Green'
        if ($check.status -ne 'ok') { $colour = 'Yellow' }
        Write-Host ("    {0,-10} {1}" -f $name, $check.status) -ForegroundColor $colour
    }
    if ($health.checks.database.status -ne 'ok') {
        Stop-With -Message 'Database health check is not ok after deploy.'
    }
    # "degraded" is expected while the Stripe key is the dead placeholder
    # (docs/72). PayHero is the rail that actually moves money.
    Write-Host "`noverall: $($health.status)  (degraded is expected while Stripe is dead, docs/72)"
} catch {
    Write-Warn "could not read $healthUrl : $($_.Exception.Message)"
    Write-Warn 'the deploy may still be fine; check the Fly status output above'
}

Write-Host "`nDeployed $branch@$sha to $App." -ForegroundColor Green
