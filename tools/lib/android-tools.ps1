# Shared Windows Android tool discovery and isolated setup. Dot-sourcing is read-only.
$script:RushLinkAndroidRepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Get-RushLinkAndroidTargets {
  param([ValidateSet('all', 'emulator', 'device')][string]$Target = 'all')
  if ($Target -in @('all', 'emulator')) {
    [pscustomobject]@{ Target = 'x86_64'; Triple = 'x86_64-linux-android'; Abi = 'x86_64'; Flavor = 'x86_64'; Label = 'x86_64-emulator'; GradleName = 'X86_64' }
  }
  if ($Target -in @('all', 'device')) {
    [pscustomobject]@{ Target = 'aarch64'; Triple = 'aarch64-linux-android'; Abi = 'arm64-v8a'; Flavor = 'arm64'; Label = 'arm64-device'; GradleName = 'Arm64' }
  }
}

function Get-RushLinkJavaVersion {
  param([string]$JavaHome)
  if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe')) -or
      -not (Test-Path -LiteralPath (Join-Path $JavaHome 'release'))) { return $null }
  $release = Get-Content -LiteralPath (Join-Path $JavaHome 'release') -Raw
  if ($release -match 'JAVA_VERSION="(\d+)([^"]*)"') {
    [pscustomobject]@{ Major = [int]$Matches[1]; Version = "$($Matches[1])$($Matches[2])"; Compatible = ([int]$Matches[1] -ge 17 -and [int]$Matches[1] -le 24) }
  }
}

