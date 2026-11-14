#Requires -Version 5.1
<#
.SYNOPSIS
    Windows pre-CI build + smoke on the libvirt guest, and the local Windows
    release build, in one file (TASK-369.10; folds scripts/build.ps1).
.DESCRIPTION
    One file, two modes:

      macOS (driver, pwsh):    pwsh scripts/driver.ps1 provision|ship|build|smoke|status|all
      Windows guest (local):   powershell -ExecutionPolicy Bypass -File scripts\driver.ps1 -Command provision|build|release|smoke

    The driver ships THIS file to the guest and invokes it remotely, so the
    build and smoke logic live nowhere else.

    Guest commands:
      provision  choco toolchain + pinned zig + rustup + machine PATH (one-time)
      build      the pre-CI proof: de-tasked frontend + zig sidecar + cargo
                 tauri build/bundle through tauri-build.sh, unsigned, under the
                 committed [profile.release] -- what profile-bench.yml does
      release    the full local pipeline (folds scripts/build.ps1): deps,
                 toolchain, frontend, self-signed code signing, NSIS bundle
      smoke      install the NSIS artifact, launch it, verify, uninstall

    Why the guest build is de-tasked (no go-task): task's Windows shell model
    breaks this taskfile -- simple cmds are direct-exec'd through Go's
    LookPath, which does not resolve `npm` here; the taskfile's sh var blocks
    run under an embedded interpreter whose `command -v` hands back a C:\ path
    its own exec cannot run; and sshd serves sessions a machine-PATH snapshot
    that lags the registry. profile-bench.yml bypasses task on Windows for the
    same family of reasons; this is the same sequence, same flags, PATH pinned.

    Connectivity needs no ssh-config entry: the guest is reached by its
    tailnet IP and its host key is pinned into a project-local known_hosts,
    whose fingerprint is printed on first pin so it can be checked against the
    host's own. What this cannot test: blacksmith runner timings (the guest's
    vCPUs are not the CI machine), and -Command build cannot test signing (use
    -Command release for a signed local build).
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$Command = 'help',
    [string]$VmHost = '100.98.43.12',
    [string]$VmUser = 'lance',
    [string]$Installer = '',
    [switch]$KeepInstalled,
    # release-mode switches (from scripts/build.ps1)
    [switch]$SkipDeps,
    [switch]$SkipSign,
    [string]$CertPassword = [guid]::NewGuid().ToString(),
    [switch]$Clean
)

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$Target = 'x86_64-pc-windows-msvc'
$GuestRoot = "C:/Users/$VmUser/mt"
$KnownHosts = Join-Path $RepoRoot '.cache/win-vm/known_hosts'

# The choco list both provision paths share (driver-driven and local UAC).
$ChocoPackages = @(
    @{ Name = 'cmake'; Args = '--installargs "ADD_CMAKE_TO_PATH=System"' },
    @{ Name = 'rustup.install'; Args = '' },
    @{ Name = 'nodejs-lts'; Args = '' },
    @{ Name = 'go-task'; Args = '' },
    # VS 2022 Build Tools + VC++ toolset: the MSVC compiler/link.exe that
    # compiling x86_64-pc-windows-msvc Rust code needs.
    @{ Name = 'visualstudio2022-workload-vctools'; Args = '' }
)

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Read-Pin([string]$Kind) {
    # Single source of truth for both pins: .tool-versions, as CI reads it.
    $line = (Select-String -Path (Join-Path $RepoRoot '.tool-versions') -Pattern ('^' + $Kind + ' ')).Line
    if (-not $line) { throw "no $Kind pin in .tool-versions" }
    $line -replace ('^' + $Kind + '\s+'), ''
}

