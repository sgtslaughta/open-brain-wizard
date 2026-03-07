# open-brain-wizard: Deploy Edge Functions (Windows)
# Deploys ingest-thought and open-brain-mcp. Set secrets first (see SETUP.md).

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

Write-Section "open-brain-wizard: Deploy"

Write-Warn "Ensure these secrets are set: OPENROUTER_API_KEY, SLACK_BOT_TOKEN, SLACK_CAPTURE_CHANNEL, MCP_ACCESS_KEY"
Write-Host "  If you use credentials.yaml: run scripts\set-secrets.ps1 first."
Write-Host "  Or set manually: supabase secrets set KEY=value"
Write-Host ""

foreach ($fn in @("ingest-thought", "open-brain-mcp")) {
    Write-Host "  Deploying $fn..."
    supabase functions deploy $fn --no-verify-jwt
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Deploy failed: $fn"
        exit 1
    }
    Write-Ok "Deployed $fn"
}

Write-Section "Done"
Write-Host "  ingest-thought:  https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought"
Write-Host "  open-brain-mcp: https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_MCP_ACCESS_KEY"
Write-Host ""