function Get-RushLinkAndroidToolchain {
  [CmdletBinding()]
  param(
    [string]$RepoRoot = $script:RushLinkAndroidRepoRoot,
    [string]$JavaHome,
    [string]$AndroidHome,
    [string]$NdkHome,
    [ValidateSet('all', 'emulator', 'device')][string]$Target = 'all',
    [switch]$Tablet
  )
  $RepoRoot = [IO.Path]::GetFullPath($RepoRoot)
  $toolRoot = Join-Path $RepoRoot 'release-artifacts/build-tools'
  $missing = [System.Collections.Generic.List[string]]::new()
  $warnings = [System.Collections.Generic.List[string]]::new()
  $explicitJava = [bool]$JavaHome
  if (-not $JavaHome) {
    $jdkRoot = Join-Path $toolRoot 'jdk'
    $candidates = @()
    if (Test-Path -LiteralPath $jdkRoot) {
      $candidates += @(Get-ChildItem -LiteralPath $jdkRoot -Directory | Sort-Object Name -Descending | ForEach-Object { $_.FullName })
    }
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    foreach ($candidate in $candidates) {
      $candidateVersion = Get-RushLinkJavaVersion $candidate
      if ($candidateVersion -and $candidateVersion.Compatible) { $JavaHome = $candidate; break }
      if ($candidateVersion) { $warnings.Add("Ignored incompatible Java $($candidateVersion.Version): $candidate") }
    }
    if (-not $JavaHome) { $JavaHome = Join-Path $jdkRoot 'jdk-17.0.20.1+1' }
  }
  $JavaHome = [IO.Path]::GetFullPath($JavaHome)
  $javaVersion = Get-RushLinkJavaVersion $JavaHome
  if (-not $javaVersion -or -not $javaVersion.Compatible) {
    $missing.Add("Compatible JDK 17-24 at $JavaHome (the isolated setup supplies JDK 17).")
  }
  if (-not $AndroidHome) { $AndroidHome = Join-Path $toolRoot 'android-sdk' }
  $AndroidHome = [IO.Path]::GetFullPath($AndroidHome)
  if (-not $NdkHome) { $NdkHome = Join-Path $AndroidHome 'ndk/28.2.13676358' }
  $NdkHome = [IO.Path]::GetFullPath($NdkHome)
  $sdkManager = Join-Path $AndroidHome 'cmdline-tools/latest/lib/sdkmanager-classpath.jar'
  if (-not (Test-Path -LiteralPath $sdkManager)) { $missing.Add('Android SDK command-line tools.') }
  $packagePaths = [ordered]@{
    'platform-tools' = 'platform-tools/adb.exe'
    'platforms;android-36' = 'platforms/android-36/android.jar'
    'build-tools;35.0.0' = 'build-tools/35.0.0/aapt2.exe'
    'build-tools;36.0.0' = 'build-tools/36.0.0/lib/apksigner.jar'
  }
  if ($Tablet) {
    $packagePaths['emulator'] = 'emulator/emulator.exe'
    $packagePaths['system-images;android-36;default;x86_64'] = 'system-images/android-36/default/x86_64/system.img'
  }
  $missingPackages = [System.Collections.Generic.List[string]]::new()
  foreach ($package in $packagePaths.Keys) {
    if (-not (Test-Path -LiteralPath (Join-Path $AndroidHome $packagePaths[$package]))) {
      $missingPackages.Add($package)
      $missing.Add("Android SDK package: $package")
    }
  }
  $ndkVersion = $null
  $ndkProperties = Join-Path $NdkHome 'source.properties'
  if (Test-Path -LiteralPath $ndkProperties) {
    $ndkText = Get-Content -LiteralPath $ndkProperties -Raw
    if ($ndkText -match 'Pkg.Revision\s*=\s*([^\r\n]+)') { $ndkVersion = $Matches[1].Trim() }
  }
  if ($ndkVersion -ne '28.2.13676358' -or -not (Test-Path -LiteralPath (Join-Path $NdkHome 'toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe'))) {
    $missingPackages.Add('ndk;28.2.13676358')
    $missing.Add("Android NDK 28.2.13676358 at $NdkHome.")
  }
  $missingCommands = @(@('node.exe', 'npm.cmd', 'npx.cmd', 'cargo.exe', 'rustup.exe', 'tar.exe') |
    Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) })
  foreach ($command in $missingCommands) { $missing.Add("Required command: $command (install Node.js LTS and Rust with Windows C++ build tools).") }
  $installedTargets = @()
  if (Get-Command rustup.exe -ErrorAction SilentlyContinue) {
    $previousErrorPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $rustOutput = @(& rustup.exe target list --installed 2>&1 | ForEach-Object { $_.ToString() })
      $rustExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorPreference }
    $installedTargets = @($rustOutput | Where-Object { $_ -match '^[a-z0-9_]+(?:-[a-z0-9_]+)+$' })
    foreach ($line in $rustOutput) { if ($line -notin $installedTargets) { $warnings.Add($line) } }
    if ($rustExitCode -ne 0) { $missing.Add('rustup could not list targets; check the installed Rust toolchain.') }
  }
  $missingTargets = @(Get-RushLinkAndroidTargets $Target | ForEach-Object { $_.Triple } | Where-Object { $_ -notin $installedTargets })
  foreach ($rustTarget in $missingTargets) { $missing.Add("Rust target: $rustTarget") }
  [pscustomobject]@{
    RepoRoot = $RepoRoot; ToolRoot = $toolRoot; JavaHome = $JavaHome; AndroidHome = $AndroidHome; NdkHome = $NdkHome
    Ready = $missing.Count -eq 0; Missing = $missing.ToArray(); Warnings = $warnings.ToArray()
    MissingPackages = $missingPackages.ToArray(); MissingRustTargets = $missingTargets; MissingCommands = @($missingCommands)
    ExplicitJavaHome = $explicitJava; Target = $Target; Tablet = [bool]$Tablet
    Versions = [pscustomobject]@{ Java = $(if ($javaVersion) { $javaVersion.Version } else { $null }); Ndk = $ndkVersion; AndroidApi = 36 }
    AdbPath = Join-Path $AndroidHome 'platform-tools/adb.exe'
    EmulatorPath = Join-Path $AndroidHome 'emulator/emulator.exe'
    SystemImagePath = Join-Path $AndroidHome 'system-images/android-36/default/x86_64'
    AndroidUserHome = Join-Path $toolRoot 'android-user'
    GradleUserHome = Join-Path $toolRoot 'gradle'
    CargoTargetDir = Join-Path $toolRoot 'android-target'
    SdkManagerClasspath = $sdkManager
    LicenseFile = Join-Path $AndroidHome 'licenses/android-sdk-license'
  }
}

