# open-brain-wizard: Link local project to Supabase (Windows)
# Run from repo root (parent of open-brain-dist) or from open-brain-dist if that is your repo root.

$ErrorActionPreference = "Stop"

function Write-Section { param($t) Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok    { param($t) Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn  { param($t) Write-Host "  [WARN] $t" -ForegroundColor Yellow }

# Run from directory that contains supabase/
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir   = Split-Path -Parent $scriptDir
if (Test-Path (Join-Path $rootDir "supabase\config.toml")) {
    Set-Location $rootDir
} else {
    Set-Location $scriptDir
    $rootDir = (Get-Location).Path
}

Write-Section "open-brain-wizard: Link to Supabase"

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    Write-Warn "SUPABASE_ACCESS_TOKEN is not set."
    Write-Host "  If 'supabase link' hangs, set it:"
    Write-Host "    1. Create a token at: https://supabase.com/dashboard/account/tokens"
    Write-Host "    2. In PowerShell: `$env:SUPABASE_ACCESS_TOKEN='your-token'"
    Write-Host ""
}

$ref = $env:SUPABASE_PROJECT_REF
if (-not $ref) {
    $credPath = Join-Path $rootDir "credentials.yaml"
    if (Test-Path $credPath) {
        $line = Get-Content $credPath -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*project_ref\s*:\s*(.+)$" } | Select-Object -First 1
        if ($line -match "^\s*project_ref\s*:\s*[""']?([^""'\s]+)[""']?\s*$") { $ref = $matches[1] }
        elseif ($line -match "^\s*project_ref\s*:\s*(.+)\s*$") { $ref = $matches[1].Trim().Trim('"').Trim("'") }
    }
}
if (-not $ref -or $ref -eq "YOUR_PROJECT_REF") {
    $ref = Read-Host "Enter your Supabase project ref (from dashboard URL: .../project/THIS_PART)"
}
if (-not $ref) {
    Write-Host "  [FAIL] Project ref required." -ForegroundColor Red
    exit 1
}

Write-Host "  Linking to project ref: $ref"
supabase link --project-ref $ref
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [FAIL] Link failed. If it hung, set SUPABASE_ACCESS_TOKEN and try again." -ForegroundColor Red
    exit 1
}
Write-Ok "Linked successfully"
