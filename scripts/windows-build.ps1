#Requires -Version 5.1
<#
.SYNOPSIS
    Local Windows build and signing script for mt NSIS installer.
.DESCRIPTION
    Replicates the CI release pipeline locally on a Windows machine.
    Installs prerequisites, builds the frontend, compiles the Rust/Tauri
    backend, generates a self-signed code-signing certificate, signs the
    output, and produces an NSIS installer.
.PARAMETER SkipDeps
    Skip installing system dependencies (cmake, rustup, node, task).
.PARAMETER SkipSign
    Build without code signing.
.PARAMETER CertPassword
    Password for the self-signed certificate. Defaults to a random GUID.
.PARAMETER Clean
    Run cargo clean before building.
#>
[CmdletBinding()]
param(
    [switch]$SkipDeps,
    [switch]$SkipSign,
    [string]$CertPassword = [guid]::NewGuid().ToString(),
    [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$TauriDir = Join-Path $RepoRoot 'crates\mt-tauri'
$FrontendDir = Join-Path $RepoRoot 'app\frontend'
$Target = 'x86_64-pc-windows-msvc'
$RustToolchain = 'nightly-2026-02-09'

# Temp directory for build artifacts (cert, signing config)
$BuildTemp = Join-Path $env:TEMP "mt-build-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $BuildTemp -Force | Out-Null

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "$Name not found in PATH. Install it or re-run without -SkipDeps."
    }
}

# ---------------------------------------------------------------------------
# 1. System dependencies
# ---------------------------------------------------------------------------
if (-not $SkipDeps) {
    Write-Step 'Installing system dependencies via Chocolatey'

    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Error 'Chocolatey is not installed. See https://chocolatey.org/install'
    }

    $packages = @(
        @{ Name = 'cmake'; Args = '--installargs "ADD_CMAKE_TO_PATH=System"' },
        @{ Name = 'rustup.install'; Args = '' },
        @{ Name = 'nodejs-lts'; Args = '' },
        @{ Name = 'go-task'; Args = '' }
    )
    foreach ($pkg in $packages) {
        $installed = choco list --exact $pkg.Name --limit-output 2>$null
        if ($installed) {
            Write-Host "  $($pkg.Name) already installed"
        } else {
            Write-Host "  Installing $($pkg.Name)..."
            $cmd = "choco install $($pkg.Name) -y"
            if ($pkg.Args) { $cmd += " $($pkg.Args)" }
            Invoke-Expression $cmd
        }
    }

    # Refresh PATH to pick up choco-installed tools
    Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
    refreshenv
}

# ---------------------------------------------------------------------------
# 2. Rust toolchain
# ---------------------------------------------------------------------------
Write-Step "Setting up Rust toolchain ($RustToolchain)"
Assert-Command 'rustup'

rustup toolchain install $RustToolchain
rustup default $RustToolchain
Write-Host "  rustc: $(rustc --version)"
Write-Host "  cargo: $(cargo --version)"

# ---------------------------------------------------------------------------
# 3. Frontend build
# ---------------------------------------------------------------------------
Write-Step 'Installing frontend dependencies'
Assert-Command 'npm'

