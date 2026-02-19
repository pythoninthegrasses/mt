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

$script:RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$script:TauriDir = Join-Path $RepoRoot 'crates\mt-tauri'
$script:FrontendDir = Join-Path $RepoRoot 'app\frontend'
$script:Target = 'x86_64-pc-windows-msvc'
$script:RustToolchain = 'nightly-2026-02-09'
$script:BuildTemp = Join-Path $env:TEMP "mt-build-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$script:SignCommand = $null
$script:CertPath = $null

function Assert-NativePath {
    param([string]$Path)
    if ($Path -match '^\\\\') {
        Write-Error (@(
            "Repo is on a UNC path ($Path)."
            'Windows cmd.exe (used by npm/vite) does not support UNC paths.'
            'Create a git worktree on a native NTFS path instead:'
            ''
            '  # from WSL'
            '  git worktree add /mnt/c/Users/$USER/git/mt-win main'
            ''
            '  # then from PowerShell'
            '  cd C:\Users\$env:USERNAME\git\mt-win'
            '  .\scripts\build.ps1'
        ) -join "`n")
    }
}

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

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Elevated {
    <#
    .SYNOPSIS
        Run a command with UAC elevation via Start-Process. Single UAC prompt.
    .PARAMETER Command
        The executable to run.
    .PARAMETER Arguments
        Arguments passed to the executable.
    #>
    param(
        [Parameter(Mandatory)][string]$Command,
        [string]$Arguments
    )

    if (Test-IsElevated) {
        # Already elevated, run directly
        if ($Arguments) {
            & $Command $Arguments.Split(' ')
        } else {
            & $Command
        }
        return
    }

    $proc = Start-Process -Verb RunAs -Wait -PassThru `
        -FilePath $Command -ArgumentList $Arguments
    if ($proc.ExitCode -ne 0) {
        Write-Error "$Command exited with code $($proc.ExitCode)"
    }
}

function Install-Dependencies {
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

    # Collect packages that need installing
    $toInstall = @()
    foreach ($pkg in $packages) {
        $installed = choco list --exact $pkg.Name --limit-output 2>$null
        if ($installed) {
            Write-Host "  $($pkg.Name) already installed"
        } else {
            $toInstall += $pkg
        }
    }

    if ($toInstall.Count -gt 0) {
        # Build a single script block for all installs (one UAC prompt)
        $lines = $toInstall | ForEach-Object {
            $cmd = "choco install $($_.Name) -y"
            if ($_.Args) { $cmd += " $($_.Args)" }
            "Write-Host '  Installing $($_.Name)...'; $cmd"
        }
        $script = $lines -join "; "
        Invoke-Elevated -Command 'powershell' `
            -Arguments "-NoProfile -ExecutionPolicy Bypass -Command `"$script`""
    }

    Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
    refreshenv
}

function Install-RustToolchain {
    Write-Step "Setting up Rust toolchain ($script:RustToolchain)"
    Assert-Command 'rustup'

    rustup toolchain install $script:RustToolchain
    rustup default $script:RustToolchain
    rustup target add x86_64-pc-windows-msvc --toolchain $script:RustToolchain
    Write-Host "  rustc: $(rustc --version)"
    Write-Host "  cargo: $(cargo --version)"
}

function Build-Frontend {
    Write-Step 'Installing frontend dependencies'
    Assert-Command 'npm'

    Push-Location $script:FrontendDir
    try {
        npm ci
        Write-Step 'Building frontend'
        npm run build
    } finally {
        Pop-Location
    }
}

function Invoke-CargoClean {
    Write-Step 'Cleaning Rust build artifacts'
    Push-Location $script:RepoRoot
    try { cargo clean } finally { Pop-Location }
}

function Find-SignTool {
    $sdkBinRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (-not (Test-Path $sdkBinRoot)) { return $null }

    Get-ChildItem -Path $sdkBinRoot -Recurse -Filter signtool.exe `
        | Where-Object { $_.FullName -match '\\x64\\' } `
        | Sort-Object { [version]($_.FullName -replace '.*\\(\d+\.\d+\.\d+\.\d+)\\.*','$1') } `
        | Select-Object -Last 1 -ExpandProperty FullName
}

