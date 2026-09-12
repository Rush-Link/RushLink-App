[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib/android-tools.ps1')
$testRoot = Join-Path $repoRoot 'release-artifacts/build-tools'
$fixtureRoot = Join-Path $testRoot "android-tools-test-$([Guid]::NewGuid().ToString('N'))"
$checks = [System.Collections.Generic.List[string]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()
$beforeJava = $env:JAVA_HOME

function Assert-AndroidToolCheck {
  param([bool]$Condition, [string]$Name)
  if (-not $Condition) { throw "FAIL: $Name" }
  $checks.Add($Name)
}

function Write-AndroidToolFixture {
  param([string]$Path, [string]$Text = '')
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [IO.File]::WriteAllText($Path, $Text)
}

try {
  $fakeRepo = Join-Path $fixtureRoot 'project'
  $fakeToolRoot = Join-Path $fakeRepo 'release-artifacts/build-tools'
  $fakeJdk = Join-Path $fakeToolRoot 'jdk/jdk-17.0.20.1+1'
  $fakeJava25 = Join-Path $fixtureRoot 'global-java-25'
  # Discovery reads metadata only; these fixture executables are never run.
  Write-AndroidToolFixture (Join-Path $fakeJdk 'bin/java.exe')
  Write-AndroidToolFixture (Join-Path $fakeJdk 'release') 'JAVA_VERSION="17.0.20.1"'
  Write-AndroidToolFixture (Join-Path $fakeJava25 'bin/java.exe')
  Write-AndroidToolFixture (Join-Path $fakeJava25 'release') 'JAVA_VERSION="25.0.3"'
  $env:JAVA_HOME = $fakeJava25
  $selected = Get-RushLinkAndroidToolchain -RepoRoot $fakeRepo -Target emulator
  Assert-AndroidToolCheck ($selected.JavaHome -eq $fakeJdk) 'Workspace JDK 17 wins over incompatible global Java 25'
  Assert-AndroidToolCheck ($env:JAVA_HOME -eq $fakeJava25) 'Discovery preserves process environment'
  Assert-AndroidToolCheck (@(Get-RushLinkAndroidTargets all).Count -eq 2) 'Default target includes both ABIs'
  Assert-AndroidToolCheck ((@(Get-RushLinkAndroidTargets emulator).Count -eq 1) -and (Get-RushLinkAndroidTargets emulator).Triple -eq 'x86_64-linux-android') 'Emulator selects only x86_64'
  Assert-AndroidToolCheck ((@(Get-RushLinkAndroidTargets device).Count -eq 1) -and (Get-RushLinkAndroidTargets device).Triple -eq 'aarch64-linux-android') 'Device selects only ARM64'
  $badJava = Get-RushLinkAndroidToolchain -RepoRoot $fakeRepo -JavaHome $fakeJava25
  Assert-AndroidToolCheck (-not $badJava.Ready -and @($badJava.Missing | Where-Object { $_ -like 'Compatible JDK*' }).Count -eq 1) 'Explicit incompatible Java is reported'
  $emptyRoot = Join-Path $fixtureRoot 'never-created'
  $missing = Get-RushLinkAndroidToolchain -RepoRoot $emptyRoot -JavaHome $fakeJdk -Target emulator
  Assert-AndroidToolCheck (-not $missing.Ready -and -not (Test-Path -LiteralPath $emptyRoot)) 'Missing-tool doctor does not write files'
  if (-not $selected.MissingCommands.Count) {
    $refused = $false
    try { Install-RushLinkAndroidToolchain -RepoRoot $fakeRepo -JavaHome $fakeJava25 | Out-Null } catch { $refused = $_.Exception.Message -like '*explicit -JavaHome*' }
    Assert-AndroidToolCheck $refused 'Explicit incompatible Java fails before installation'
    $licenseRefused = $false
    try { Install-RushLinkAndroidToolchain -RepoRoot $emptyRoot -JavaHome $fakeJdk -Target emulator | Out-Null } catch { $licenseRefused = $_.Exception.Message -like '*licenses have not been accepted*' }
    Assert-AndroidToolCheck ($licenseRefused -and -not (Test-Path -LiteralPath $emptyRoot)) 'Missing license acceptance stops setup before downloads or writes'
  } else {
    $skipped.Add('Installation refusal checks require the Node.js and Rust command prerequisites.')
  }
  $cachedBad = Join-Path $fixtureRoot 'corrupt.zip'
  Write-AndroidToolFixture $cachedBad 'This is not a verified archive.'
  $hashRefused = $false
  try { Get-RushLinkVerifiedDownload 'https://invalid.example/not-requested.zip' ('0' * 64) $cachedBad | Out-Null } catch { $hashRefused = $_.Exception.Message -like '*Cached archive checksum mismatch*' }
  Assert-AndroidToolCheck $hashRefused 'Corrupt cached archive is refused without downloading'
  $setup = Join-Path $PSScriptRoot 'setup-android.ps1'
  $setupOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup -Check -Json -JavaHome $fakeJava25
  $setupExitCode = $LASTEXITCODE
  $setupStatus = ($setupOutput -join "`n") | ConvertFrom-Json
  Assert-AndroidToolCheck ($setupExitCode -eq 1 -and -not $setupStatus.Ready) 'Doctor produces JSON and a nonzero exit for invalid tools'
  $realTools = Get-RushLinkAndroidToolchain -Tablet -Target emulator
  if ($realTools.Ready) {
    $setupOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup -Check -Json -Tablet -Target emulator
    $setupExitCode = $LASTEXITCODE
    $setupStatus = ($setupOutput -join "`n") | ConvertFrom-Json
    Assert-AndroidToolCheck ($setupExitCode -eq 0 -and $setupStatus.Ready) 'Doctor produces JSON success for installed tools'
    $passThru = & $setup -PassThru -Tablet -Target emulator
    Assert-AndroidToolCheck ($passThru.Ready -and $passThru.EmulatorPath -eq $realTools.EmulatorPath) 'Launcher setup returns one ready toolchain object'
  } else {
    $skipped.Add('Installed-toolchain integration checks require setup-android.ps1 -Tablet first.')
  }
  $result = [pscustomobject]@{ checkedAtUtc = [DateTime]::UtcNow.ToString('o'); passed = $checks.Count; checks = $checks.ToArray(); skipped = $skipped.ToArray() }
  $result | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $testRoot 'android-automation-checks.json')
  $result | ConvertTo-Json -Depth 3
} finally {
  $env:JAVA_HOME = $beforeJava
  $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot).TrimEnd('\') + '\'
  if (-not $resolvedFixture.StartsWith($resolvedTestRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove test files outside the workspace build-tools directory.' }
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
