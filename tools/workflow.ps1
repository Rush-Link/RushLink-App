[CmdletBinding()]
param(
  [ValidateSet('check', 'local', 'windows', 'android', 'tablet', 'stop-tablet', 'setup-android', 'macos', 'all', 'open')]
  [string]$Action = 'local',
  [switch]$SkipTests,
  [switch]$IncludeMacos,
  [switch]$AcceptLicenses,
  [switch]$Headless,
  [switch]$SmokeTest,
  [switch]$SkipBuild,
  [ValidateSet('all', 'emulator', 'device')]
  [string]$Target = 'all'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$mutex = $null
$ownsMutex = $false
function Invoke-WorkflowCommand {
  param([string]$Executable, [string[]]$Arguments)
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE." }
}
function Invoke-WorkflowScript {
  param([string]$Name, [string[]]$Arguments = @())
  Invoke-WorkflowCommand 'powershell.exe' (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot $Name)) + $Arguments)
}
function Ensure-Dependencies {
  foreach ($command in @('node.exe', 'npm.cmd', 'cargo.exe', 'rustup.exe')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is missing. Run npm run doctor after installing the Windows prerequisites in docs/WORKFLOW.md." }
  }
  & node.exe (Join-Path $PSScriptRoot 'workflow-artifacts.mjs') check-dependencies
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing the locked JavaScript dependencies...'
    Invoke-WorkflowCommand 'npm.cmd' @('ci')
  }
}
function Get-WindowsCppTools {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  }
}
function Build-Local {
  if (-not (Get-WindowsCppTools)) { throw 'Install the Visual Studio Desktop development with C++ workload, then retry.' }
  Ensure-Dependencies
  Invoke-WorkflowScript 'setup-android.ps1'
  Invoke-WorkflowCommand 'npx.cmd' @('playwright', 'install', 'chromium')
  Invoke-WorkflowCommand 'npm.cmd' @('run', 'release:check')
  if (-not $SkipTests) {
    Invoke-WorkflowCommand 'cargo.exe' @('test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml')
    Invoke-WorkflowCommand 'npm.cmd' @('run', 'test:coverage:all', '--', '--maxWorkers=4')
    Invoke-WorkflowCommand 'npm.cmd' @('run', 'test:e2e', '--', '--workers=2')
  }
  Invoke-WorkflowScript 'build-windows.ps1' @('-SkipFrontendBuild')
  Invoke-WorkflowScript 'build-android.ps1' @('-SkipFrontendBuild')
}

Push-Location $repoRoot
try {
  if ($env:OS -ne 'Windows_NT') { throw 'These local workflow commands run on Windows. Apple builds use GitHub Actions.' }
  if ($Action -in @('local', 'windows', 'android', 'tablet', 'all', 'setup-android')) {
    $hashProvider = [Security.Cryptography.SHA256]::Create()
    try { $workspaceHash = [BitConverter]::ToString($hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($repoRoot.ToLowerInvariant()))).Replace('-', '').Substring(0, 20) }
    finally { $hashProvider.Dispose() }
    $mutex = [Threading.Mutex]::new($false, "Local\RushLinkBuild_$workspaceHash")
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Another RushLink build is running for this workspace. Wait for it to finish.' }
  }
  switch ($Action) {
    'check' {
      $missing = @()
      foreach ($command in @('node.exe', 'npm.cmd', 'git.exe', 'cargo.exe', 'rustup.exe')) {
        $found = Get-Command $command -ErrorAction SilentlyContinue
        if ($found) { Write-Host "OK: $command" } else { Write-Host "MISSING: $command"; $missing += $command }
      }
      $cpp = Get-WindowsCppTools
      if ($cpp) { Write-Host 'OK: Microsoft C++ desktop build tools' }
      else { Write-Host 'MISSING: Microsoft C++ desktop workload'; $missing += 'C++ tools' }
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-android.ps1') -Check
      if ($LASTEXITCODE -ne 0) { $missing += 'Android toolchain (npm run android:setup)' }
      if ($IncludeMacos) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-macos.ps1') -Check
        if ($LASTEXITCODE -ne 0) { $missing += 'GitHub access' }
      }
      if ($missing.Count) { throw "Setup needed: $($missing -join ', '). See docs/WORKFLOW.md." }
      Write-Host 'Local toolchain ready. Use npm run macos:check to also check GitHub access.'
    }
    'local' { Build-Local }
    'all' {
      Build-Local
      Invoke-WorkflowCommand 'node.exe' @((Join-Path $PSScriptRoot 'workflow-artifacts.mjs'), 'index')
      Invoke-WorkflowScript 'build-macos.ps1'
    }
    'windows' {
      if (-not (Get-WindowsCppTools)) { throw 'Install the Visual Studio Desktop development with C++ workload, then retry.' }
      Ensure-Dependencies
      Invoke-WorkflowScript 'build-windows.ps1'
    }
    'android' { Ensure-Dependencies; Invoke-WorkflowScript 'build-android.ps1' @('-Target', $Target) }
    'tablet' {
      Ensure-Dependencies
      $tabletArguments = @()
      if ($Headless) { $tabletArguments += '-Headless' }
      if ($SmokeTest) { $tabletArguments += '-SmokeTest' }
      if ($SkipBuild) { $tabletArguments += '-SkipBuild' }
      Invoke-WorkflowScript 'run-android.ps1' $tabletArguments
    }
    'stop-tablet' { Invoke-WorkflowScript 'run-android.ps1' @('-Stop') }
    'setup-android' {
      $setupArguments = @()
      if ($AcceptLicenses) { $setupArguments += '-AcceptLicenses' }
      Invoke-WorkflowScript 'setup-android.ps1' $setupArguments
    }
    'macos' { Invoke-WorkflowScript 'build-macos.ps1' }
    'open' {
      Invoke-WorkflowCommand 'node.exe' @((Join-Path $PSScriptRoot 'workflow-artifacts.mjs'), 'index')
      Start-Process -FilePath 'explorer.exe' -ArgumentList @((Join-Path $repoRoot 'release-artifacts/current-build')) | Out-Null
    }
  }
  if ($Action -in @('local', 'windows', 'android', 'tablet', 'all', 'macos')) {
    Invoke-WorkflowCommand 'node.exe' @((Join-Path $PSScriptRoot 'workflow-artifacts.mjs'), 'index')
    Write-Host 'Done. npm run builds:open opens the installers. No release was published.'
  }
} catch {
  Write-Error -Message $_.Exception.Message -ErrorAction Continue
  exit 1
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
  Pop-Location
}