function Initialize-CodeSigning {
    Write-Step 'Setting up code signing'

    $signtool = Find-SignTool
    if (-not $signtool) {
        Write-Host '  signtool.exe not found, installing Windows SDK...'
        Invoke-Elevated -Command 'powershell' `
            -Arguments "-NoProfile -ExecutionPolicy Bypass -Command `"choco install windows-sdk-10.1 -y`""
        Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
        refreshenv
        $signtool = Find-SignTool
    }
    if (-not $signtool) {
        Write-Error 'Could not locate signtool.exe after SDK install.'
    }
    Write-Host "  signtool: $signtool"

    $securePassword = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=MT' `
        -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(1)
    $script:CertPath = Join-Path $script:BuildTemp 'mt-cert.pfx'
    Export-PfxCertificate -Cert $cert -FilePath $script:CertPath -Password $securePassword | Out-Null
    Write-Host "  Certificate exported to $script:CertPath"
    Write-Host "  Thumbprint: $($cert.Thumbprint)"

    $script:SignCommand = "$signtool sign /f $($script:CertPath) /p $CertPassword /t http://timestamp.digicert.com /fd SHA256"
    Write-Host "  Sign command configured"
}

function Import-EnvFile {
    $envFile = Join-Path $script:RepoRoot '.env'
    if (-not (Test-Path $envFile)) { return }

    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
            $key = $Matches[1]
            $val = $Matches[2].Trim("'", '"')
            [Environment]::SetEnvironmentVariable($key, $val, 'Process')
        }
    }
    Write-Host '  Loaded .env'
}

function Build-NsisInstaller {
    Write-Step 'Building NSIS installer'
    Assert-Command 'npx'
    Import-EnvFile

    $env:RUSTUP_TOOLCHAIN = $script:RustToolchain

    # Build a config override that skips beforeBuildCommand (frontend
    # is already built by Build-Frontend) and optionally includes signing.
    $overrideCfg = @{ build = @{ beforeBuildCommand = '' } }
    if ($script:SignCommand) {
        $overrideCfg['bundle'] = @{ windows = @{ signCommand = $script:SignCommand } }
    }
    $overridePath = Join-Path $script:BuildTemp 'tauri-override.json'
    $overrideCfg | ConvertTo-Json -Depth 5 | Out-File -FilePath $overridePath -Encoding utf8

    $tauriArgs = @(
        'build',
        '--target', $script:Target,
        '--bundles', 'nsis',
        '--config', $overridePath
    )

    Push-Location $script:TauriDir
    try {
        Write-Host "  npx @tauri-apps/cli $($tauriArgs -join ' ')"
        & npx @tauri-apps/cli @tauriArgs
        if ($LASTEXITCODE -ne 0) { throw "npx @tauri-apps/cli build exited with code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

function Show-BuildOutput {
    $bundleDir = Join-Path $script:RepoRoot "target\$($script:Target)\release\bundle\nsis"
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
}

function Invoke-Cleanup {
    Write-Step 'Cleanup'
    if (-not $SkipSign) {
        Remove-Item -Force $script:CertPath -ErrorAction SilentlyContinue
        Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert `
            | Where-Object { $_.Subject -eq 'CN=MT' } `
            | Remove-Item -ErrorAction SilentlyContinue
        Write-Host '  Removed certificate and signing config'
    }
    Remove-Item -Recurse -Force $script:BuildTemp -ErrorAction SilentlyContinue
    Write-Host '  Done.'
}

function Main {
    Assert-NativePath $script:RepoRoot
    New-Item -ItemType Directory -Path $script:BuildTemp -Force | Out-Null

    if (-not $SkipDeps) { Install-Dependencies }
    Install-RustToolchain
    Build-Frontend
    if ($Clean) { Invoke-CargoClean }
    if (-not $SkipSign) { Initialize-CodeSigning }

    try {
        Build-NsisInstaller
        Show-BuildOutput
    } finally {
        Invoke-Cleanup
    }
}

Main
