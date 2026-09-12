<# Offline source-snapshot and artifact validation; GitHub requests and pushes are mocked. #>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$sourceFile = Join-Path $workspace 'tools/build-macos.ps1'
$sourceText = [IO.File]::ReadAllText($sourceFile)
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourceFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Source parser failed.' }
foreach ($name in @('Test-ExcludedPath', 'Test-EligibleNewSource', 'Write-JsonFile', 'Receive-CompletedArtifacts', 'Assert-PrivateRepository', 'Invoke-AuthenticatedGit')) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $false)
  Invoke-Expression $definition.Extent.Text
}
$outputRoot = Join-Path $workspace ('release-artifacts/macos-fixtures-' + [Guid]::NewGuid().ToString('N'))
$utf8 = [Text.UTF8Encoding]::new($false)
New-Item -ItemType Directory -Path $outputRoot | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$assertions = 0
function Assert($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $script:assertions++
}
function Assert-Throws([scriptblock]$Action, [string]$Message) {
  $failed = $false
  try { & $Action | Out-Null } catch { $failed = $true }
  Assert $failed $Message
}
$expectedRepository = 'Rush-Link/RushLink-App'
$fixtureRepository = [pscustomobject]@{ full_name = $expectedRepository; private = $true }
function Get-GitHub { $script:fixtureRepository }
Assert ((Assert-PrivateRepository).private -eq $true) 'Expected private repository was rejected.'
$fixtureRepository.private = $false
Assert-Throws { Assert-PrivateRepository } 'Public repository was accepted.'
$fixtureRepository.private = $true
$fixtureRepository.full_name = 'someone/another-repository'
Assert-Throws { Assert-PrivateRepository } 'Wrong repository was accepted.'

