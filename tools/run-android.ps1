<#
.SYNOPSIS
Build, install and open RushLink in its own persistent Android emulator.
.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools/run-android.ps1
.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools/run-android.ps1 -SkipBuild
.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools/run-android.ps1 -SmokeTest -SkipBuild
.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools/run-android.ps1 -Stop
#>
[CmdletBinding()]
param(
  [ValidateSet('tablet', 'phone')][string]$Profile = 'tablet',
  [switch]$Check,
  [switch]$Json,
  [switch]$Stop,
  [switch]$SkipBuild,
  [switch]$Headless,
  [switch]$SmokeTest,
  [switch]$AcceptLicenses,
  [string]$JavaHome,
  [string]$AndroidHome,
  [string]$NdkHome,
  [ValidateRange(2048, 8192)][int]$MemoryMb = 3072,
  [ValidateSet('auto', 'host', 'software', 'swiftshader')][string]$Gpu = 'auto',
  [ValidateRange(60, 600)][int]$BootTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This launcher is for local Windows Android testing.' }
if ($Check -and $Stop) { throw 'Choose either -Check or -Stop.' }
if ($Json -and -not $Check) { throw '-Json is available with -Check.' }
if (($Check -or $Stop) -and ($SkipBuild -or $Headless -or $SmokeTest -or $AcceptLicenses)) {
  throw '-Check and -Stop cannot be combined with run options.'
}
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib/android-tools.ps1')
. (Join-Path $PSScriptRoot 'lib/android-runtime.ps1')
$runtime = Get-RushLinkAndroidRuntime $repoRoot -Profile $Profile
$selection = @{ JavaHome=$JavaHome; AndroidHome=$AndroidHome; NdkHome=$NdkHome; Target='emulator'; Tablet=$true }
$session = Read-RushLinkRuntimeSession $runtime
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$apkPath = Join-Path $repoRoot "release-artifacts/current-build/android/RushLink_${version}_android-x86_64-emulator_debug_headrush-5.2.0.apk"

if ($Check) {
  $toolchain = Get-RushLinkAndroidToolchain @selection
  $conflict = $null
  try { Assert-RushLinkRuntimeOwnership $runtime $session } catch { $conflict=$_.Exception.Message }
  $acceleration = $null
  if (Test-Path -LiteralPath $toolchain.EmulatorPath) {
    $acceleration = Invoke-RushLinkRuntimeCommand $toolchain.EmulatorPath @('-accel-check') -AllowFailure
  }
  $status = [pscustomobject]@{
    Ready=($toolchain.Ready -and -not $conflict -and $acceleration -and $acceleration.ExitCode -eq 0)
    Missing=$toolchain.Missing; Conflict=$conflict; Acceleration=$acceleration
    Running=[bool](Test-RushLinkProcessIdentity $session.Emulator)
    ApkExists=(Test-Path -LiteralPath $apkPath); ApkPath=$apkPath
    AvdExists=(Test-Path -LiteralPath (Join-Path $runtime.AvdPath 'config.ini'))
    AvdName=$runtime.AvdName; AvdHome=$runtime.AvdHome; AndroidHome=$toolchain.AndroidHome
    JavaHome=$toolchain.JavaHome; AdbPort=$runtime.AdbPort; EmulatorPort=$runtime.ConsolePort
  }
  if ($Json) { $status | ConvertTo-Json -Depth 6 }
  else {
    $status | Format-List
    if ($status.Ready) { Write-Host 'Ready. Run tools/run-android.ps1 to build and open the emulator.' }
    else { Write-Host 'Run tools/run-android.ps1 to install missing tools, or resolve the reported prerequisite.' }
  }
  if (-not $status.Ready) { exit 1 }
  exit 0
}

if ($Stop -and -not (Test-Path -LiteralPath $runtime.Root)) {
  Assert-RushLinkRuntimeOwnership $runtime $session
  Write-Host 'No RushLink emulator session is running.'
  exit 0
}
New-Item -ItemType Directory -Force -Path $runtime.Root | Out-Null
try { $workflowLock = [IO.File]::Open($runtime.LockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw 'Another RushLink emulator command is running. Let it finish before starting or stopping the emulator.' }
$previousEnvironment = @{}
$logRoot = $null
$succeeded = $false
$keptEmulator = $false
$keptAdb = $false
$toolchain = $null
try {
  # Re-read under the lock, then reject occupied ports before starting any tools.
  $session = Read-RushLinkRuntimeSession $runtime
  Assert-RushLinkRuntimeOwnership $runtime $session
  $keptEmulator = [bool](Test-RushLinkProcessIdentity $session.Emulator)
  $keptAdb = [bool](Test-RushLinkProcessIdentity $session.Adb)
  if ($Stop) {
    $adbPath = if ($session.Adb) { $session.Adb.Executable } else { '' }
    Stop-RushLinkTabletSession $runtime $session $adbPath
    $succeeded = $true
    return
  }
  $toolchain = Install-RushLinkAndroidToolchain @selection -AcceptLicenses:$AcceptLicenses
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  $nodeCheck = Invoke-RushLinkRuntimeCommand $nodePath @('-p', 'typeof WebSocket === "function"')
  if ($nodeCheck.Output.Trim() -ne 'true') { throw 'The emulator launcher requires Node.js 22 or newer.' }
  $acceleration = Invoke-RushLinkRuntimeCommand $toolchain.EmulatorPath @('-accel-check') -AllowFailure
  if ($acceleration.ExitCode -ne 0) {
    throw "Android emulator acceleration is unavailable: $($acceleration.Output) $($acceleration.Error). Enable a supported Windows hypervisor manually before running the emulator."
  }
  $logRoot = Join-Path $repoRoot ("release-artifacts/current-build/android/$Profile/" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $logRoot,$runtime.UserHome,$runtime.AvdHome | Out-Null
  Write-Host "Emulator logs and screenshots: $logRoot"
  if (-not $SkipBuild) {
    Write-Host 'Building the current RushLink code for the x86_64 emulator.'
    & (Join-Path $PSScriptRoot 'build-android.ps1') -Target emulator -JavaHome $toolchain.JavaHome -AndroidHome $toolchain.AndroidHome -NdkHome $toolchain.NdkHome -AcceptLicenses:$AcceptLicenses
  } else { Write-Host 'Using the existing emulator APK (-SkipBuild).' }
  if (-not (Test-Path -LiteralPath $apkPath)) { throw "The emulator APK is missing: $apkPath. Run without -SkipBuild first." }
  $apkHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $packageInfo = Invoke-RushLinkRuntimeCommand (Join-Path $toolchain.AndroidHome 'build-tools/36.0.0/aapt2.exe') @('dump','badging',$apkPath)
  if ($packageInfo.Output -notmatch "(?m)^package: name='app\.rushlink\.android' " -or
      $packageInfo.Output -notmatch ("(?m)^package: .*versionName='" + [regex]::Escape($version) + "'") -or
      $packageInfo.Output -notmatch "(?m)^native-code: 'x86_64'\s*$") {
    throw 'The staged APK is not the RushLink x86_64 emulator build. Build again without -SkipBuild.'
  }
  $environment = @{
    JAVA_HOME=$toolchain.JavaHome; ANDROID_HOME=$toolchain.AndroidHome; ANDROID_SDK_ROOT=$toolchain.AndroidHome
    ANDROID_USER_HOME=$runtime.UserHome; ANDROID_EMULATOR_HOME=$runtime.UserHome; ANDROID_AVD_HOME=$runtime.AvdHome
    ANDROID_ADB_SERVER_PORT=[string]$runtime.AdbPort; ADB_SERVER_SOCKET="tcp:127.0.0.1:$($runtime.AdbPort)"
    PATH="$(Join-Path $toolchain.JavaHome 'bin');$(Join-Path $toolchain.AndroidHome 'platform-tools');$env:PATH"
  }
  foreach ($key in $environment.Keys) {
    $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process')
  }
  if (-not $session) {
    $session = [pscustomobject]@{ Version=1; RepoRoot=$runtime.RepoRoot; AvdName=$runtime.AvdName; Adb=$null; Emulator=$null; Launcher=$null; Headless=$false }
    Write-RushLinkRuntimeSession $runtime $session
  }
  Ensure-RushLinkTabletAvd $runtime $toolchain $logRoot
  if (-not ($Headless -or $SmokeTest) -and $session.Headless -and (Test-RushLinkProcessIdentity $session.Emulator)) {
    Write-Host 'Reopening the previously headless RushLink emulator in a visible window.'
    Stop-RushLinkTabletSession $runtime $session $toolchain.AdbPath -KeepAdb
    $keptEmulator = $false
  }
  Start-RushLinkTabletAdb $runtime $toolchain $session $logRoot
  $null = Start-RushLinkTabletEmulator $runtime $toolchain $session $logRoot -Headless:($Headless -or $SmokeTest) -MemoryMb $MemoryMb -Gpu $Gpu
  Wait-RushLinkTabletBoot $runtime $toolchain $session -TimeoutSeconds $BootTimeoutSeconds
  Write-Host 'Installing RushLink and opening the app.'
  Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('install','--no-streaming','-r','-t',$apkPath) -TimeoutSeconds 180 -LogPath (Join-Path $logRoot 'install.log') | Out-Null
  Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('shell','am','start','-W','-n',"$($runtime.Package)/.MainActivity") -TimeoutSeconds 60 -LogPath (Join-Path $logRoot 'launch.log') | Out-Null
  $appId = ''
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    $appProcess = Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('shell','pidof',$runtime.Package) -AllowFailure
    if ($appProcess.Output.Trim() -match '^\d+$') { $appId=$appProcess.Output.Trim(); break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $appId) { throw 'RushLink did not keep a running Android process. See the launch log.' }
  Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('forward','--remove',"tcp:$($runtime.DebugPort)") -AllowFailure | Out-Null
  Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('forward','--no-rebind',"tcp:$($runtime.DebugPort)","localabstract:webview_devtools_remote_$appId") | Out-Null
  Write-Host 'Waiting for the RushLink screen to finish loading.'
  $webview = Invoke-RushLinkRuntimeCommand $nodePath @((Join-Path $PSScriptRoot 'lib/android-webview.mjs'),$logRoot,'120',[string]$runtime.DebugPort,$Profile) -TimeoutSeconds 160 -LogPath (Join-Path $logRoot 'webview.log') -AllowFailure
  Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('logcat','-d','-t','2000') -LogPath (Join-Path $logRoot 'startup-logcat.txt') | Out-Null
  if ($webview.ExitCode -ne 0) { throw "RushLink screen verification failed. $($webview.Error) See $logRoot" }
  Write-Host $webview.Output
  # Check Android's foreground window too: a ready WebView can sit behind a system dialog.
  $foreground = $false
  for ($attempt=0; $attempt -lt 15; $attempt++) {
    $window = Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('shell','dumpsys','window') -LogPath (Join-Path $logRoot 'window-state.txt')
    if ($window.Output -match 'mCurrentFocus=Window\{[^\r\n]*app\.rushlink\.android/') { $foreground=$true; break }
    Start-Sleep -Seconds 2
  }
  Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('shell','screencap','-p',"/sdcard/rushlink-$Profile.png") -TimeoutSeconds 45 | Out-Null
  Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('pull',"/sdcard/rushlink-$Profile.png",(Join-Path $logRoot "$Profile.png")) -TimeoutSeconds 45 | Out-Null
  if (-not $foreground) { throw "RushLink loaded, but Android has another window in front. See $Profile.png in $logRoot. Open the emulator normally to dismiss it." }
  $fatal = Select-String -LiteralPath (Join-Path $logRoot 'startup-logcat.txt') -Pattern "FATAL EXCEPTION.*|Fatal signal.*(?:$appId|rushlink)|JNI DETECTED ERROR|thread '.*' panicked" |
    Where-Object { $_.Line -match "\s$appId\s" }
  if ($fatal) { throw "RushLink reported a fatal runtime error. See startup-logcat.txt in $logRoot." }
  $result = [pscustomobject]@{
    Passed=$true; Profile=$Profile; CheckedAtUtc=[DateTime]::UtcNow.ToString('o'); Package=$runtime.Package; AppPid=$appId
    Apk=$apkPath; Sha256=$apkHash; Avd=$runtime.AvdName; Serial=$runtime.Serial
    Headless=[bool]$session.Headless; WebViewReady=$true; Foreground=$foreground
    Screenshot=(Join-Path $logRoot "$Profile.png"); Artifacts=$logRoot
  }
  $resultJson = $result | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText((Join-Path $logRoot 'result.json'),$resultJson,[Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path (Split-Path -Parent $logRoot) 'latest.json'),$resultJson,[Text.UTF8Encoding]::new($false))
  $succeeded=$true
  if ($SmokeTest) { Write-Host 'Emulator smoke test passed.' }
  else { Write-Host 'RushLink is open. Run the same command after edits; use -Stop when finished.' }
} catch {
  if ($logRoot) {
    [IO.File]::WriteAllText((Join-Path $logRoot 'failure.txt'),($_ | Out-String),[Text.UTF8Encoding]::new($false))
    Write-Host "Emulator startup failed. Evidence: $logRoot"
  }
  throw
} finally {
  try {
    if (-not $Stop -and $session -and $toolchain) {
      if ($SmokeTest -or -not $succeeded) {
        Stop-RushLinkTabletSession $runtime $session $toolchain.AdbPath -KeepEmulator:$keptEmulator -KeepAdb:$keptAdb
      } elseif (Test-RushLinkProcessIdentity $session.Adb) {
        Invoke-RushLinkTabletAdb $runtime $toolchain.AdbPath @('forward','--remove',"tcp:$($runtime.DebugPort)") -AllowFailure | Out-Null
      }
    }
  } finally {
    foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key,$previousEnvironment[$key],'Process') }
    $workflowLock.Dispose()
  }
}
