[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Json,
  [switch]$PassThru,
  [switch]$AcceptLicenses,
  [switch]$Tablet,
  [ValidateSet('all', 'emulator', 'device')][string]$Target = 'all',
  [string]$JavaHome,
  [string]$AndroidHome,
  [string]$NdkHome
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/android-tools.ps1')
$selection = @{ JavaHome = $JavaHome; AndroidHome = $AndroidHome; NdkHome = $NdkHome; Target = $Target; Tablet = $Tablet }
if ($Check) {
  $toolchain = Get-RushLinkAndroidToolchain @selection
} else {
  $toolchain = Install-RushLinkAndroidToolchain @selection -AcceptLicenses:$AcceptLicenses
}
if ($Json) {
  $toolchain | ConvertTo-Json -Depth 5
} elseif ($PassThru) {
  $toolchain
} else {
  Write-Host "Android tools ready: $($toolchain.Ready)"
  Write-Host "Java: $($toolchain.JavaHome)"
  Write-Host "Android SDK: $($toolchain.AndroidHome)"
  Write-Host "NDK: $($toolchain.NdkHome)"
  foreach ($warning in $toolchain.Warnings) { Write-Host $warning }
  foreach ($missing in $toolchain.Missing) { Write-Host "Missing: $missing" }
  if (-not $toolchain.Ready) { Write-Host 'Run tools/setup-android.ps1 to prepare missing tools; add -AcceptLicenses only when accepting the Android SDK licenses.' }
}
if ($Check -and -not $toolchain.Ready) { exit 1 }