function Invoke-Elevated([string]$FilePath, [string]$Arguments) {
    # Run with UAC elevation when needed; SSH sessions on the guest are already
    # elevated, so the prompt only fires for a desktop user.
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $elevated = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($elevated) {
        if ($Arguments) { & $FilePath $Arguments.Split(' ') } else { & $FilePath }
        if ($LASTEXITCODE -ne 0) { throw "$FilePath exited with code $LASTEXITCODE" }
    } else {
        $proc = Start-Process -Verb RunAs -Wait -PassThru -FilePath $FilePath -ArgumentList $Arguments
        if ($proc.ExitCode -ne 0) { throw "$FilePath exited with code $($proc.ExitCode)" }
    }
}

function Install-ChocoPackages {
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        throw 'Chocolatey is not installed. See https://chocolatey.org/install'
    }
    $installed = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]((choco list --limit-output 2>$null | ForEach-Object { ($_ -split '\|')[0] })),
        [System.StringComparer]::OrdinalIgnoreCase)
    $missing = $ChocoPackages | Where-Object { -not $installed.Contains($_.Name) }
    if (-not $missing) {
        Write-Host '  chocolatey packages already present'
        return
    }
    $script = ($missing | ForEach-Object {
        $cmd = "choco install $($_.Name) -y"
        if ($_.Args) { $cmd += " $($_.Args)" }
        "Write-Host '  Installing $($_.Name)...'; $cmd"
    }) -join '; '
    Invoke-Elevated -FilePath 'powershell' `
        -Arguments "-NoProfile -ExecutionPolicy Bypass -Command `"$script`""
    Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
    refreshenv
}

function Install-RustToolchain {
    # rustup-managed proxies take precedence over anything else named cargo on
    # PATH; RUSTUP_TOOLCHAIN pins the toolchain regardless of rustup default.
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    $pin = Read-Pin 'rust'
    $env:RUSTUP_TOOLCHAIN = $pin
    $env:CARGO_BUILD_JOBS = "$([Math]::Max(1, [Environment]::ProcessorCount - 2))"
    $have = (rustup toolchain list 2>$null) -match [regex]::Escape($pin)
    $haveTarget = $have -and ((rustup target list --installed --toolchain $pin 2>$null) -contains $Target)
    if (-not ($have -and $haveTarget)) {
        rustup toolchain install $pin --target $Target --no-self-update
    }
    Write-Host "  rustc: $(rustc --version) / cargo: $(cargo --version)"
}