$authKeys = @('GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_TRACE','GIT_TRACE_CURL','GIT_CURL_VERBOSE','GIT_TRACE_REDACT')
$authBefore = @{}
foreach ($key in $authKeys) { $authBefore[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$headers = @{ Authorization = 'Bearer fixture-token' }
function Invoke-Git {
  param([string[]]$Arguments, [switch]$AllowFailure)
  Assert ($env:GIT_CONFIG_KEY_0 -eq 'http.https://github.com/.extraheader') 'Git authentication was not scoped to GitHub.'
  Assert ($env:GIT_TRACE_CURL -eq '0' -and $env:GIT_CURL_VERBOSE -eq '0') 'Git credential tracing was not disabled.'
  Assert (($Arguments -join ' ') -notmatch 'fixture-token|AUTHORIZATION') 'Credential entered Git command arguments.'
  throw 'EXPECTED_GIT_FAILURE'
}
Assert-Throws { Invoke-AuthenticatedGit @('ls-remote') } 'Expected Git fixture failure did not propagate.'
foreach ($key in $authKeys) { Assert ([Environment]::GetEnvironmentVariable($key, 'Process') -ceq $authBefore[$key]) "Git auth environment was not restored: $key" }
foreach ($path in @('src/pages/new.tsx','tools/build-new.ps1','tools/lib/test.mjs','docs/WORKFLOW.md','.vscode/tasks.json','src-tauri/gen/android/gradlew','src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar','src-tauri/icons/icon.png','public/new.svg','site/new.mjs','e2e/new.spec.ts','brand/master/new.svg')) {
  Assert (Test-EligibleNewSource $path) "Expected source eligibility: $path"
}
foreach ($path in @('release-artifacts/test.dmg','src/model.nam','src/.env','tools/auth.pem','src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/test.so','src-tauri/gen/android/app/build/output.apk','src-tauri/gen/android/tauri.settings.gradle','src-tauri/target/build/file','src/.codex/settings.json')) {
  Assert (-not (Test-EligibleNewSource $path)) "Expected exclusion: $path"
}
function Get-GitHub([string]$Path) {
  [pscustomobject]@{ artifacts = @([pscustomobject]@{ id = 88; name = 'RushLink-macos-arm64-7'; expired = $false }) }
}
$downloads = 0
function Save-GitHubDownload([string]$ApiPath, [string]$Destination) {
  $script:downloads++
  Copy-Item -LiteralPath $script:fixtureArchive -Destination $Destination
}
function New-FixtureArchive($Entries) {
  $script:fixtureArchive = Join-Path $outputRoot ([Guid]::NewGuid().ToString('N') + '.zip')
  $zip = [IO.Compression.ZipFile]::Open($script:fixtureArchive, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($entry in $Entries) {
      $writer = [IO.StreamWriter]::new($zip.CreateEntry($entry.Name).Open(), $utf8)
      try { $writer.Write($entry.Text) } finally { $writer.Dispose() }
    }
  } finally { $zip.Dispose() }
}
function New-TestDirectory {
  $directory = Join-Path $outputRoot ([Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $directory | Out-Null
  $directory
}
$payload = 'fixture DMG bytes'
$hasher = [Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes($payload)))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
$dmgName = 'RushLink_0.1.1_aarch64.dmg'
$sumName = 'SHA256SUMS-macos-arm64.txt'
$goodEntries = @(@{Name=$dmgName;Text=$payload},@{Name=$sumName;Text="$hash  $dmgName`n"})
$run = [pscustomobject]@{ id=123; run_number=7; head_sha=('a' * 40); html_url='https://github.com/Rush-Link/RushLink-App/actions/runs/123' }
$jobs = @([pscustomobject]@{name='macos (macos-15, aarch64-apple-darwin, arm64)';conclusion='success'})
New-FixtureArchive $goodEntries
$directory = New-TestDirectory
$records = @(Receive-CompletedArtifacts $run $jobs '0.1.1' $directory)
Assert ($records.Count -eq 1 -and $records[0].sha256 -eq $hash) 'Valid artifact did not verify.'
$beforeDownloads = $downloads
$resumed = @(Receive-CompletedArtifacts $run $jobs '0.1.1' $directory)
Assert ($resumed.Count -eq 1 -and $downloads -eq $beforeDownloads) 'Resume redownloaded or lost the saved record.'
[IO.File]::WriteAllText($records[0].path, 'tampered', $utf8)
Assert-Throws { Receive-CompletedArtifacts $run $jobs '0.1.1' $directory } 'Tampered saved installer was accepted.'
foreach ($entries in @(
  @(@{Name='../escape.dmg';Text=$payload},@{Name=$sumName;Text="$hash  $dmgName"}),
  @(@{Name=$dmgName;Text=$payload},@{Name=$sumName;Text="$hash  $dmgName"},@{Name='private.txt';Text='extra'}),
  @(@{Name='RushLink_0.1.0_aarch64.dmg';Text=$payload},@{Name=$sumName;Text="$hash  $dmgName"}),
  @(@{Name=$dmgName;Text=$payload},@{Name=$sumName;Text=(('0' * 64) + '  ' + $dmgName)}),
  @(@{Name=$dmgName;Text=$payload},@{Name=$sumName;Text="$hash  ../escape.dmg"})
)) {
  New-FixtureArchive $entries
  $directory = New-TestDirectory
  Assert-Throws { Receive-CompletedArtifacts $run $jobs '0.1.1' $directory } 'Invalid archive/checksum was accepted.'
  Assert (-not (Test-Path -LiteralPath (Join-Path $directory "macos-arm64/$dmgName"))) 'Invalid archive published an installer.'
}

# Exercise actual Git snapshot preparation in an isolated fixture repository.
# Both GitHub access and the push boundary are replaced: no network can occur.
$fixtureRepo = Join-Path $outputRoot 'checkout'
New-Item -ItemType Directory -Path "$fixtureRepo/tools","$fixtureRepo/.github/workflows","$fixtureRepo/src" -Force | Out-Null
$main = $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] } | Select-Object -Last 1
$mocks = @'
function Get-GitHubToken { 'fixture-token' }
function Get-GitHub([string]$Path) {
  if (-not $Path) { return [pscustomobject]@{ full_name='Rush-Link/RushLink-App'; private=$true; permissions=[pscustomobject]@{push=$true} } }
  if ($Path -eq '/actions/workflows/macos-build.yml') { return [pscustomobject]@{state='active'} }
  throw 'Unexpected fixture API request'
}
function Invoke-AuthenticatedGit([string[]]$Arguments, [switch]$AllowFailure) {
  if ($Arguments -contains 'ls-remote') { return [pscustomobject]@{Code=2;Lines=@()} }
  if ($Arguments -contains 'push') { throw 'EXPECTED_PUSH_BOUNDARY' }
  throw 'Unexpected fixture Git operation'
}
'@
[IO.File]::WriteAllText("$fixtureRepo/tools/build-macos.ps1", $sourceText.Substring(0,$main.Extent.StartOffset) + $mocks + "`n" + $main.Extent.Text, $utf8)
Copy-Item -LiteralPath "$workspace/.github/workflows/macos-build.yml" -Destination "$fixtureRepo/.github/workflows/macos-build.yml"
[IO.File]::WriteAllText("$fixtureRepo/.gitignore", "release-artifacts/`n*.nam`n", $utf8)
[IO.File]::WriteAllText("$fixtureRepo/package.json", '{"version":"0.1.1"}', $utf8)
[IO.File]::WriteAllText("$fixtureRepo/README.md", 'base', $utf8)
git -C $fixtureRepo init -q
git -C $fixtureRepo config user.name 'Fixture'
git -C $fixtureRepo config user.email 'fixture@example.invalid'
git -C $fixtureRepo remote add origin https://github.com/Rush-Link/RushLink-App.git
git -C $fixtureRepo add .
git -C $fixtureRepo commit -q -m fixture
[IO.File]::WriteAllText("$fixtureRepo/README.md", 'staged', $utf8)
git -C $fixtureRepo add README.md
[IO.File]::WriteAllText("$fixtureRepo/README.md", 'working', $utf8)
[IO.File]::WriteAllText("$fixtureRepo/src/new.tsx", 'export const fixture = true;', $utf8)
[IO.File]::WriteAllText("$fixtureRepo/src/private.nam", 'private capture', $utf8)
$originalHead = (git -C $fixtureRepo rev-parse HEAD).Trim()
$originalIndex = (Get-FileHash -LiteralPath "$fixtureRepo/.git/index").Hash
$environmentBefore = @{}
foreach ($key in @('GIT_OPTIONAL_LOCKS','GIT_TERMINAL_PROMPT','GCM_INTERACTIVE','GIT_INDEX_FILE')) { $environmentBefore[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
$stoppedBeforePush = $false
try { & "$fixtureRepo/tools/build-macos.ps1" -NoWait } catch { Write-Host ('Fixture stop: ' + $_.Exception.Message); $stoppedBeforePush = $_.Exception.Message -match 'EXPECTED_PUSH_BOUNDARY' }
Assert $stoppedBeforePush 'Snapshot preparation failed before the mocked push boundary.'
Assert ((git -C $fixtureRepo rev-parse HEAD).Trim() -eq $originalHead) 'Snapshot moved the local branch.'
Assert ((Get-FileHash -LiteralPath "$fixtureRepo/.git/index").Hash -eq $originalIndex) 'Snapshot changed the original index bytes.'
Assert ([IO.File]::ReadAllText("$fixtureRepo/README.md") -eq 'working') 'Snapshot changed working content.'
Assert (@(Get-ChildItem -LiteralPath "$fixtureRepo/release-artifacts/current-build" -Filter '*.index*').Count -eq 0) 'Temporary index was not cleaned.'
$snapshotFile = Get-ChildItem -LiteralPath "$fixtureRepo/release-artifacts/current-build" -Filter 'snapshot-*.json' | Select-Object -First 1
$snapshot = Get-Content -LiteralPath $snapshotFile.FullName -Raw | ConvertFrom-Json
$treePaths = @(git -C $fixtureRepo ls-tree -r --name-only $snapshot.tree_sha)
Assert ($treePaths -contains 'src/new.tsx') 'New source was omitted.'
Assert ($treePaths -notcontains 'src/private.nam') 'Private capture entered the snapshot.'
Assert (((git -C $fixtureRepo show ($snapshot.tree_sha + ':README.md')) -join "`n") -eq 'working') 'Snapshot used staged contents instead of the current working source.'
foreach ($key in $environmentBefore.Keys) { Assert ([Environment]::GetEnvironmentVariable($key,'Process') -ceq $environmentBefore[$key]) "Environment was not restored: $key" }
Write-Output "PASSED: $assertions offline macOS automation assertions."