Push-Location $FrontendDir
try {
    npm ci
    Write-Step 'Building frontend'
    npm run build
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 4. Optional clean
# ---------------------------------------------------------------------------
if ($Clean) {
    Write-Step 'Cleaning Rust build artifacts'
    Push-Location $RepoRoot
    try { cargo clean } finally { Pop-Location }
}

# ---------------------------------------------------------------------------
# 5. Code signing setup
# ---------------------------------------------------------------------------
$SignConfigPath = $null

if (-not $SkipSign) {
    Write-Step 'Setting up code signing'

    # Find signtool.exe
    $sdkBinRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $sdkBinRoot) {
        $signtool = Get-ChildItem -Path $sdkBinRoot -Recurse -Filter signtool.exe `
            | Where-Object { $_.FullName -match '\\x64\\' } `
            | Sort-Object { [version]($_.FullName -replace '.*\\(\d+\.\d+\.\d+\.\d+)\\.*','$1') } `
            | Select-Object -Last 1 -ExpandProperty FullName
    }

    if (-not $signtool) {
        Write-Host '  signtool.exe not found, installing Windows SDK...'
        choco install windows-sdk-10.1 -y
        Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
        refreshenv
        $signtool = Get-ChildItem -Path $sdkBinRoot -Recurse -Filter signtool.exe `
            | Where-Object { $_.FullName -match '\\x64\\' } `
            | Sort-Object { [version]($_.FullName -replace '.*\\(\d+\.\d+\.\d+\.\d+)\\.*','$1') } `
            | Select-Object -Last 1 -ExpandProperty FullName
    }

    if (-not $signtool) {
        Write-Error 'Could not locate signtool.exe after SDK install.'
    }
    Write-Host "  signtool: $signtool"

    # Generate self-signed certificate
    $securePassword = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=MT' `
        -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(1)
    $certPath = Join-Path $BuildTemp 'mt-cert.pfx'
    Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $securePassword | Out-Null
    Write-Host "  Certificate exported to $certPath"
    Write-Host "  Thumbprint: $($cert.Thumbprint)"

    # Write Tauri signing config override
    $signCmd = "$signtool sign /f $certPath /p $CertPassword /t http://timestamp.digicert.com /fd SHA256"
    $config = @{ bundle = @{ windows = @{ signCommand = $signCmd } } } | ConvertTo-Json -Depth 5
    $SignConfigPath = Join-Path $BuildTemp 'sign-override.json'
    $config | Out-File -FilePath $SignConfigPath -Encoding utf8
    Write-Host "  Sign config: $SignConfigPath"
}

# ---------------------------------------------------------------------------
# 6. Build NSIS installer
# ---------------------------------------------------------------------------
Write-Step 'Building NSIS installer'

# Load .env if present (LASTFM keys, etc.)
$envFile = Join-Path $RepoRoot '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
            $key = $Matches[1]
            $val = $Matches[2].Trim("'", '"')
            [Environment]::SetEnvironmentVariable($key, $val, 'Process')
        }
    }
    Write-Host '  Loaded .env'
}

$env:RUSTUP_TOOLCHAIN = $RustToolchain

$cargoArgs = @(
    'tauri', 'build',
    '--target', $Target,
    '--bundles', 'nsis'
)
if ($SignConfigPath) {
    $cargoArgs += @('--config', $SignConfigPath)
}

Push-Location $TauriDir
try {
    Write-Host "  cargo $($cargoArgs -join ' ')"
    & cargo $cargoArgs
    if ($LASTEXITCODE -ne 0) { throw "cargo tauri build exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 7. Report output
# ---------------------------------------------------------------------------
$bundleDir = Join-Path $RepoRoot "target\$Target\release\bundle\nsis"
Write-Step 'Build complete'
if (Test-Path $bundleDir) {
    Write-Host '  NSIS artifacts:'
    Get-ChildItem $bundleDir | ForEach-Object {
        Write-Host "    $($_.Name)  ($([math]::Round($_.Length / 1MB, 1)) MB)"
    }
} else {
    Write-Host "  Bundle directory not found at $bundleDir"
    Write-Host '  Check cargo output above for errors.'
}

# ---------------------------------------------------------------------------
# 8. Cleanup
# ---------------------------------------------------------------------------
Write-Step 'Cleanup'
if (-not $SkipSign) {
    Remove-Item -Force $certPath -ErrorAction SilentlyContinue
    Remove-Item -Force $SignConfigPath -ErrorAction SilentlyContinue
    Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert `
        | Where-Object { $_.Subject -eq 'CN=MT' } `
        | Remove-Item -ErrorAction SilentlyContinue
    Write-Host '  Removed certificate and signing config'
}
Remove-Item -Recurse -Force $BuildTemp -ErrorAction SilentlyContinue
Write-Host '  Done.'
