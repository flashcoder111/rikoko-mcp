#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('auto', 'codex', 'claude-code', 'claude-desktop')]
    [string]$Client = 'auto',
    [string]$InstallDir = ''
)

# This template is only executable after release tooling embeds an archive hash.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-RikokoNative {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Program" }
}

function Get-RikokoDownload {
    param([string]$Url, [string]$Destination)
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        throw 'Expected a public HTTPS download URL.'
    }
    Invoke-RikokoNative 'curl.exe' @('--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '20', '--max-time', '600', '--max-filesize', '268435456', $Url, '-o', $Destination)
}

function Assert-RikokoPlainPath {
    param([string]$Path)
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -Force -LiteralPath $cursor
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing a linked installation path: $cursor" }
        }
        $cursor = Split-Path -Parent $cursor
    }
}

function Install-Rikoko {
    $encodedRelease = '__VWB_RELEASE_BASE64__'
    if ($encodedRelease.StartsWith('__')) { throw 'Unpublished installer template. Build and publish a release before use.' }
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess -or
        ($env:PROCESSOR_ARCHITEW6432 -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') -or
        $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw 'This preview installer targets Windows 10/11 x64 in 64-bit PowerShell. Use WSL on other architectures.'
    }
    foreach ($tool in @('curl.exe', 'tar.exe', 'powershell.exe')) {
        if (-not (Get-Command $tool -CommandType Application -ErrorAction SilentlyContinue)) { throw "Required Windows tool is missing: $tool" }
    }
    $release = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedRelease)) | ConvertFrom-Json
    if ($release.version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$' -or $release.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid release metadata.' }
    if (-not $InstallDir) {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable; specify -InstallDir.' }
        $InstallDir = Join-Path $env:LOCALAPPDATA 'rikoko'
    }
    if ($InstallDir -notmatch '^[A-Za-z]:[\\/]') { throw 'Use an absolute local drive path for -InstallDir.' }
    $target = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    if ($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\') -or $target -eq $env:USERPROFILE -or $target -eq $env:LOCALAPPDATA) { throw 'Choose a dedicated installation directory.' }
    Assert-RikokoPlainPath $target
    if (Test-Path -LiteralPath $target) {
        if (-not (Test-Path -LiteralPath (Join-Path $target '.rikoko-install-root')) -and
            @(Get-ChildItem -LiteralPath $target -Force).Count -gt 0) { throw 'Refusing to change an unrelated directory.' }
        # pnpm creates legitimate junctions in app/node_modules. Check managed
        # destinations, not the dependency tree, so same-version retries work.
        foreach ($relative in @('.rikoko-install-root', '.release.json', '.install-lock', 'installation.json', 'config', 'data', 'app', 'runtime', 'runtime/node', 'runtime/bin', 'runtime/python')) {
            Assert-RikokoPlainPath (Join-Path $target $relative)
        }
        foreach ($relative in @('config', 'data')) {
            $privateDir = Join-Path $target $relative
            if (Test-Path -LiteralPath $privateDir) {
                foreach ($item in Get-ChildItem -LiteralPath $privateDir -Force -Recurse) {
                    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Private installation data contains a link or junction; inspect it manually.' }
                }
            }
        }
    }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    # Windows ignores POSIX mode 0600: restrict inherited access before secrets exist.
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $target -AclObject $acl

    $lockPath = Join-Path $target '.install-lock'
    # CreateNew is exclusive. An interrupted lock requires manual inspection.
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $ownerBytes = [Text.Encoding]::UTF8.GetBytes([string]$PID)
    $lock.Write($ownerBytes, 0, $ownerBytes.Length)
    $lock.Flush()
    $temporary = Join-Path $target ('.install-' + [Guid]::NewGuid().ToString('N'))
    $originalPath = $env:PATH
    $originalUv = $env:UV_UNMANAGED_INSTALL
    $originalPythonDir = $env:UV_PYTHON_INSTALL_DIR
    Push-Location
    try {
        [IO.File]::WriteAllText((Join-Path $target '.rikoko-install-root'), 'rikoko')
        New-Item -ItemType Directory -Path $temporary | Out-Null
        $runtime = Join-Path $target 'runtime'
        New-Item -ItemType Directory -Path $runtime -Force | Out-Null
        $app = Join-Path $target 'app'
        $releaseFile = Join-Path $target '.release.json'
        if (Test-Path -LiteralPath $app) {
            if (-not (Test-Path -LiteralPath $releaseFile)) { throw 'Incomplete installation: inspect the app and release metadata before retrying.' }
            $installed = Get-Content -LiteralPath $releaseFile -Raw | ConvertFrom-Json
            if ($installed.sha256 -ne $release.sha256) { throw 'Windows preview does not upgrade existing releases. Keep the old installation and use a separate directory.' }
        }

        $nodeDir = Join-Path $runtime 'node'
        $node = Join-Path $nodeDir 'node.exe'
        if (-not (Test-Path -LiteralPath $node)) {
            Write-Host 'Preparing an isolated Node.js runtime...'
            $checksums = Join-Path $temporary 'node-shasums.txt'
            Get-RikokoDownload 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' $checksums
            $nodeMatch = [regex]::Match((Get-Content -LiteralPath $checksums -Raw), '(?m)^([a-f0-9]{64})\s+(node-v22\.\d+\.\d+-win-x64\.zip)\s*$')
            if (-not $nodeMatch.Success) { throw 'Node.js Windows runtime unavailable.' }
            $nodeArchive = Join-Path $temporary 'node.zip'
            Get-RikokoDownload ('https://nodejs.org/dist/latest-v22.x/' + $nodeMatch.Groups[2].Value) $nodeArchive
            if ((Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash -ne $nodeMatch.Groups[1].Value) { throw 'Node.js checksum mismatch.' }
            $nodeStaging = Join-Path $temporary 'node'
            Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeStaging
            Move-Item -LiteralPath (Join-Path $nodeStaging ($nodeMatch.Groups[2].Value -replace '\.zip$', '')) -Destination $nodeDir
        }
        Invoke-RikokoNative $node @('-e', 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)')
        $bin = Join-Path $runtime 'bin'
        New-Item -ItemType Directory -Path $bin -Force | Out-Null
        $env:PATH = "$nodeDir;$bin;$originalPath"
        $uv = Join-Path $bin 'uv.exe'
        if (-not (Test-Path -LiteralPath $uv)) {
            $uvInstaller = Join-Path $temporary 'uv-install.ps1'
            Get-RikokoDownload 'https://astral.sh/uv/0.13.0/install.ps1' $uvInstaller
            $env:UV_UNMANAGED_INSTALL = $bin
            Invoke-RikokoNative 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $uvInstaller)
        }
        # Install Python in a stable location; the venv must not point at staging.
        $env:UV_PYTHON_INSTALL_DIR = Join-Path $runtime 'python'
        if (-not (Get-Command ffmpeg.exe -CommandType Application -ErrorAction SilentlyContinue) -or
            -not (Get-Command ffprobe.exe -CommandType Application -ErrorAction SilentlyContinue)) {
            if (-not (Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue)) { throw 'Install FFmpeg/ffprobe with libx264 and add them to PATH, then rerun. WinGet is not available.' }
            Write-Host 'Preparing FFmpeg via WinGet. Windows may request permission.'
            Invoke-RikokoNative 'winget.exe' @('install', '--id', 'Gyan.FFmpeg', '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements')
            $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            $env:PATH = "$nodeDir;$bin;$machinePath;$userPath;$originalPath"
        }
        foreach ($tool in @('ffmpeg.exe', 'ffprobe.exe')) {
            if (-not (Get-Command $tool -CommandType Application -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH. Reopen PowerShell and rerun the installer." }
        }
        if (-not (Test-Path -LiteralPath $app)) {
            $archive = Join-Path $temporary 'source.tar.gz'
            Get-RikokoDownload $release.archiveUrl $archive
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $release.sha256) { throw 'rikoko source checksum mismatch.' }
            $names = @(Invoke-RikokoNative 'tar.exe' @('-tzf', $archive))
            if ($names.Count -eq 0 -or $names.Count -gt 10000) { throw 'Invalid archive entry count.' }
            foreach ($name in $names) {
                if (-not $name.StartsWith('video-workbench/') -or $name -match '[\\:<>|?*\x00-\x1f]' -or $name -match '(^|/)\.{1,2}(/|$)' -or $name -match '[. ](/|$)' -or $name -match '(?i)(^|/)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|/|$)') { throw 'Unsafe Windows archive path.' }
            }
            $listing = @(Invoke-RikokoNative 'tar.exe' @('-tvzf', $archive))
            if (@($listing | Where-Object { $_ -notmatch '^[d-]' }).Count -gt 0) { throw 'Archive links and special files are forbidden.' }
            Invoke-RikokoNative 'tar.exe' @('-xzf', $archive, '-C', $temporary)
            $source = Join-Path $temporary 'video-workbench'
            $package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
            if ($package.version -ne $release.version) { throw 'Package version does not match release.' }
            Move-Item -LiteralPath $source -Destination $app
            [IO.File]::WriteAllText($releaseFile, ($release | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        }
        # Dependencies are prepared at their final path (Windows venvs are not relocatable).
        Set-Location -LiteralPath $app
        Invoke-RikokoNative (Join-Path $nodeDir 'npm.cmd') @('exec', '--yes', '--package=pnpm@10.28.2', '--', 'pnpm', 'install', '--frozen-lockfile')
        Invoke-RikokoNative $uv @('sync', '--project', 'python', '--frozen', '--managed-python', '--python', '3.12')
        Invoke-RikokoNative (Join-Path $nodeDir 'npm.cmd') @('exec', '--yes', '--package=pnpm@10.28.2', '--', 'pnpm', 'build')
        Invoke-RikokoNative $node @('--experimental-strip-types', 'scripts/setup.ts', '--home', $target, '--release', $releaseFile, '--client', $Client)
        Write-Host 'rikoko setup completed. Reload your agent MCP connections.'
    } finally {
        Pop-Location
        $env:PATH = $originalPath
        $env:UV_UNMANAGED_INSTALL = $originalUv
        $env:UV_PYTHON_INSTALL_DIR = $originalPythonDir
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
        $lock.Dispose()
        Remove-Item -LiteralPath $lockPath -Force
    }
}

try { Install-Rikoko } catch { Write-Error $_; exit 1 }
