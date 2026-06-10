# Upload DOTENV_FILE to GitLab CI/CD variables (project djogana-pay/intranet_web)
# Usage: $env:GITLAB_TOKEN = "glpat-..." ; .\scripts\push-gitlab-ci-env.ps1

param(
    [string]$Token = $env:GITLAB_TOKEN,
    [string]$Project = "djogana-pay/intranet_web",
    [string]$EnvFile = ".env",
    [string]$PublicBaseUrl = "http://peya-pay-test-2:9091"
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
    Write-Error "GITLAB_TOKEN manquant. Creez un PAT (scope: api) sur GitLab puis: `$env:GITLAB_TOKEN = 'glpat-...'"
}

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path $EnvFile)) {
    Write-Error "Fichier $EnvFile introuvable dans $root"
}

$dotenv = Get-Content $EnvFile -Raw
$dotenv = $dotenv -replace "(?m)^PUBLIC_BASE_URL=.*", "PUBLIC_BASE_URL=$PublicBaseUrl"
if ($dotenv -notmatch "(?m)^PORT=") {
    $dotenv = $dotenv.TrimEnd() + "`nPORT=8010`n"
}

$encodedProject = [uri]::EscapeDataString($Project)
$baseUri = "https://gitlab.com/api/v4/projects/$encodedProject/variables"
$headers = @{ "PRIVATE-TOKEN" = $Token }

# Supprimer l'ancienne variable si elle existe
try {
    Invoke-RestMethod -Method Delete -Uri "$baseUri/DOTENV_FILE" -Headers $headers | Out-Null
} catch {
    # 404 = ok
}

$body = @{
    key             = "DOTENV_FILE"
    value           = $dotenv
    variable_type   = "file"
    protected       = "false"
    masked          = "false"
    raw             = "true"
}

Invoke-RestMethod -Method Post -Uri $baseUri -Headers $headers -Body $body | Out-Null
Write-Host "OK: DOTENV_FILE configure sur GitLab ($Project)"
Write-Host "PUBLIC_BASE_URL=$PublicBaseUrl"
