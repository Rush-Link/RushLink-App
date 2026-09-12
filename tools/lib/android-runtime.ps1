# Runtime helpers for the workspace-owned Android emulators. No default ADB port or
# Android Studio AVD is used by these functions.

function ConvertTo-RushLinkNativeArguments {
  param([string[]]$Arguments)
  $escaped = foreach ($argument in $Arguments) {
    $argument = [string]$argument
    if ($argument -and $argument -notmatch '[\s"]') { $argument; continue }
    $value = [Text.StringBuilder]::new('"')
    $slashes = 0
    foreach ($character in $argument.ToCharArray()) {
      if ($character -eq '\') { $slashes++; continue }
      if ($character -eq '"') {
        [void]$value.Append(('\' * (2 * $slashes + 1)))
      } else {
        [void]$value.Append(('\' * $slashes))
      }
      [void]$value.Append($character)
      $slashes = 0
    }
    [void]$value.Append(('\' * (2 * $slashes)))
    [void]$value.Append('"')
    $value.ToString()
  }
  return $escaped -join ' '
}

function Invoke-RushLinkRuntimeCommand {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [int]$TimeoutSeconds = 30,
    [string]$InputText,
    [string]$LogPath,
    [hashtable]$Environment = @{},
    [switch]$AllowFailure
  )
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.Arguments = ConvertTo-RushLinkNativeArguments $Arguments
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.RedirectStandardInput = $true
  foreach ($key in $Environment.Keys) { $start.EnvironmentVariables[$key] = $Environment[$key] }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  try {
    if (-not $process.Start()) { throw "Could not start $Executable." }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if ($null -ne $InputText) { $process.StandardInput.WriteLine($InputText) }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      $process.Kill()
      throw [TimeoutException]::new("$Executable timed out after $TimeoutSeconds seconds. Only its command process was stopped.")
    }
    $process.WaitForExit()
    $result = [pscustomobject]@{ ExitCode=$process.ExitCode; Output=$stdout.Result.TrimEnd(); Error=$stderr.Result.TrimEnd() }
    if ($LogPath) { [IO.File]::WriteAllText($LogPath, "$($result.Output)`n$($result.Error)", [Text.UTF8Encoding]::new($false)) }
    if ($result.ExitCode -ne 0 -and -not $AllowFailure) {
      throw "$Executable failed ($($result.ExitCode)): $($result.Error) $($result.Output)"
    }
    return $result
  } finally { $process.Dispose() }
}

function Get-RushLinkAndroidRuntime {
  param([string]$RepoRoot, [ValidateSet('tablet','phone')][string]$Profile = 'tablet')
  $phone = $Profile -eq 'phone'
  $avdName = if ($phone) { 'RushLink_Phone_API_36' } else { 'RushLink_Tablet_API_36' }
  $root = [IO.Path]::GetFullPath((Join-Path $RepoRoot "release-artifacts/build-tools/android-$Profile"))
  return [pscustomobject]@{
    RepoRoot=[IO.Path]::GetFullPath($RepoRoot); Root=$root
    UserHome=(Join-Path $root 'user'); AvdHome=(Join-Path $root 'avd')
    Profile=$Profile; AvdName=$avdName; DeviceProfile=$(if ($phone) { 'medium_phone' } else { 'medium_tablet' })
    DisplayName="RushLink $Profile"; Width=$(if ($phone) { 1080 } else { 1920 }); Height=$(if ($phone) { 2340 } else { 1200 })
    Density=$(if ($phone) { 440 } else { 240 }); Orientation=$(if ($phone) { 'portrait' } else { 'landscape' })
    AvdPath=(Join-Path $root "avd/$avdName.avd")
    StatePath=(Join-Path $root 'session.json'); LockPath=(Join-Path $root 'workflow.lock')
    AdbPort=$(if ($phone) { 5039 } else { 5038 }); ConsolePort=$(if ($phone) { 5582 } else { 5580 })
    TransportPort=$(if ($phone) { 5583 } else { 5581 }); DebugPort=$(if ($phone) { 9349 } else { 9348 })
    Serial=$(if ($phone) { 'emulator-5582' } else { 'emulator-5580' }); Package='app.rushlink.android'
  }
}

function Get-RushLinkRuntimeListeners {
  param($Runtime)
  return @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object LocalPort -in @($Runtime.AdbPort,$Runtime.ConsolePort,$Runtime.TransportPort,$Runtime.DebugPort) |
    Select-Object LocalAddress,LocalPort,OwningProcess)
}

function Get-RushLinkProcessIdentity {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  try {
    return [pscustomobject]@{ Id=$process.Id; StartedAtUtc=$process.StartTime.ToUniversalTime().ToString('o'); Executable=$process.Path }
  } catch { return $null }
}

function Test-RushLinkProcessIdentity {
  param($Identity)
  if (-not $Identity -or -not $Identity.Id -or -not $Identity.Executable -or -not $Identity.StartedAtUtc) { return $false }
  $actual = Get-RushLinkProcessIdentity ([int]$Identity.Id)
  return $actual -and $actual.StartedAtUtc -eq $Identity.StartedAtUtc -and $actual.Executable -eq $Identity.Executable
}

function Resolve-RushLinkTabletProcess {
  param($Runtime, $Session)
  if (-not $Session -or (Test-RushLinkProcessIdentity $Session.Emulator) -or
      -not (Test-RushLinkProcessIdentity $Session.Launcher)) { return }
  $qemuRoot = Join-Path (Split-Path -Parent $Session.Launcher.Executable) 'qemu/windows-x86_64'
  $expectedPaths = @((Join-Path $qemuRoot 'qemu-system-x86_64.exe'), (Join-Path $qemuRoot 'qemu-system-x86_64-headless.exe'))
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($Session.Launcher.Id)" -ErrorAction Stop)
  foreach ($candidate in $children) {
    if ($candidate.ExecutablePath -in $expectedPaths -and
        $candidate.CommandLine -match ('-avd\s+"?' + [regex]::Escape($Runtime.AvdName) + '(?:\s|"|$)') -and
        $candidate.CommandLine -match ('-port\s+' + $Runtime.ConsolePort + '(?:\s|$)')) {
      $Session.Emulator = Get-RushLinkProcessIdentity ([int]$candidate.ProcessId)
      return
    }
  }
}

function Read-RushLinkRuntimeSession {
  param($Runtime)
  if (-not (Test-Path -LiteralPath $Runtime.StatePath)) { return $null }
  try { $state = Get-Content -LiteralPath $Runtime.StatePath -Raw | ConvertFrom-Json }
  catch { throw "Cannot read the emulator session record at $($Runtime.StatePath). No running process was changed." }
  if ($state.Version -ne 1 -or $state.RepoRoot -ne $Runtime.RepoRoot -or $state.AvdName -ne $Runtime.AvdName) {
    throw 'The emulator session record belongs to another workspace. No running process was changed.'
  }
  # A cancelled startup may have recorded the launcher just before its QEMU child appeared.
  # Recognize only that still-running launcher's exact binary, AVD and console port.
  Resolve-RushLinkTabletProcess $Runtime $state
  return $state
}

function Write-RushLinkRuntimeSession {
  param($Runtime, $Session)
  [IO.File]::WriteAllText($Runtime.StatePath, ($Session | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
}

function Assert-RushLinkRuntimeOwnership {
  param($Runtime, $Session)
  foreach ($listener in (Get-RushLinkRuntimeListeners $Runtime)) {
    $owner = if ($listener.LocalPort -in @($Runtime.AdbPort, $Runtime.DebugPort)) { $Session.Adb } else { $Session.Emulator }
    if (-not (Test-RushLinkProcessIdentity $owner) -or $listener.OwningProcess -ne $owner.Id) {
      throw "Port $($listener.LocalPort) is occupied by a process outside this emulator session. Close that conflicting service or choose another workflow; RushLink did not stop it."
    }
  }
}

function Invoke-RushLinkTabletAdb {
  param($Runtime, [string]$AdbPath, [string[]]$Arguments, [int]$TimeoutSeconds=30, [string]$LogPath, [switch]$AllowFailure)
  $session = Read-RushLinkRuntimeSession $Runtime
  Assert-RushLinkRuntimeOwnership $Runtime $session
  if (-not (Test-RushLinkProcessIdentity $session.Adb) -or $session.Adb.Executable -ine $AdbPath) {
    throw 'The recorded isolated ADB server is no longer running. Run the emulator launcher again; no replacement server was started by this command.'
  }
  return Invoke-RushLinkRuntimeCommand -Executable $AdbPath -Arguments (@('-P', [string]$Runtime.AdbPort, '-s', $Runtime.Serial) + $Arguments) -TimeoutSeconds $TimeoutSeconds -LogPath $LogPath -Environment @{ ADB_SERVER_SOCKET="tcp:127.0.0.1:$($Runtime.AdbPort)"; ANDROID_ADB_SERVER_PORT=[string]$Runtime.AdbPort } -AllowFailure:$AllowFailure
}

function Start-RushLinkTabletAdb {
  param($Runtime, $Tools, $Session, [string]$LogRoot)
  if (Test-RushLinkProcessIdentity $Session.Adb) { return }
  $arguments = ConvertTo-RushLinkNativeArguments @('-L', "tcp:$($Runtime.AdbPort)", 'nodaemon', 'server')
  $process = Start-Process -FilePath $Tools.AdbPath -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogRoot 'adb.stdout.log') -RedirectStandardError (Join-Path $LogRoot 'adb.stderr.log')
  $Session.Adb = Get-RushLinkProcessIdentity $process.Id
  Write-RushLinkRuntimeSession $Runtime $Session
  for ($attempt=0; $attempt -lt 20; $attempt++) {
    if (-not (Test-RushLinkProcessIdentity $Session.Adb)) { throw "The isolated ADB server exited. See $(Join-Path $LogRoot 'adb.stderr.log')." }
    $listeners = @(Get-RushLinkRuntimeListeners $Runtime | Where-Object LocalPort -eq $Runtime.AdbPort)
    if ($listeners.Count) { Assert-RushLinkRuntimeOwnership $Runtime $Session; return }
    Start-Sleep -Milliseconds 250
  }
  throw "The isolated ADB server did not become ready on port $($Runtime.AdbPort)."
}

function Ensure-RushLinkTabletAvd {
  param($Runtime, $Tools, [string]$LogRoot)
  $config = Join-Path $Runtime.AvdPath 'config.ini'
  if (Test-Path -LiteralPath $config) {
    $content = Get-Content -LiteralPath $config -Raw
    if ($content -notmatch '(?m)^abi.type=x86_64\s*$' -or $content -notmatch '(?m)^image.sysdir.1=system-images[\\/]android-36[\\/]default[\\/]x86_64') {
      throw "The workspace emulator uses an unexpected system image. Its data was preserved: $config"
    }
    return
  }
  if (Test-Path -LiteralPath $Runtime.AvdPath) { throw "The emulator directory is incomplete: $($Runtime.AvdPath). It was not replaced." }
  $toolsDir = Join-Path $Tools.AndroidHome 'cmdline-tools/latest'
  Write-Host 'Creating the persistent RushLink emulator (Android 36, x86_64).'
  Invoke-RushLinkRuntimeCommand -Executable (Join-Path $Tools.JavaHome 'bin/java.exe') -Arguments @(
    "-Dcom.android.sdkmanager.toolsdir=$toolsDir", '-classpath', (Join-Path $toolsDir 'lib/avdmanager-classpath.jar'),
    'com.android.sdklib.tool.AvdManagerCli', 'create', 'avd', '--name', $Runtime.AvdName,
    '--package', 'system-images;android-36;default;x86_64', '--device', $Runtime.DeviceProfile, '--path', $Runtime.AvdPath
  ) -InputText 'no' -TimeoutSeconds 90 -LogPath (Join-Path $LogRoot 'avd-create.log') | Out-Null
  # Set the selected profile dimensions once; preserve existing emulator settings on later runs.
  $defaults = [ordered]@{
    'avd.ini.displayname'=$Runtime.DisplayName; 'hw.lcd.width'=$Runtime.Width; 'hw.lcd.height'=$Runtime.Height; 'hw.lcd.density'=$Runtime.Density
    'hw.ramSize'='3072'; 'hw.cpu.ncore'='4'; 'hw.gpu.enabled'='yes'; 'hw.gpu.mode'='auto'
    'hw.initialOrientation'=$Runtime.Orientation; 'disk.dataPartition.size'='6G'; 'fastboot.forceColdBoot'='no'; 'fastboot.forceFastBoot'='yes'
  }
  $lines = [Collections.Generic.List[string]]::new()
  foreach ($line in (Get-Content -LiteralPath $config)) {
    $key = ($line -split '=',2)[0]
    if (-not $defaults.Contains($key)) { $lines.Add($line) }
  }
  foreach ($key in $defaults.Keys) { $lines.Add("$key=$($defaults[$key])") }
  [IO.File]::WriteAllLines($config, $lines, [Text.UTF8Encoding]::new($false))
}

function Start-RushLinkTabletEmulator {
  param($Runtime, $Tools, $Session, [string]$LogRoot, [switch]$Headless, [int]$MemoryMb=3072, [string]$Gpu='auto')
  if (Test-RushLinkProcessIdentity $Session.Emulator) {
    Write-Host 'Reusing the running RushLink emulator.'
    return $false
  }
  $arguments = @('-avd',$Runtime.AvdName,'-port',[string]$Runtime.ConsolePort,'-sysdir',$Tools.SystemImagePath,'-memory',[string]$MemoryMb,'-cores','4','-accel','on','-gpu',$Gpu,'-no-audio','-no-boot-anim')
  if ($Headless) { $arguments += '-no-window' }
  $style = if ($Headless) { 'Hidden' } else { 'Normal' }
  Write-Host 'Starting the RushLink emulator. Later starts reuse its saved state.'
  $process = Start-Process -FilePath $Tools.EmulatorPath -ArgumentList (ConvertTo-RushLinkNativeArguments $arguments) -WindowStyle $style -PassThru -RedirectStandardOutput (Join-Path $LogRoot 'emulator.stdout.log') -RedirectStandardError (Join-Path $LogRoot 'emulator.stderr.log')
  $Session.Launcher = Get-RushLinkProcessIdentity $process.Id
  $Session.Headless = [bool]$Headless
  Write-RushLinkRuntimeSession $Runtime $Session
  for ($attempt=0; $attempt -lt 90; $attempt++) {
    $listener = Get-RushLinkRuntimeListeners $Runtime | Where-Object LocalPort -eq $Runtime.ConsolePort | Select-Object -First 1
    if ($listener) {
      Resolve-RushLinkTabletProcess $Runtime $Session
      if (-not $Session.Emulator -or $Session.Emulator.Id -ne $listener.OwningProcess) {
        throw 'The emulator console is owned by an unexpected process. It was not contacted.'
      }
      Write-RushLinkRuntimeSession $Runtime $Session
      Assert-RushLinkRuntimeOwnership $Runtime $Session
      return $true
    }
    if (-not (Test-RushLinkProcessIdentity $Session.Launcher)) { throw "The emulator launcher exited before its console appeared. See $(Join-Path $LogRoot 'emulator.stderr.log')." }
    Start-Sleep -Milliseconds 500
  }
  throw 'The emulator console did not become ready within 45 seconds.'
}

function Wait-RushLinkTabletBoot {
  param($Runtime, $Tools, $Session, [int]$TimeoutSeconds=240)
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $lastProgress = -20
  $stable = 0
  while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    Assert-RushLinkRuntimeOwnership $Runtime $Session
    if (-not (Test-RushLinkProcessIdentity $Session.Emulator)) { throw 'The RushLink emulator exited during boot.' }
    try {
      $boot = Invoke-RushLinkTabletAdb $Runtime $Tools.AdbPath @('shell','getprop','sys.boot_completed') -TimeoutSeconds 5 -AllowFailure
    } catch [TimeoutException] {
      # ADB can briefly accept a connection before the Android shell can answer.
      # Retry this read within the overall boot deadline, without restarting ADB.
      $boot = [pscustomobject]@{ ExitCode=-1; Output='' }
    }
    if ($boot.ExitCode -eq 0 -and $boot.Output.Trim() -eq '1') { $stable++ } else { $stable=0 }
    if ($stable -ge 2) { return }
    if ($watch.Elapsed.TotalSeconds -ge $lastProgress + 20) { $lastProgress=[int]$watch.Elapsed.TotalSeconds; Write-Host "Waiting for Android to finish booting ($lastProgress seconds)." }
    Start-Sleep -Seconds 2
  }
  throw "The emulator did not finish booting within $TimeoutSeconds seconds. Its logs were retained."
}

function Stop-RushLinkTabletSession {
  param($Runtime, $Session, [string]$AdbPath, [switch]$KeepEmulator, [switch]$KeepAdb)
  if (-not $Session) {
    Assert-RushLinkRuntimeOwnership $Runtime $Session
    Write-Host 'No RushLink emulator session is running.'
    return
  }
  Resolve-RushLinkTabletProcess $Runtime $Session
  Assert-RushLinkRuntimeOwnership $Runtime $Session
  if (Test-RushLinkProcessIdentity $Session.Adb) {
    Invoke-RushLinkTabletAdb $Runtime $AdbPath @('forward','--remove',"tcp:$($Runtime.DebugPort)") -AllowFailure | Out-Null
  }
  if (-not $KeepEmulator -and (Test-RushLinkProcessIdentity $Session.Emulator)) {
    Write-Host 'Closing the RushLink emulator and saving its state.'
    if (Test-RushLinkProcessIdentity $Session.Adb) {
      Invoke-RushLinkTabletAdb $Runtime $AdbPath @('emu','kill') -AllowFailure | Out-Null
    } else {
      # Never let an ADB client silently start an unrecorded server during cleanup.
      Stop-Process -Id $Session.Emulator.Id -Force
    }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ((Test-RushLinkProcessIdentity $Session.Emulator) -and $watch.Elapsed.TotalSeconds -lt 45) { Start-Sleep -Milliseconds 500 }
    if (Test-RushLinkProcessIdentity $Session.Emulator) {
      Write-Warning 'The emulator did not finish saving its snapshot; stopping only its recorded process.'
      Stop-Process -Id $Session.Emulator.Id -Force
    }
  }
  if (-not $KeepEmulator) {
    if (Test-RushLinkProcessIdentity $Session.Launcher) { Stop-Process -Id $Session.Launcher.Id -Force }
    $Session.Emulator=$null; $Session.Launcher=$null
  }
  if (-not $KeepAdb) {
    if (Test-RushLinkProcessIdentity $Session.Adb) { Stop-Process -Id $Session.Adb.Id }
    $Session.Adb=$null
  }
  Write-RushLinkRuntimeSession $Runtime $Session
  if ($KeepEmulator) { Write-Host 'The previously running RushLink emulator was left open.' }
  else { Write-Host 'RushLink emulator stopped. Other emulators and ADB servers were left running.' }
}
