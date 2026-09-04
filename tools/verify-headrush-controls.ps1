param(
  [string]$DeviceAddress = "192.168.1.129",
  [string]$DeviceHost = "headrushflexprime.local"
)

$ErrorActionPreference = "Stop"
$base = "http://$DeviceAddress/api/v1"
$headers = @{ Host = $DeviceHost }

function Get-DeviceJson([string]$Uri) {
  Invoke-RestMethod -Method Get -Uri $Uri -Headers $headers -TimeoutSec 30
}

function Set-DeviceProperties([string]$ObjectPath, [hashtable]$Properties) {
  $body = $Properties | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Put -Uri "$base/object-properties$ObjectPath" -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 30 | Out-Null
}

$tree = Get-DeviceJson "$base/subtree"
$chain = $tree.PSObject.Properties["/Evil/Engine/Patch/Chain"].Value
$blocks = $tree.PSObject.Properties["/Evil/API/Blocks"].Value.value.ModuleTypes
$paths = [System.Collections.Generic.List[string]]::new()

foreach ($slot in 1..14) {
  $moduleType = [int]$chain.value."ModuleType$slot"
  if ($moduleType -le 0) { continue }
  $name = [string]$blocks[$moduleType]
  $path = "/Evil/Engine/Patch/$($name.Replace(' ', '_'))"
  if (-not $paths.Contains($path)) { $paths.Add($path) }
}
$paths.Add("/Evil/Engine/GlobalEQMain")
$paths.Add("/Evil/Engine/GlobalEQAmp")

$tested = 0
$failures = [System.Collections.Generic.List[string]]::new()
foreach ($path in $paths) {
  $object = $tree.PSObject.Properties[$path].Value
  if ($null -eq $object) { $failures.Add("$path was not present in the reflected subtree"); continue }
  $disabled = @($object.value.disabled)
  $original = @{}
  $probe = @{}
  foreach ($property in $object.meta.properties.PSObject.Properties) {
    $name = $property.Name
    $meta = $property.Value
    $valueProperty = $object.value.PSObject.Properties[$name]
    if ($meta.type -ne "number" -or $meta.readOnly -eq $true -or $disabled -contains $name -or $null -eq $valueProperty) { continue }
    $raw = [double]$valueProperty.Value
    $original[$name] = $raw
    $probe[$name] = if ($raw -ge 0.5) { [Math]::Max(0, $raw - 0.001) } else { [Math]::Min(1, $raw + 0.001) }
  }
  if ($probe.Count -eq 0) { Write-Output "SKIP $path (no numeric controls)"; continue }

  $wasWritten = $false
  try {
    Set-DeviceProperties $path $probe
    $wasWritten = $true
    $readback = Get-DeviceJson "$base/object-properties$path"
    foreach ($name in $probe.Keys) {
      $tested += 1
      $actual = [double]$readback.$name
      if ([Math]::Abs($actual - [double]$probe[$name]) -gt 0.0000001) {
        $failures.Add("$path.$name ignored probe $($probe[$name]); read $actual")
      }
    }
    Write-Output "PASS $path ($($probe.Count) numeric controls accepted)"
  } catch {
    $failures.Add("$path request failed: $($_.Exception.Message)")
  } finally {
    if ($wasWritten) {
      try {
        Set-DeviceProperties $path $original
        $restored = Get-DeviceJson "$base/object-properties$path"
        foreach ($name in $original.Keys) {
          if ([Math]::Abs([double]$restored.$name - [double]$original[$name]) -gt 0.0000001) {
            $failures.Add("$path.$name did not restore to $($original[$name]); read $($restored.$name)")
          }
        }
      } catch {
        $failures.Add("$path restore failed: $($_.Exception.Message)")
      }
    }
  }
}

Write-Output "TESTED=$tested FAILURES=$($failures.Count)"
$failures | ForEach-Object { Write-Output "FAIL $_" }
if ($failures.Count -gt 0) { exit 1 }
