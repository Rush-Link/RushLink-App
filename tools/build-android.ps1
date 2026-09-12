[CmdletBinding()]
param(
  [ValidateSet('all', 'emulator', 'device')][string]$Target = 'all',
  [string]$JavaHome,
  [string]$AndroidHome,
  [string]$NdkHome,
  [switch]$AcceptLicenses,
  [switch]$SkipFrontendBuild,
  [switch]$CopyNativeLibraries
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $repoRoot 'release-artifacts/build-tools'
$outputRoot = Join-Path $repoRoot 'release-artifacts/current-build/android'
. (Join-Path $PSScriptRoot 'lib/android-tools.ps1')
$toolchain = Install-RushLinkAndroidToolchain -JavaHome $JavaHome -AndroidHome $AndroidHome -NdkHome $NdkHome -Target $Target -AcceptLicenses:$AcceptLicenses
$JavaHome = $toolchain.JavaHome
$AndroidHome = $toolchain.AndroidHome
$NdkHome = $toolchain.NdkHome
$architectures = @(Get-RushLinkAndroidTargets $Target)
$javaRelease = Get-Content -LiteralPath (Join-Path $JavaHome 'release') -Raw

$processEnvironment = @{
  JAVA_HOME = [IO.Path]::GetFullPath($JavaHome)
  ANDROID_HOME = [IO.Path]::GetFullPath($AndroidHome)
  ANDROID_SDK_ROOT = [IO.Path]::GetFullPath($AndroidHome)
  NDK_HOME = [IO.Path]::GetFullPath($NdkHome)
  ANDROID_USER_HOME = Join-Path $toolRoot 'android-user'
  GRADLE_USER_HOME = Join-Path $toolRoot 'gradle'
  CARGO_TARGET_DIR = Join-Path $toolRoot 'android-target'
  PATH = "$(Join-Path $JavaHome 'bin');$(Join-Path $AndroidHome 'platform-tools');$env:PATH"
}
$previousEnvironment = @{}
$transcribing = $false
$executedCommands = [System.Collections.Generic.List[string]]::new()

function Invoke-BuildCommand {
  param([string]$Executable, [string[]]$Arguments)
  $executedCommands.Add("$Executable $($Arguments -join ' ')")
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE." }
}

function Merge-AndroidConfig {
  param($Base, $Override)
  foreach ($property in $Override.PSObject.Properties) {
    if ($null -eq $property.Value) {
      $Base.PSObject.Properties.Remove($property.Name)
    } elseif ($property.Value -is [pscustomobject]) {
      $existing = $Base.PSObject.Properties[$property.Name]
      if (-not $existing -or $existing.Value -isnot [pscustomobject]) {
        $Base | Add-Member -NotePropertyName $property.Name -NotePropertyValue ([pscustomobject]@{}) -Force
      }
      Merge-AndroidConfig $Base.($property.Name) $property.Value
    } else {
      $Base | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value -Force
    }
  }
}

function Invoke-NativePreparation {
  param([string]$Target, [string]$Triple, [string]$Abi, [string[]]$ConfigArguments)
  $arguments = @('tauri', 'android', 'build', '--debug', '--apk', '--target', $Target, '--split-per-abi', '--ci') + $ConfigArguments + @('--', '--locked')
  $executedCommands.Add("npx.cmd $($arguments -join ' ')")
  $logPath = Join-Path $toolRoot "android-native-$Target.log"
  $previousErrorPreference = $ErrorActionPreference
  # Windows PowerShell treats native stderr as ErrorRecords even for compiler progress.
  $ErrorActionPreference = 'Continue'
  $reachedSymlinkStage = $false
  Write-Host "Preparing native Android code for $Abi..."
  try {
    & npx.cmd @arguments 2>&1 | ForEach-Object { $_.ToString() } |
      Tee-Object -FilePath $logPath | ForEach-Object {
        if ($_ -match 'Info symlinking lib') { $reachedSymlinkStage = $true }
        if (-not $reachedSymlinkStage) { Write-Host $_ }
      }
    $nativeExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorPreference }
  $nativeLog = Get-Content -LiteralPath $logPath -Raw
  $source = Join-Path $env:CARGO_TARGET_DIR "$Triple/debug/librushlink_lib.so"
  if ($nativeExitCode -ne 0 -and (
    $nativeLog -notmatch 'Creation symbolic link is not allowed for this system' -or
    $nativeLog -notmatch 'Finished.+profile' -or
    -not (Test-Path -LiteralPath $source)
  )) {
    Get-Content -LiteralPath $logPath -Tail 50 | ForEach-Object { Write-Host $_ }
    throw "Native preparation for $Target failed. See $logPath."
  }
  $jniDirectory = Join-Path $repoRoot "src-tauri/gen/android/app/src/main/jniLibs/$Abi"
  New-Item -ItemType Directory -Force -Path $jniDirectory | Out-Null
  $jniLibrary = Join-Path $jniDirectory 'librushlink_lib.so'
  if ((Test-Path -LiteralPath $jniLibrary) -and (Get-Item -LiteralPath $jniLibrary).LinkType -eq 'SymbolicLink') {
    # A host with symlink permission may complete the CLI build; replace only its generated link.
    Remove-Item -LiteralPath $jniLibrary -Force
  }
  Copy-Item -LiteralPath $source -Destination $jniLibrary -Force
  $neededLibraries = & (Join-Path $NdkHome 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-readelf.exe') --dynamic-table $source
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect native dependencies for $Target." }
  if (($neededLibraries -join "`n") -match 'libc\+\+_shared\.so') {
    $cppLibrary = Join-Path $NdkHome "toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/$Triple/libc++_shared.so"
    Copy-Item -LiteralPath $cppLibrary -Destination (Join-Path $jniDirectory 'libc++_shared.so') -Force
  }
  Write-Host "Prepared $Abi native libraries as ordinary files."
}

Push-Location $repoRoot
try {
  foreach ($key in $processEnvironment.Keys) {
    $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $processEnvironment[$key], 'Process')
  }
  New-Item -ItemType Directory -Force -Path $toolRoot, $outputRoot, $env:ANDROID_USER_HOME, $env:GRADLE_USER_HOME | Out-Null
  if (-not $PSBoundParameters.ContainsKey('CopyNativeLibraries')) {
    $CopyNativeLibraries = -not (Test-RushLinkAndroidSymlinkSupport $toolRoot)
  }
  Start-Transcript -Path (Join-Path $toolRoot 'android-build.log') -Force | Out-Null
  $transcribing = $true

  Invoke-BuildCommand 'rustup' @('target', 'list', '--installed')
  if (-not (Test-Path -LiteralPath 'node_modules/.bin/tauri.cmd')) { Invoke-BuildCommand 'npm.cmd' @('ci') }
  Invoke-BuildCommand 'npx.cmd' @('tauri', '--version')
  Invoke-BuildCommand (Join-Path $JavaHome 'bin/java.exe') @('-version')
  if (-not (Test-Path -LiteralPath 'src-tauri/gen/android/gradlew.bat')) {
    Invoke-BuildCommand 'npx.cmd' @('tauri', 'android', 'init', '--ci', '--skip-targets-install')
  }
  if (-not $SkipFrontendBuild) { Invoke-BuildCommand 'npm.cmd' @('run', 'build') }
  if (-not (Test-Path -LiteralPath 'dist/index.html')) { throw '-SkipFrontendBuild requires an existing frontend build in dist.' }
  $reuseConfig = Join-Path $toolRoot 'android-reuse-frontend.json'
  [IO.File]::WriteAllText($reuseConfig, '{"build":{"beforeBuildCommand":""}}', [Text.UTF8Encoding]::new($false))
  $configArguments = @('--config', $reuseConfig)
  $buildArguments = @('tauri', 'android', 'build', '--debug', '--apk', '--target') +
    @($architectures | ForEach-Object { $_.Target }) + @('--split-per-abi', '--ci') + $configArguments + @('--', '--locked')
  Write-Host "Selected target: $Target; copy native libraries: $([bool]$CopyNativeLibraries)"
  Write-Host "Building local debug APKs: npx $($buildArguments -join ' ')"
  if ($CopyNativeLibraries) {
    # The Tauri CLI prepares the exact Rust flags, embedded frontend and plugin code
    # before its Windows symlink step. Gradle can package those same files directly.
    foreach ($architecture in $architectures) {
      Invoke-NativePreparation $architecture.Target $architecture.Triple $architecture.Abi $configArguments
    }
    $effectiveConfig = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $androidConfig = Get-Content -LiteralPath 'src-tauri/tauri.android.conf.json' -Raw | ConvertFrom-Json
    Merge-AndroidConfig $effectiveConfig $androidConfig
    if ($effectiveConfig.bundle.resources) { throw 'CopyNativeLibraries does not yet stage extra bundle.resources.' }
    if (-not $effectiveConfig.PSObject.Properties['plugins']) {
      $effectiveConfig | Add-Member -NotePropertyName 'plugins' -NotePropertyValue ([pscustomobject]@{})
    }
    $assetDirectory = Join-Path $repoRoot 'src-tauri/gen/android/app/src/main/assets'
    New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
    [IO.File]::WriteAllText((Join-Path $assetDirectory 'tauri.conf.json'), ($effectiveConfig | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
    # Recreate APKs: incremental ZIP updates can retain an unused copy of the
    # previous native library, nearly doubling a debug APK's download size.
    $gradleArguments = @('-p', (Join-Path $repoRoot 'src-tauri/gen/android'), ':app:clean')
    $gradleArguments += @($architectures | ForEach-Object { ":app:assemble$($_.GradleName)Debug" })
    foreach ($architecture in $architectures) { $gradleArguments += @('-x', ":app:rustBuild$($architecture.GradleName)Debug") }
    $gradleArguments += @('--console=plain', '--no-daemon')
    Invoke-BuildCommand (Join-Path $repoRoot 'src-tauri/gen/android/gradlew.bat') $gradleArguments
  } else {
    Invoke-BuildCommand 'npx.cmd' $buildArguments
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
  $artifacts = @()
  foreach ($architecture in $architectures) {
    $source = Join-Path $repoRoot "src-tauri/gen/android/app/build/outputs/apk/$($architecture.flavor)/debug/app-$($architecture.flavor)-debug.apk"
    if (-not (Test-Path -LiteralPath $source)) { throw "Expected split debug APK was not built: $source" }
    $archive = [IO.Compression.ZipFile]::OpenRead($source)
    try {
      $abis = @($archive.Entries | Where-Object { $_.FullName -match '^lib/[^/]+/[^/]+\.so$' } |
        ForEach-Object { $_.FullName.Split('/')[1] } | Sort-Object -Unique)
      if ($abis.Count -ne 1 -or $abis[0] -ne $architecture.abi) {
        throw "Expected only $($architecture.abi) native libraries in $source; found: $($abis -join ', ')."
      }
    } finally { $archive.Dispose() }
    Invoke-BuildCommand (Join-Path $JavaHome 'bin/java.exe') @(
      '-jar', (Join-Path $AndroidHome 'build-tools/36.0.0/lib/apksigner.jar'),
      'verify', '--verbose', '--print-certs', $source
    )
    Invoke-BuildCommand (Join-Path $AndroidHome 'build-tools/36.0.0/aapt.exe') @('dump', 'badging', $source)
    $name = "RushLink_${version}_android-$($architecture.label)_debug.apk"
    $destination = Join-Path $outputRoot $name
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $artifacts += [pscustomobject]@{
      name = $name
      abi = $architecture.abi
      sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
      bytes = (Get-Item -LiteralPath $destination).Length
    }
  }
  # Keep checksums complete when only one ABI is rebuilt and another APK remains staged.
  $stagedArtifacts = @(Get-ChildItem -LiteralPath $outputRoot -Filter '*.apk' -File | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length }
  })
  $checksums = ($stagedArtifacts | ForEach-Object { "$($_.sha256)  $($_.name)" }) -join "`n"
  [IO.File]::WriteAllText((Join-Path $outputRoot 'SHA256SUMS.txt'), "$checksums`n", [Text.UTF8Encoding]::new($false))
  $record = [ordered]@{
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    version = $version
    target = $Target
    configuration = 'debug; signed with a local Android debug key; not a store release'
    command = "npx $($buildArguments -join ' ')"
    executedCommands = $executedCommands.ToArray()
    javaHome = $JavaHome
    javaVersion = ($javaRelease -split "`n" | Where-Object { $_ -match '^JAVA_VERSION=' }).Trim()
    ndk = [string](Get-Content -LiteralPath (Join-Path $NdkHome 'source.properties') -Raw)
    skippedFrontendBuild = [bool]$SkipFrontendBuild
    copiedNativeLibraries = [bool]$CopyNativeLibraries
    artifacts = $artifacts
    stagedArtifacts = $stagedArtifacts
  }
  $recordJson = $record | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText((Join-Path $toolRoot 'android-build-info.json'), $recordJson, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $outputRoot 'build-info.json'), $recordJson, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $outputRoot "build-info-$Target.json"), $recordJson, [Text.UTF8Encoding]::new($false))
  Write-Host "Verified debug APKs and SHA-256 checksums saved to $outputRoot"
} finally {
  if ($transcribing) { Stop-Transcript | Out-Null }
  foreach ($key in $previousEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process')
  }
  Pop-Location
}
