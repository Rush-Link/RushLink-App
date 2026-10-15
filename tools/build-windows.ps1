[CmdletBinding()]
param([switch]$SkipFrontendBuild)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $repoRoot 'release-artifacts/build-tools'
$outputRoot = Join-Path $repoRoot 'release-artifacts/current-build/windows'
$previousCargoTarget = $env:CARGO_TARGET_DIR
function Invoke-WindowsCommand {
  param([string]$Executable, [string[]]$Arguments)
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE." }
}

Push-Location $repoRoot
try {
  $env:CARGO_TARGET_DIR = Join-Path $repoRoot 'src-tauri/target'
  if (-not $SkipFrontendBuild) {
    Invoke-WindowsCommand 'npx.cmd' @('playwright', 'install', 'chromium')
    Invoke-WindowsCommand 'npm.cmd' @('run', 'release:check')
  }
  if (-not (Test-Path -LiteralPath 'dist/index.html')) { throw 'The frontend is missing. Run npm run build:windows.' }
  $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
  $productName = (Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).productName
  if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid application version for installer staging.' }
  New-Item -ItemType Directory -Force -Path $toolRoot, $outputRoot | Out-Null
  $reuseConfig = Join-Path $toolRoot 'windows-reuse-frontend.json'
  [IO.File]::WriteAllText($reuseConfig, '{"build":{"beforeBuildCommand":""}}', [Text.UTF8Encoding]::new($false))
  Invoke-WindowsCommand 'npm.cmd' @('run', 'tauri', '--', 'build', '--ci', '--bundles', 'msi,nsis', '--config', $reuseConfig, '--', '--locked')
  $artifacts = foreach ($item in @(
    @{ folder = 'nsis'; name = "RushLink_${version}_x64-setup.exe"; sourceName = "${productName}_${version}_x64-setup.exe" },
    @{ folder = 'msi'; name = "RushLink_${version}_x64_en-US.msi"; sourceName = "${productName}_${version}_x64_en-US.msi" }
  )) {
    $source = Join-Path $repoRoot "src-tauri/target/release/bundle/$($item.folder)/$($item.sourceName)"
    if (-not (Test-Path -LiteralPath $source)) { throw "Expected Windows installer was not built: $source" }
    $destination = Join-Path $outputRoot $item.name
    Copy-Item -LiteralPath $source -Destination $destination -Force
    [pscustomobject]@{
      name = $item.name
      sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
      bytes = (Get-Item -LiteralPath $destination).Length
    }
  }
  $checksums = ($artifacts | ForEach-Object { "$($_.sha256)  $($_.name)" }) -join "`n"
  [IO.File]::WriteAllText((Join-Path $outputRoot 'SHA256SUMS-windows-x64.txt'), "$checksums`n", [Text.UTF8Encoding]::new($false))
  $evidence = [ordered]@{
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    version = $version
    source = 'Current working tree; preview build, not a release'
    platform = 'windows-x64'
    artifacts = @($artifacts)
  }
  [IO.File]::WriteAllText((Join-Path $outputRoot 'build-evidence.json'), ($evidence | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  Write-Host "Windows installers saved to $outputRoot"
} finally {
  $env:CARGO_TARGET_DIR = $previousCargoTarget
  Pop-Location
}
