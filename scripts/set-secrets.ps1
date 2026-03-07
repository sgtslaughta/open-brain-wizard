# open-brain-wizard: Set Supabase secrets from credentials.yaml (Windows)
# Reads credentials.yaml in repo root and runs supabase secrets set for each key.
# Run after: scripts\link.ps1. Never commit credentials.yaml.

$ErrorActionPreference = "Stop"

function Write-Section { param($t) Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok    { param($t) Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn  { param($t) Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Write-Fail  { param($t) Write-Host "  [FAIL] $t" -ForegroundColor Red }

function Get-YamlValue {
    param([string]$Key, [string]$Path)
    $line = Get-Content $Path -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*$Key\s*:\s*(.+)$" } | Select-Object -First 1
    if (-not $line) { return $null }
    if ($line -match "^\s*$Key\s*:\s*[""']([^""']*)[""']\s*$") { return $matches[1] }
    if ($line -match "^\s*$Key\s*:\s*(.+)\s*$") { return $matches[1].Trim().Trim('"').Trim("'") }
    return $null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir   = Split-Path -Parent $scriptDir
if (Test-Path (Join-Path $rootDir "supabase\config.toml")) {
    Set-Location $rootDir
} else {
    Set-Location $scriptDir
    $rootDir = (Get-Location).Path
}

$credPath = Join-Path $rootDir "credentials.yaml"
if (-not (Test-Path $credPath)) {
    Write-Fail "credentials.yaml not found. Copy credentials.yaml.template to credentials.yaml and fill in."
    Write-Host "  Path: $credPath"
    exit 1
}

Write-Section "open-brain-wizard: Set secrets from credentials.yaml"

$secretKeys = @(
    @{ Name = "OPENROUTER_API_KEY";     Yaml = "openrouter_api_key" },
    @{ Name = "SLACK_BOT_TOKEN";        Yaml = "slack_bot_token" },
    @{ Name = "SLACK_CAPTURE_CHANNEL"; Yaml = "slack_capture_channel" },
    @{ Name = "MCP_ACCESS_KEY";        Yaml = "mcp_access_key" }
)

foreach ($entry in $secretKeys) {
    $val = Get-YamlValue -Key $entry.Yaml -Path $credPath
    $placeholders = @("", "YOUR_PROJECT_REF", "sk-or-v1-...", "xoxb-...", "C0...")
    if ([string]::IsNullOrWhiteSpace($val) -or ($placeholders -contains $val)) {
        Write-Warn "Skipping $($entry.Name) (empty or placeholder in credentials.yaml)"
        continue
    }
    Write-Host "  Setting $($entry.Name)..."
    & supabase secrets set "$($entry.Name)=$val"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to set $($entry.Name). Ensure project is linked (run scripts\link.ps1)."
        exit 1
    }
    Write-Ok "Set $($entry.Name)"
}

Write-Section "Done"
Write-Host "  Run scripts\deploy.ps1 to deploy Edge Functions."
Write-Host ""
