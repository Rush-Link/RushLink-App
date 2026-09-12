$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/android-runtime.ps1')
$repoRoot = Split-Path -Parent $PSScriptRoot
$tablet = Get-RushLinkAndroidRuntime $repoRoot
$phone = Get-RushLinkAndroidRuntime $repoRoot -Profile phone
foreach ($property in @('Root','UserHome','AvdHome','AvdName','AvdPath','StatePath','LockPath','Serial')) {
  if ($tablet.$property -eq $phone.$property) { throw "Profiles share $property." }
}
$tabletPorts = @($tablet.AdbPort,$tablet.ConsolePort,$tablet.TransportPort,$tablet.DebugPort)
$phonePorts = @($phone.AdbPort,$phone.ConsolePort,$phone.TransportPort,$phone.DebugPort)
if (@($phonePorts | Where-Object { $_ -in $tabletPorts -or $_ -eq 5037 }).Count) { throw 'Phone ports overlap tablet or default ADB.' }
if ($tablet.AvdName -ne 'RushLink_Tablet_API_36' -or $tablet.AdbPort -ne 5038 -or $tablet.ConsolePort -ne 5580 -or $tablet.DebugPort -ne 9348) { throw 'Existing tablet compatibility changed.' }
foreach ($runtime in @($phone,$tablet)) {
  if ($runtime.ConsolePort % 2 -ne 0 -or $runtime.TransportPort -ne $runtime.ConsolePort + 1) { throw 'Invalid emulator port pair.' }
  $shortSide = [Math]::Min($runtime.Width,$runtime.Height) / ($runtime.Density / 160)
  if ($runtime.Profile -eq 'phone' -and ($shortSide -lt 390 -or $shortSide -gt 394 -or $runtime.Orientation -ne 'portrait')) { throw 'Incorrect phone screen profile.' }
  if ($runtime.Profile -eq 'tablet' -and ($shortSide -ne 800 -or $runtime.Orientation -ne 'landscape')) { throw 'Incorrect tablet screen profile.' }
}
Write-Host 'Phone/tablet isolation, compatibility and screen profiles passed.'