function Build-Frontend {
    Push-Location (Join-Path $RepoRoot 'app\frontend')
    try {
        # npm ci is slow even when nothing changed; the tree is current when
        # node_modules/.package-lock.json is newer than package-lock.json.
        $lock = 'package-lock.json'
        $installedLock = 'node_modules\.package-lock.json'
        $stale = (-not (Test-Path $installedLock)) -or
            (Get-Item $lock).LastWriteTime -gt (Get-Item $installedLock).LastWriteTime
        if ($stale) { npm ci --no-audit --no-fund } else { Write-Host '  node_modules up to date, skipping npm ci' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
    } finally { Pop-Location }
}

function Stage-Sidecar {
    # Same flags and output name as zig:stage (taskfiles/zig.yml), so the
    # bundled artifact holds what the release ships. zig:stage itself is not
    # used on Windows: its mise resolution returns a backslashed path its own
    # [ -x ] precondition rejects.
    $pin = Read-Pin 'zig'
    $zigBin = "C:\Tools\zig-$pin\zig-x86_64-windows-$pin\zig.exe"
    if (-not (Test-Path $zigBin)) { throw "zig $pin not provisioned (expected $zigBin)" }
    Write-Host "  zig $(& $zigBin version) -> $zigBin"
    New-Item -ItemType Directory -Force -Path crates\mt-tauri\binaries | Out-Null
    Push-Location zig-core
    try {
        & $zigBin build -Dtarget=x86_64-windows -Doptimize=ReleaseSafe -p zig-out/stage-x86_64-pc-windows-msvc
        if ($LASTEXITCODE -ne 0) { throw 'zig build failed' }
    } finally { Pop-Location }
    Copy-Item zig-core\zig-out\stage-x86_64-pc-windows-msvc\bin\mt-zig-core.exe `
        "crates\mt-tauri\binaries\mt-zig-core-$Target.exe" -Force
}

# Guest mode (PowerShell 5.1): $IsWindows does not exist in 5.1 and the guest
# has no pwsh, so guest-ness is detected from the OS platform instead.
$guestMode = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT

if ($guestMode) {
    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version Latest
    $VmUser = $env:USERNAME
    Set-Location $RepoRoot

    if ($Command -in 'build', 'release') {
        # PATH is explicit: the ssh session's machine-PATH snapshot can be
        # stale, and these dirs are what the de-tasked steps need.
        $pinZig = Read-Pin 'zig'
        $env:PATH = "/usr/bin;$env:USERPROFILE\.cargo\bin;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Git\usr\bin;C:\ProgramData\chocolatey\bin;C:\Tools\zig-$pinZig\zig-x86_64-windows-$pinZig;$env:PATH"
        if ($Command -eq 'release') {
            if (-not $SkipDeps) { Write-Step 'System dependencies'; Install-ChocoPackages }
            Write-Step "Rust toolchain"; Install-RustToolchain
            Write-Step 'Frontend'; Build-Frontend
            if ($Clean) { Push-Location $RepoRoot; cargo clean; Pop-Location }
        } else {
            Write-Step 'Frontend'; Build-Frontend
        }
        Write-Step 'Zig sidecar'; Stage-Sidecar
    }

    if ($Command -eq 'build') {
        # The pre-CI proof: unsigned, committed profile, the shared
        # tauri-build.sh that every platform column times.
        Write-Step 'cargo tauri build --no-bundle'
        $env:TAURI_CLI = Join-Path $RepoRoot 'app\frontend\node_modules\.bin\tauri'
        $env:TRIPLE = $Target
        & bash benchmarks/release-profile/tauri-build.sh build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Step 'cargo tauri bundle nsis (unsigned)'
        & bash benchmarks/release-profile/tauri-build.sh bundle nsis
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Get-ChildItem "target\$Target\release\bundle\nsis" -Filter '*.exe' |
            ForEach-Object { '{0}  {1:N0} bytes' -f $_.Name, $_.Length }
        exit 0
    }

    if ($Command -eq 'release') {
        # The full local pipeline, folded from scripts/build.ps1: frontend and
        # sidecar already built above; sign and bundle like release.yml does.
        $BuildTemp = Join-Path $env:TEMP "mt-build-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        New-Item -ItemType Directory -Path $BuildTemp -Force | Out-Null
        $SignCommand = $null
        try {
            if (-not $SkipSign) {
                Write-Step 'Code signing'
                $sdkBinRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
                $signtool = $null
                if (Test-Path $sdkBinRoot) {
                    $signtool = Get-ChildItem -Path $sdkBinRoot -Recurse -Filter signtool.exe |
                        Where-Object { $_.FullName -match '\\x64\\' } |
                        Sort-Object { [version]($_.FullName -replace '.*\\(\d+\.\d+\.\d+\.\d+)\\.*', '$1') } |
                        Select-Object -Last 1 -ExpandProperty FullName
                }
                if (-not $signtool) { throw 'signtool.exe not found (install the Windows SDK: choco install windows-sdk-10.1)' }
                Write-Host "  signtool: $signtool"
                $secure = New-Object System.Security.SecureString
                foreach ($c in $CertPassword.ToCharArray()) { $secure.AppendChar($c) }
                $secure.MakeReadOnly()
                $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=MT' `
                    -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(1)
                $certPath = Join-Path $BuildTemp 'mt-cert.pfx'
                Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $secure | Out-Null
                # .cmd wrapper: Tauri spawns the sign command via CreateProcess,
                # and .cmd files cannot run without cmd.exe; %1 is the file path
                # Tauri substitutes.
                $SignCommand = Join-Path $BuildTemp 'sign.cmd'
                @"
@echo off
"$signtool" sign /f "$certPath" /p "$CertPassword" /fd SHA256 "%1"
"@ | Out-File -FilePath $SignCommand -Encoding ascii
                Write-Host "  cert thumbprint: $($cert.Thumbprint)"
            }
            # .env: LASTFM_API_KEY/SECRET are needed to compile the app.
            $envFile = Join-Path $RepoRoot '.env'
            if (Test-Path $envFile) {
                Get-Content $envFile | ForEach-Object {
                    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
                        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim("'", '"'), 'Process')
                    }
                }
                Write-Host '  loaded .env'
            }
            Write-Step 'cargo tauri build + bundle nsis (signed)'
            $override = @{ build = @{ beforeBuildCommand = '' } }
            if ($SignCommand) {
                $override['bundle'] = @{ windows = @{ signCommand = @{ cmd = 'cmd'; args = @('/C', $SignCommand, '%1') } } }
            }
            $overridePath = Join-Path $BuildTemp 'tauri-override.json'
            $override | ConvertTo-Json -Depth 5 | Out-File -FilePath $overridePath -Encoding utf8
            Push-Location crates\mt-tauri
            try {
                & npx @tauri-apps/cli build --target $Target --bundles nsis --config $overridePath
                if ($LASTEXITCODE -ne 0) { throw "tauri build exited with code $LASTEXITCODE" }
            } finally { Pop-Location }
            Write-Step 'Build complete'
            Get-ChildItem "$RepoRoot\target\$Target\release\bundle\nsis" -ErrorAction SilentlyContinue |
                ForEach-Object { Write-Host "    $($_.Name)  ($([math]::Round($_.Length / 1MB, 1)) MB)" }
        } finally {
            if (-not $SkipSign) {
                Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
                    Where-Object { $_.Subject -eq 'CN=MT' } | Remove-Item -ErrorAction SilentlyContinue
            }
            Remove-Item -Recurse -Force $BuildTemp -ErrorAction SilentlyContinue
        }
        exit 0
    }

    if ($Command -eq 'provision') {
        Write-Step 'Chocolatey packages (VS Build Tools is the long pole)'
        Install-ChocoPackages
        Write-Step "zig $(Read-Pin 'zig') + machine PATH"
        $pin = Read-Pin 'zig'
        $zigDir = "C:\Tools\zig-$pin\zig-x86_64-windows-$pin"
        if (-not (Test-Path (Join-Path $zigDir 'zig.exe'))) {
            $zip = Join-Path $env:TEMP 'zig-win.zip'
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri "https://ziglang.org/download/$pin/zig-x86_64-windows-$pin.zip" -OutFile $zip
            Expand-Archive -Path $zip -DestinationPath "C:\Tools\zig-$pin" -Force
        }
        $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        foreach ($dir in @($zigDir, 'C:\Program Files\Git\usr\bin')) {
            # task's non-login bash never sees Git\usr\bin without this, so the
            # taskfile's sh blocks lose awk/grep.
            if ($m -notlike "*$dir*") { [Environment]::SetEnvironmentVariable('Path', "$m;$dir", 'Machine') }
        }
        Write-Step "rustup toolchain $(Read-Pin 'rust')"
        Install-RustToolchain
        Write-Host '  provision done (new sessions pick up the machine PATH)'
        exit 0
    }

    if ($Command -eq 'smoke') {
        $Failures = 0
        function Check($name, $ok, $detail) {
            if ($ok) { Write-Host "PASS  ${name}: $detail" }
            else { Write-Host "FAIL  ${name}: $detail"; $script:Failures++ }
        }
        if (-not $Installer -or -not (Test-Path $Installer)) { Write-Error 'smoke needs -Installer <nsis exe>'; exit 2 }
        $TaskName = 'mt-smoke'
        Write-Host ("installer: {0} ({1:N0} bytes)" -f $Installer, (Get-Item $Installer).Length)

        Write-Step 'silent install'
        # NSIS /S is silent; -Wait because the installer forks.
        $proc = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
        Check 'install' ($proc.ExitCode -eq 0) "exit $($proc.ExitCode)"
        # installMode "both": /S takes the default (per-machine); search both roots.
        $mtExe = @((Join-Path $env:ProgramFiles 'mt\mt.exe'), (Join-Path $env:LOCALAPPDATA 'mt\mt.exe')) |
            Where-Object { Test-Path $_ } | Select-Object -First 1
        Check 'locate' ($null -ne $mtExe) "found $mtExe"
        if (-not $mtExe) { exit 1 }
        $installDir = Split-Path $mtExe
        Check 'sidecar' (Test-Path (Join-Path $installDir 'mt-zig-core.exe')) 'mt-zig-core.exe next to mt.exe'

        Write-Step 'launch (console session)'
        # A GUI app started from an SSH session runs in the non-interactive
        # service session and exits at once; a scheduled task with /IT runs in
        # the console session. The launch command lives in a .cmd file because
        # /tr mangles embedded quotes around "C:\Program Files\..." paths;
        # ASCII because a BOM breaks cmd.
        $launcher = Join-Path $env:TEMP 'mt-smoke-launch.cmd'
        Set-Content -Path $launcher -Encoding Ascii -Value @('@echo off', "cd /d `"$installDir`"", "start `"`" `"$mtExe`"")
        schtasks /create /tn $TaskName /sc once /st 00:00 /ru $VmUser /it /rl highest /f /tr "`"$launcher`"" | Out-Null
        schtasks /run /tn $TaskName | Out-Null
        $appAlive = $false; $sidecarAlive = $false
        foreach ($i in 1..15) {
            Start-Sleep -Seconds 2
            $appAlive = $null -ne (Get-Process mt -ErrorAction SilentlyContinue)
            if ($appAlive) {
                $sidecarAlive = $null -ne (Get-Process 'mt-zig-core' -ErrorAction SilentlyContinue)
                if ($sidecarAlive) { break }
            }
        }
        Check 'app-running' $appAlive 'mt.exe alive after 30 s'
        Check 'sidecar-running' $sidecarAlive 'mt-zig-core.exe spawned'
        Write-Host ("  info: {0} msedgewebview2 process(es)" -f @(Get-Process msedgewebview2 -ErrorAction SilentlyContinue).Count)

        Write-Step 'app log'
        # The log lives under the app data dir (Roaming vs Local differs by
        # platform config, so check both). Shared-read handle: the app holds
        # the file open and Get-Content reports 0 bytes while it does.
        $logs = @(Get-ChildItem "$env:APPDATA\com.mt.desktop", "$env:LOCALAPPDATA\com.mt.desktop" `
                -Recurse -Filter 'mt.log*' -ErrorAction SilentlyContinue)
        try {
            if ($logs.Count -eq 0) { throw 'no mt.log under AppData' }
            $log = $logs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            # Shared-open then StreamReader: ReadAllLines takes a path, not a
            # stream, and reopening by path would drop the ReadWrite share the
            # app holding the file requires. The try/catch keeps cleanup
            # running when the read fails.
            $stream = [System.IO.File]::Open($log.FullName, 'Open', 'Read', 'ReadWrite')
            $content = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
            $stream.Close()
            $errors = @(($content -split "`r?`n") | Where-Object { $_ -match '^\S+\s+ERROR' })
            Check 'app-log' ($errors.Count -eq 0) "$($errors.Count) ERROR line(s) in $($log.Name)"
            if ($errors.Count -gt 0) { $errors | Select-Object -First 5 | Write-Host }
        } catch {
            Check 'app-log' $false $_.Exception.Message
        }

        Write-Step 'cleanup'
        Get-Process mt, 'mt-zig-core' -ErrorAction SilentlyContinue | Stop-Process -Force
        schtasks /delete /tn $TaskName /f | Out-Null
        if (-not $KeepInstalled) {
            # The NSIS uninstaller copies itself to temp and runs from there, so
            # -Wait returns before anything is gone; poll instead.
            $uninst = Join-Path $installDir 'uninstall.exe'
            if (Test-Path $uninst) {
                Start-Process -FilePath $uninst -ArgumentList '/S' | Out-Null
                foreach ($i in 1..15) {
                    Start-Sleep -Seconds 2
                    if (-not (Test-Path $mtExe)) { break }
                }
            }
            Check 'uninstall' (-not (Test-Path $mtExe)) 'mt.exe removed'
        } else {
            Write-Host '  info: -KeepInstalled set, leaving the install in place'
        }
        if ($Failures -eq 0) { Write-Host 'RESULT: PASS' } else { Write-Host "RESULT: FAIL ($Failures check(s))" }
        exit $(if ($Failures -eq 0) { 0 } else { 1 })
    }

    Write-Error "guest mode understands 'provision|build|release|smoke', got '$Command'"
    exit 2
}

