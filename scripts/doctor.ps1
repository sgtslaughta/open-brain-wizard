# open-brain-wizard: Doctor - check CLI, link, and secret names (Windows)
# Does not print secret values. Use Supabase dashboard for invocations/logs.

$ErrorActionPreference = "Stop"

function Write-Section { param($t) Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok    { param($t) Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn  { param($t) Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Write-Fail  { param($t) Write-Host "  [FAIL] $t" -ForegroundColor Red }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir   = Split-Path -Parent $scriptDir
if (Test-Path (Join-Path $rootDir "supabase\config.toml")) {
    Set-Location $rootDir
} else {
    Set-Location $scriptDir
    $rootDir = (Get-Location).Path
}

Write-Section "open-brain-wizard: Doctor"

# CLI
if (Get-Command supabase -ErrorAction SilentlyContinue) {
    Write-Ok "Supabase CLI: $(supabase --version 2>$null)"
} else {
    Write-Fail "Supabase CLI not found. Run scripts\install.ps1"
    exit 1
}

# Link (project ref)
$linkInfo = supabase projects list 2>&1
$linked = $?
$configPath = Join-Path $rootDir ".supabase"
if (-not (Test-Path $configPath)) { $configPath = Join-Path $rootDir "supabase\.supabase" }
if (Test-Path (Join-Path $configPath "project-ref")) {
    $ref = Get-Content (Join-Path $configPath "project-ref") -ErrorAction SilentlyContinue
    if ($ref) {
        Write-Ok "Linked project ref: $ref"
    } else {
        Write-Warn "Linked but project ref file empty. Run scripts\link.ps1"
    }
} else {
    Write-Warn "Not linked. Run scripts\link.ps1 with your project ref"
}

# Secret names only
Write-Host ""
Write-Section "Secrets (names only)"
$secretsOut = supabase secrets list 2>&1
if ($LASTEXITCODE -eq 0 -and $secretsOut) {
    $lines = $secretsOut | Where-Object { $_ -match "^\s*[A-Z_]+\s*$" -or $_ -match "Name" }
    foreach ($line in $lines) {
        if ($line -match "^\s*([A-Z_]+)\s*$") { Write-Host "  $($matches[1])" }
        elseif ($line -match "Name") { Write-Host "  $line" }
    }
} else {
    Write-Warn "Could not list secrets (not linked or no secrets). Set via: supabase secrets set KEY=value"
}

Write-Section "Debugging tips"
Write-Host "  - Supabase dashboard: Edge Functions -> Logs / Invocations to see when Slack hits ingest-thought"
Write-Host "  - Ensure Slack app bot is in your private channel: /invite @YourAppName"
Write-Host "  - Event Subscriptions: enable both message.channels and message.groups"
Write-Host ""