function Get-RushLinkVerifiedDownload {
  param([string]$Url, [string]$Sha256, [string]$Destination)
  if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'A valid pinned SHA-256 checksum is required.' }
  if (Test-Path -LiteralPath $Destination) {
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ieq $Sha256) { return $Destination }
    throw "Cached archive checksum mismatch: $Destination. Remove that archive and run setup again."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  $partial = "$Destination.$([Guid]::NewGuid().ToString('N')).partial"
  Write-Host "Downloading official tool archive: $Url"
  try {
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $Sha256) { throw "Downloaded archive checksum mismatch: $Url" }
    Move-Item -LiteralPath $partial -Destination $Destination
  } finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  }
  $Destination
}

function Invoke-RushLinkSdkManager {
  param($Toolchain, [string[]]$Arguments, [switch]$AcceptLicenses)
  $previousAndroidUserHome = $env:ANDROID_USER_HOME
  $previousErrorPreference = $ErrorActionPreference
  try {
    $env:ANDROID_USER_HOME = $Toolchain.AndroidUserHome
    New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME | Out-Null
    # Native progress is written to stderr by Java; inspect its exit code instead.
    $ErrorActionPreference = 'Continue'
    $answers = if ($AcceptLicenses) { @(1..100 | ForEach-Object { 'y' }) } else { @('n') }
    $sdkArguments = @(
      "-Dcom.android.sdklib.toolsdir=$(Join-Path $Toolchain.AndroidHome 'cmdline-tools/latest')",
      '-classpath', $Toolchain.SdkManagerClasspath, 'com.android.sdklib.tool.sdkmanager.SdkManagerCli',
      "--sdk_root=$($Toolchain.AndroidHome)"
    ) + $Arguments
    $answers | & (Join-Path $Toolchain.JavaHome 'bin/java.exe') @sdkArguments 2>&1 | ForEach-Object { Write-Host $_.ToString() }
    $sdkExitCode = $LASTEXITCODE
  } finally {
    $env:ANDROID_USER_HOME = $previousAndroidUserHome
    $ErrorActionPreference = $previousErrorPreference
  }
  if ($sdkExitCode -ne 0) {
    throw 'Android SDK setup failed. Check the error above; if a new license is required, rerun tools/setup-android.ps1 -AcceptLicenses.'
  }
}