# Driver mode (macOS, pwsh): drive the guest over ssh.
$ErrorActionPreference = 'Stop'
$Tarball = '/tmp/mt-tree.tar.gz'

function Invoke-Guest([string]$remote) {
    # Exit codes propagate: the guest's shell ends with the command's status,
    # which must stop the driver on failure. The filter drops OpenSSH's
    # post-quantum KEX warning, which fires on every connection.
    & ssh -o BatchMode=yes -o UserKnownHostsFile="$KnownHosts" -o StrictHostKeyChecking=yes `
        "$VmUser@$VmHost" $remote 2>&1 |
        Where-Object { $_ -notmatch 'post-quantum|store now|openssh\.com' }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Copy-ToGuest([string]$local, [string]$remote) {
    & scp -q -o BatchMode=yes -o UserKnownHostsFile="$KnownHosts" -o StrictHostKeyChecking=yes `
        $local "${VmUser}@${VmHost}:$remote"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Pin-HostKey {
    New-Item -ItemType Directory -Force -Path (Split-Path $KnownHosts) | Out-Null
    if (Test-Path $KnownHosts) {
        if (Get-Content $KnownHosts | Where-Object { $_ -like "$VmHost*" }) { return }
    }
    Write-Step "pinning guest host key into $KnownHosts"
    $scan = & ssh-keyscan -T 8 -t ed25519 $VmHost 2>$null | Where-Object { $_ -match 'ssh-ed25519' }
    if (-not $scan) { throw "could not reach $VmHost to pin its host key" }
    $scan | Out-File -FilePath $KnownHosts -Encoding ascii
    Write-Host 'pinned fingerprint (verify against the fingerprint the host machine knows):'
    & ssh-keygen -lf $KnownHosts
}

function Ship {
    Pin-HostKey
    Write-Step 'tar the working tree -> guest'
    # COPYFILE_DISABLE=1: macOS bsdtar otherwise adds AppleDouble (._) entries
    # that Windows bsdtar rejects. Symlink entries (editor skill tooling) fail
    # on the guest and are skipped; the file-count check enforces that the
    # regular files the build needs all made it. Retries absorb a tar racing a
    # measurement chain writing into results-<date>/.
    $shipped = $false
    foreach ($attempt in 1..3) {
        $env:COPYFILE_DISABLE = '1'
        & tar czf $Tarball --exclude=.cache --exclude='app/frontend/node_modules' `
            --exclude='app/frontend/dist' --exclude='target' --exclude='src-tauri/target' `
            --exclude='zig-core/.zig-cache' --exclude='zig-core/zig-out' -C $RepoRoot .
        if ($LASTEXITCODE -eq 0) { $shipped = $true; break }
        Write-Host 'warn: tree changed during tar; retrying'
        Start-Sleep -Seconds 10
    }
    if (-not $shipped) { throw 'tree unstable across tar retries; ship again once nothing is writing' }
    $entries = (& tar -tzf $Tarball | Where-Object { $_ -notmatch '/$' }).Count
    Copy-ToGuest $Tarball "C:/Users/$VmUser/mt-tree.tar.gz"
    # $entries is interpolated driver-side; $n is set and expanded on the guest.
    Invoke-Guest ("Remove-Item -Recurse -Force C:\Users\$VmUser\mt -ErrorAction SilentlyContinue; " +
        "New-Item -ItemType Directory -Force -Path C:\Users\$VmUser\mt | Out-Null; " +
        "tar -xzf C:\Users\$VmUser\mt-tree.tar.gz -C C:\Users\$VmUser\mt 2>`$null; " +
        "`$n = (Get-ChildItem C:\Users\$VmUser\mt -Recurse -File | Measure-Object).Count; " +
        "`"extracted: {0} files (source had $entries, symlinks excluded)`" -f `$n")
}

function Provision {
    # Provision lives in guest mode (it needs elevation logic); this just ships
    # the script and lets the guest do it.
    Pin-HostKey
    Copy-ToGuest "$PSScriptRoot/driver.ps1" "C:/Users/$VmUser/driver-provision.ps1"
    Invoke-Guest "powershell -ExecutionPolicy Bypass -File C:/Users/$VmUser/driver-provision.ps1 -Command provision"
}

function Build {
    # The tree ship carries the current script; a standalone build after an
    # edit needs the script re-shipped, so ship the tree if it is missing.
    Invoke-Guest "if (-not (Test-Path '$GuestRoot/scripts/driver.ps1')) { Write-Host 'tree missing; run all|ship first'; exit 2 }"
    Invoke-Guest "powershell -ExecutionPolicy Bypass -File $GuestRoot/scripts/driver.ps1 -Command build"
}

function Smoke {
    # Always re-ship the script so the guest runs the current smoke logic.
    Invoke-Guest "if (-not (Test-Path '$GuestRoot/scripts')) { Write-Host 'no tree on guest; run all|ship first'; exit 2 }"
    Copy-ToGuest "$PSScriptRoot/driver.ps1" "$GuestRoot/scripts/driver.ps1"
    $find = "(Get-ChildItem '$GuestRoot/target/$Target/release/bundle/nsis' -Filter '*.exe' | " +
            'Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName'
    $exe = (& ssh -o BatchMode=yes -o UserKnownHostsFile="$KnownHosts" -o StrictHostKeyChecking=yes `
            "$VmUser@$VmHost" $find 2>$null |
            Where-Object { $_ -notmatch 'post-quantum|store now|openssh\.com' })
    $exe = "$exe".Trim()
    if (-not $exe) { Write-Error 'no installer found; run a build first'; exit 2 }
    Write-Host "installer: $exe"
    $keep = if ($KeepInstalled) { ' -KeepInstalled' } else { '' }
    Invoke-Guest "powershell -ExecutionPolicy Bypass -File $GuestRoot/scripts/driver.ps1 -Command smoke -Installer `"$exe`"$keep"
}

function Status {
    Pin-HostKey
    Invoke-Guest ('hostname; "cores: {0}" -f (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors; ' +
        '"ram GiB: {1}" -f [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB); ' +
        '"C: free GiB: {2}" -f [math]::Round((Get-PSDrive C).Free/1GB); ' +
        'Test-Path C:\Users\$env:USERNAME\mt\Taskfile.yml')
}

switch ($Command) {
    'provision' { Provision }
    'ship' { Ship }
    'build' { Build }
    'smoke' { Smoke }
    'status' { Status }
    'all' { Ship; Build; Smoke }
    default {
        Write-Host "usage: pwsh scripts/driver.ps1 {provision|ship|build|smoke|status|all}"
        Write-Host "  driver (macOS, pwsh): drives the guest over ssh (-VmHost, -VmUser)"
        Write-Host "  guest (Windows):      -Command provision|build|release|smoke"
        Write-Host "    release switches:   -SkipDeps -SkipSign -CertPassword <pw> -Clean (folds scripts/build.ps1)"
        exit 2
    }
}
