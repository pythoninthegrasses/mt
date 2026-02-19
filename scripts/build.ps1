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
        @{ Name = 'go-task'; Args = '' },
        # Installs VS 2022 Build Tools + the VC++ toolset (MSVC compiler,
        # link.exe, etc.) required to compile x86_64-pc-windows-msvc Rust code.
        @{ Name = 'visualstudio2022-workload-vctools'; Args = '' }
    )

    # Single choco list call to check all installed packages at once
    $installedSet = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]((choco list --limit-output 2>$null) |
            ForEach-Object { ($_ -split '\|')[0] }),
        [System.StringComparer]::OrdinalIgnoreCase
    )

    $toInstall = @()
    foreach ($pkg in $packages) {
        if ($installedSet.Contains($pkg.Name)) {
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

        # Only pay the refreshenv cost when something was actually installed
        Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
        refreshenv
    }
}

function Install-RustToolchain {
    Write-Step "Setting up Rust toolchain ($script:RustToolchain)"
    Assert-Command 'rustup'

    # Ensure the rustup-managed binaries take precedence over any other
    # Rust installation on PATH (e.g. a stable Rust shim from chocolatey).
    # CARGO_HOME defaults to ~/.cargo; bin/ holds the rustup proxy executables.
    $cargoBin = if ($env:CARGO_HOME) {
        Join-Path $env:CARGO_HOME 'bin'
    } else {
        Join-Path $env:USERPROFILE '.cargo\bin'
    }
    if (Test-Path $cargoBin) {
        $env:PATH = "$cargoBin;$env:PATH"
    }

    # Set RUSTUP_TOOLCHAIN for the entire process so all cargo/rustc
    # invocations use the correct nightly, regardless of rustup default
    $env:RUSTUP_TOOLCHAIN = $script:RustToolchain

    # Parallel compilation targeting ~75 % CPU:
    # CARGO_BUILD_JOBS  – crates compiled concurrently; use most cores
    # -Zthreads         – threads per rustc invocation (nightly only); cap at
    #                     half the cores so the final single-crate link phase
    #                     doesn't peg the CPU at 100 %
    $cpus = [Environment]::ProcessorCount
    # CARGO_BUILD_JOBS: how many crates compile concurrently (dep-phase parallelism)
    $buildJobs   = [Math]::Max(1, $cpus - 2)
    # -Zthreads: threads per rustc invocation (nightly only).
    # Applies to every crate but small deps finish too fast to saturate their
    # budget; the real effect is on large single-crate phases (mt-tauri).
    # Target ~80 % utilisation during that phase.
    $rustThreads = [Math]::Max(1, [Math]::Round($cpus * 0.8))
    $env:CARGO_BUILD_JOBS = "$buildJobs"
    $env:RUSTFLAGS = "-Zthreads=$rustThreads"
    # codegen-units=1 is set in Cargo.toml for release (best optimisation) but
    # it serialises LLVM codegen into one thread, leaving -Zthreads with nothing
    # to parallelise at the LLVM layer.  Override it here so LLVM can split work
    # across rustThreads units; LTO at link time preserves optimisation quality.
    $env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "$rustThreads"

    # Skip the network round-trip when toolchain + target are already present
    $haveToolchain = (rustup toolchain list 2>$null) -match [regex]::Escape($script:RustToolchain)
    $haveTarget    = $haveToolchain -and
        ((rustup target list --installed --toolchain $script:RustToolchain 2>$null) -contains $script:Target)

    if ($haveToolchain -and $haveTarget) {
        Write-Host "  $script:RustToolchain ($script:Target) already installed"
    } else {
        rustup toolchain install $script:RustToolchain --target $script:Target --no-self-update
    }

    Write-Host "  rustc: $(rustc --version)"
    Write-Host "  cargo: $(cargo --version)"
    Write-Host "  build jobs: $buildJobs crates / $rustThreads threads per crate  ($cpus logical CPUs)"
}

function Build-Frontend {
    Write-Step 'Installing frontend dependencies'
    Assert-Command 'npm'

    Push-Location $script:FrontendDir
    try {
        # npm ci is slow (~6 s) even when nothing changed.  Skip it when
        # node_modules is already consistent with the lock file: npm ci writes
        # node_modules/.package-lock.json; if it is newer than package-lock.json
        # the tree is up to date.
        $lockFile      = Join-Path $script:FrontendDir 'package-lock.json'
        $installedLock = Join-Path $script:FrontendDir 'node_modules\.package-lock.json'
        $needsInstall  = -not (Test-Path $installedLock) -or
            (Get-Item $lockFile).LastWriteTime -gt (Get-Item $installedLock).LastWriteTime

        if ($needsInstall) {
            npm ci
        } else {
            Write-Host '  node_modules up to date, skipping npm ci'
        }

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

    $securePassword = New-Object System.Security.SecureString
    foreach ($c in $CertPassword.ToCharArray()) { $securePassword.AppendChar($c) }
    $securePassword.MakeReadOnly()
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=MT' `
        -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(1)
    $script:CertPath = Join-Path $script:BuildTemp 'mt-cert.pfx'
    Export-PfxCertificate -Cert $cert -FilePath $script:CertPath -Password $securePassword | Out-Null
    Write-Host "  Certificate exported to $script:CertPath"
    Write-Host "  Thumbprint: $($cert.Thumbprint)"

    # Write a .cmd wrapper so the sign command token has no spaces.
    # $BuildTemp is always under %TEMP% which contains no spaces on this system,
    # so the script path is a single NSIS token – NSIS won't split it.
    # Inside the .cmd, standard cmd.exe double-quote rules handle the signtool
    # path (which lives under "Program Files (x86)").
    $signScript = Join-Path $script:BuildTemp 'sign.cmd'
    @"
@echo off
"$signtool" sign /f "$($script:CertPath)" /p "$CertPassword" /fd SHA256 "%1"
"@ | Out-File -FilePath $signScript -Encoding ascii

    $script:SignCommand = $signScript
    Write-Host "  Sign command: $signScript"
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

    # Build a config override that skips beforeBuildCommand (frontend
    # is already built by Build-Frontend) and optionally includes signing.
    $overrideCfg = @{ build = @{ beforeBuildCommand = '' } }
    if ($script:SignCommand) {
        # cmd is the executable Tauri spawns via CreateProcess.  .cmd files cannot
        # be run directly (no PE header); they need cmd.exe to interpret them.
        # /C runs the batch file and exits; %1 is the file path Tauri substitutes.
        $overrideCfg['bundle'] = @{ windows = @{ signCommand = @{ cmd = 'cmd'; args = @('/C', $script:SignCommand, '%1') } } }
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
