# open-brain-wizard: Install prerequisites (Windows)
# Installs Scoop if needed, then Supabase CLI. Run from repo root or open-brain-dist.

$ErrorActionPreference = "Stop"

# ANSI-style colors (Windows 10+ supports VT)
function Write-Section { param($t) Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok    { param($t) Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn  { param($t) Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Write-Fail  { param($t) Write-Host "  [FAIL] $t" -ForegroundColor Red }

Write-Section "open-brain-wizard: Install (Windows)"

# Scoop
$scoopPath = "$env:USERPROFILE\scoop\shims\scoop.cmd"
if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing Scoop..."
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
    if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
        Write-Fail "Scoop install failed. Install manually: https://scoop.sh"
        exit 1
    }
    Write-Ok "Scoop installed"
} else {
    Write-Ok "Scoop already installed"
}

# Supabase CLI via Scoop
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host "  Adding Supabase bucket and installing Supabase CLI..."
    scoop bucket add supabase https://github.com/supabase/scoop-bucket.git 2>$null
    scoop install supabase
    if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
        Write-Fail "Supabase CLI install failed. Try: npm install -g supabase"
        exit 1
    }
    Write-Ok "Supabase CLI installed"
} else {
    Write-Ok "Supabase CLI already installed"
}

$ver = supabase --version 2>$null
if ($ver) { Write-Ok "Supabase: $ver" }

Write-Section "Next steps"
Write-Host "  1. Copy credentials.yaml.template to credentials.yaml and fill in the placeholders"
Write-Host "  2. Run: .\scripts\link.ps1   (uses project_ref from credentials.yaml if present)"
Write-Host "  3. Run: .\scripts\set-secrets.ps1   (pushes secrets from credentials.yaml to Supabase)"
Write-Host "  4. Run: .\scripts\deploy.ps1"
Write-Host ""