function Install-RushLinkAndroidToolchain {
  [CmdletBinding()]
  param(
    [string]$RepoRoot = $script:RushLinkAndroidRepoRoot,
    [string]$JavaHome, [string]$AndroidHome, [string]$NdkHome,
    [ValidateSet('all', 'emulator', 'device')][string]$Target = 'all',
    [switch]$Tablet, [switch]$AcceptLicenses
  )
  $selection = @{ RepoRoot = $RepoRoot; JavaHome = $JavaHome; AndroidHome = $AndroidHome; NdkHome = $NdkHome; Target = $Target; Tablet = $Tablet }
  $tools = Get-RushLinkAndroidToolchain @selection
  if ($tools.Ready) { return $tools }
  if ($tools.MissingCommands.Count) { throw ($tools.Missing | Where-Object { $_ -like 'Required command:*' } | Out-String).Trim() }
  $javaVersion = Get-RushLinkJavaVersion $tools.JavaHome
  if ($JavaHome -and (-not $javaVersion -or -not $javaVersion.Compatible)) { throw "The explicit -JavaHome is not a compatible JDK 17-24: $JavaHome" }
  if ($tools.MissingPackages.Count -and -not (Test-Path -LiteralPath $tools.LicenseFile) -and -not $AcceptLicenses) {
    throw 'Android SDK licenses have not been accepted. Run powershell -ExecutionPolicy Bypass -File tools/setup-android.ps1 -AcceptLicenses to review and accept the Android SDK license requirement explicitly.'
  }
  $workspaceSdk = Join-Path $tools.ToolRoot 'android-sdk'
  if (($tools.MissingPackages.Count -or -not (Test-Path -LiteralPath $tools.SdkManagerClasspath)) -and $tools.AndroidHome -ine $workspaceSdk) {
    throw 'The selected external SDK is incomplete. Run setup without -AndroidHome to prepare the isolated workspace SDK, or install its missing packages in Android Studio.'
  }
  if ($NdkHome -and $tools.MissingPackages -contains 'ndk;28.2.13676358') { throw "The explicit -NdkHome is not NDK 28.2.13676358: $NdkHome" }
  if (-not $javaVersion -or -not $javaVersion.Compatible) {
    $archive = Get-RushLinkVerifiedDownload `
      'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip' `
      'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0' `
      (Join-Path $tools.ToolRoot 'downloads/temurin-jdk17.zip')
    $jdkRoot = Join-Path $tools.ToolRoot 'jdk'
    New-Item -ItemType Directory -Force -Path $jdkRoot | Out-Null
    & tar.exe -xf $archive -C $jdkRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract the verified JDK archive.' }
  }
  if (-not (Test-Path -LiteralPath $tools.SdkManagerClasspath)) {
    $archive = Get-RushLinkVerifiedDownload `
      'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' `
      '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a' `
      (Join-Path $tools.ToolRoot 'downloads/android-commandline-tools.zip')
    $commandLineRoot = Join-Path $tools.AndroidHome 'cmdline-tools/latest'
    New-Item -ItemType Directory -Force -Path $commandLineRoot | Out-Null
    & tar.exe -xf $archive --strip-components 1 -C $commandLineRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract the verified Android command-line tools archive.' }
  }
  $tools = Get-RushLinkAndroidToolchain @selection
  if ($AcceptLicenses -and $tools.MissingPackages.Count) {
    Write-Host 'Accepting Android SDK licenses as explicitly requested with -AcceptLicenses.'
    Invoke-RushLinkSdkManager $tools @('--licenses') -AcceptLicenses
  }
  if ($tools.MissingPackages.Count) {
    Invoke-RushLinkSdkManager $tools $tools.MissingPackages -AcceptLicenses:$AcceptLicenses
  }
  if ($tools.MissingRustTargets.Count) {
    & rustup.exe target add @($tools.MissingRustTargets)
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the required Rust Android targets. Check the rustup error above.' }
  }
  $tools = Get-RushLinkAndroidToolchain @selection
  if (-not $tools.Ready) { throw "Android setup is incomplete: $($tools.Missing -join ' ')" }
  $tools
}

function Test-RushLinkAndroidSymlinkSupport {
  param([string]$ToolRoot)
  $probeRoot = Join-Path ([IO.Path]::GetFullPath($ToolRoot)) "symlink-probe-$([Guid]::NewGuid().ToString('N'))"
  $source = Join-Path $probeRoot 'source.txt'
  $link = Join-Path $probeRoot 'link.txt'
  New-Item -ItemType Directory -Path $probeRoot | Out-Null
  try {
    [IO.File]::WriteAllText($source, 'RushLink Android build probe')
    try {
      New-Item -ItemType SymbolicLink -Path $link -Target $source -ErrorAction Stop | Out-Null
      return $true
    } catch { return $false }
  } finally {
    if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force }
    if (Test-Path -LiteralPath $source) { Remove-Item -LiteralPath $source -Force }
    Remove-Item -LiteralPath $probeRoot -Force
  }
}
