<#
.SYNOPSIS
Builds Apple Silicon and Intel DMGs in the private GitHub repository.
.DESCRIPTION
Creates an isolated source snapshot and pushes a new build/macos-* branch, then
waits for Actions and downloads verified installers. The current branch, working
tree and index are preserved. No tags, releases or merges are created.
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-macos.ps1 -Check
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-macos.ps1
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-macos.ps1 -DownloadRun 34693833500
#>
[CmdletBinding(DefaultParameterSetName = 'Build')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Check')][switch]$Check,
  [Parameter(ParameterSetName = 'Build')][switch]$NoWait,
  [Parameter(Mandatory, ParameterSetName = 'Download')][ValidateRange(1, [long]::MaxValue)][long]$DownloadRun,
  [ValidateRange(5, 60)][int]$PollSeconds = 30,
  [ValidateRange(5, 180)][int]$TimeoutMinutes = 75
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$expectedRepository = 'Rush-Link/RushLink-App'
$apiRoot = "https://api.github.com/repos/$expectedRepository"
$outputRoot = Join-Path $repoRoot 'release-artifacts/current-build'
$gitCommand = Get-Command git -ErrorAction Stop
$previousEnvironment = @{}
$headers = $null
$temporaryIndex = $null
$utf8 = [Text.UTF8Encoding]::new($false)

function Invoke-Git {
  param([string[]]$Arguments, [switch]$AllowFailure)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $records = @(& $gitCommand.Source -C $repoRoot -c core.safecrlf=false -c core.quotePath=false @Arguments 2>&1)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($code -ne 0 -and -not $AllowFailure) { throw "git $($Arguments[0]) failed with exit code $code." }
  [pscustomobject]@{ Code = $code; Lines = @($records | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() }) }
}

function Get-GitValue {
  param([string[]]$Arguments)
  ((Invoke-Git $Arguments).Lines -join "`n").Trim()
}

function Test-ExcludedPath {
  param([string]$Path)
  $Path -match '(?i)(^|/)(release-artifacts|node_modules|dist|target|build|profiles?|captures?|credentials?|\.git|\.codex|\.agents|\.gradle|\.kotlin|\.tauri)(/|$)' -or
    $Path -match '(?i)^reference/headrush/(raw|live)/' -or
    $Path -match '(?i)(^|/)(local\.properties|key\.properties|keystore\.properties|tauri\.settings\.gradle)$' -or
    ($Path -match '(?i)(^|/)\.env($|\.)' -and $Path -notmatch '(?i)(^|/)\.env\.example$') -or
    $Path -match '(?i)\.(nam|wav|aiff?|flac|mp3|m4a|hrig|ampclone|superclone|dmg|appimage|deb|msi|exe|apk|aab|so|dll|dylib|p12|pfx|pem|key|jks|keystore|zip|db|sqlite3?)$'
}

function Test-EligibleNewSource {
  param([string]$Path)
  if (Test-ExcludedPath $Path) { return $false }
  if ($Path -match '^src/.+\.(ts|tsx|js|jsx|json|css|svg|png|webp|jpe?g|woff2?|ttf)$') { return $true }
  if ($Path -match '^(public|site)/.+\.(html|js|mjs|json|css|svg|png|webp|avif|gif|jpe?g|ico|woff2?|ttf|txt|md)$|^site/\.nojekyll$') { return $true }
  if ($Path -match '^e2e/.+\.(ts|tsx|js|mjs|json|css|html|svg|png|webp|txt|snap)$') { return $true }
  if ($Path -match '^brand/.+\.(svg|png|webp|jpe?g|ico|icns|xml|md)$') { return $true }
  if ($Path -match '^tools/[^/]+\.(ps1|mjs|js)$|^tools/lib/.+\.(ps1|mjs|js|json)$|^docs/[^/]+\.md$') { return $true }
  if ($Path -match '^\.vscode/(tasks|extensions)\.json$|^\.github/workflows/[^/]+\.ya?ml$') { return $true }
  if ($Path -match '^(package(-lock)?\.json|index\.html|(vite|vitest|playwright)(\.[^/]+)?\.config\.ts|tsconfig(\.[^/]+)?\.json)$') { return $true }
  if ($Path -match '^src-tauri/(src/.+\.rs|build\.rs|Cargo\.(toml|lock)|tauri(\.[^/]+)?\.conf\.json|capabilities/[^/]+\.json|icons/.+\.(png|svg|ico|icns))$') { return $true }
  if ($Path -match '^src-tauri/gen/android/') {
    return $Path -match '/(\.gitignore|\.editorconfig|gradlew(\.bat)?|gradle\.properties|gradle-wrapper\.properties|proguard-rules\.pro)$' -or
      $Path -match '\.(gradle|gradle\.kts|kt)$' -or
      $Path -eq 'src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar' -or
      $Path -match '/src/main/(AndroidManifest\.xml|res/.+\.(xml|png|webp))$'
  }
  return $false
}

function Get-SourceManifest {
  $tracked = @((Invoke-Git @('ls-files')).Lines)
  $forbidden = @($tracked | Where-Object { Test-ExcludedPath $_ })
  if ($forbidden.Count) { throw ('Tracked private/generated files cannot enter the build snapshot: ' + ($forbidden -join ', ')) }
  $untracked = @((Invoke-Git @('ls-files', '--others', '--exclude-standard')).Lines)
  $eligible = @($untracked | Where-Object { Test-EligibleNewSource $_ })
  $unsupportedInputs = @($untracked | Where-Object {
    $_ -match '^(src/|src-tauri/|tools/|docs/|public/|site/|e2e/|brand/|\.github/|\.vscode/)' -and
      -not (Test-EligibleNewSource $_)
  })
  if ($unsupportedInputs.Count) {
    throw ('Untracked build inputs are outside the source allowlist. Review and explicitly stage intended files before building: ' + ($unsupportedInputs -join ', '))
  }
  [pscustomobject]@{ Tracked = $tracked; NewSource = $eligible; ExcludedUntrackedCount = $untracked.Count - $eligible.Count }
}

function Get-GitHubToken {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($gh) {
      $candidate = @(& $gh.Source auth token --hostname github.com 2>$null)
      if ($LASTEXITCODE -eq 0 -and $candidate.Count -eq 1 -and $candidate[0]) { return $candidate[0].ToString().Trim() }
    }
    $credentialLines = @((@('protocol=https', 'host=github.com', '', '') -join "`n") | & $gitCommand.Source -C $repoRoot credential fill 2>$null)
    if ($LASTEXITCODE -eq 0) {
      $passwordLine = $credentialLines | Where-Object { $_ -is [string] -and $_.StartsWith('password=') } | Select-Object -First 1
      if ($passwordLine) { return $passwordLine.Substring(9) }
    }
  } finally { $ErrorActionPreference = $previousPreference }
  throw 'GitHub authentication is unavailable. Sign in with gh auth login or Git Credential Manager, then retry.'
}

function Get-GitHub {
  param([string]$Path)
  if ($Path -and (-not $Path.StartsWith('/') -or $Path.StartsWith('//'))) { throw 'Invalid repository API path.' }
  try { Invoke-RestMethod -Uri ($apiRoot + $Path) -Headers $headers -TimeoutSec 60 }
  catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'network error' }
    throw "GitHub request failed ($status) for $Path. Check repository access or retry later."
  }
}

function Invoke-AuthenticatedGit {
  param([string[]]$Arguments, [switch]$AllowFailure)
  # Use the same in-memory credential as the API, including when gh supplied it.
  # Environment-only Git config keeps the credential out of command arguments,
  # repository config and the user's credential stores.
  $settings = @{
    GIT_CONFIG_COUNT = '1'
    GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
    GIT_CONFIG_VALUE_0 = 'AUTHORIZATION: basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('x-access-token:' + $headers.Authorization.Substring(7)))
    GIT_TRACE = '0'
    GIT_TRACE_CURL = '0'
    GIT_CURL_VERBOSE = '0'
    GIT_TRACE_REDACT = '1'
  }
  $saved = @{}
  try {
    foreach ($key in $settings.Keys) {
      $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
      [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
    }
    Invoke-Git $Arguments -AllowFailure:$AllowFailure
  } finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
  }
}

function Write-JsonFile {
  param([string]$Path, $Value)
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 12), $utf8)
}

function Assert-PrivateRepository {
  $repository = Get-GitHub ''
  if ($repository.full_name -cne $expectedRepository -or $repository.private -ne $true) {
    throw "This command only builds the private $expectedRepository repository."
  }
  $repository
}

function Get-Run {
  param([long]$Id)
  $run = Get-GitHub "/actions/runs/$Id"
  if ($run.path -ne '.github/workflows/macos-build.yml' -or $run.head_repository.full_name -cne $expectedRepository -or $run.head_sha -notmatch '^[0-9a-f]{40}$') {
    throw 'The requested run is not a macOS build from the expected private repository.'
  }
  $run
}

function Save-GitHubDownload {
  param([string]$ApiPath, [string]$Destination)
  $resolved = [IO.Path]::GetFullPath($Destination)
  if (-not $resolved.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Download destination escaped the build directory.' }
  $request = [Net.HttpWebRequest]::Create($apiRoot + $ApiPath)
  $request.Method = 'GET'
  $request.AllowAutoRedirect = $false
  $request.Accept = 'application/vnd.github+json'
  $request.UserAgent = 'RushLink-private-build'
  $request.Headers.Add('Authorization', $headers.Authorization)
  $request.Headers.Add('X-GitHub-Api-Version', '2022-11-28')
  try {
    $response = $request.GetResponse()
    try { $location = [Uri]$response.Headers['Location'] } finally { $response.Close() }
    if (-not $location.IsAbsoluteUri -or $location.Scheme -ne 'https') { throw 'Expected an HTTPS artifact redirect.' }
    # Never forward the GitHub credential to the signed artifact host.
    Invoke-WebRequest -UseBasicParsing -Uri $location -OutFile $resolved -TimeoutSec 180
  } catch { throw "Could not download GitHub artifact into $resolved. Retry with -DownloadRun." }
}

function Get-SourceVersion {
  param([string]$Sha)
  $packageFile = Get-GitHub "/contents/package.json?ref=$Sha"
  $package = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($packageFile.content)) | ConvertFrom-Json
  if ($package.version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.+-]+)?$') { throw 'Unexpected package version in build source.' }
  [string]$package.version
}

function Receive-CompletedArtifacts {
  param($Run, $Jobs, [string]$Version, [string]$RunDirectory)
  $manifestPath = Join-Path $RunDirectory 'macos-verified.json'
  $verified = @()
  if (Test-Path -LiteralPath $manifestPath) { $verified = @(Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json | ForEach-Object { $_ }) }
  foreach ($record in $verified) {
    if ($record.run_id -ne $Run.id -or $record.source_sha -ne $Run.head_sha) { throw 'Existing artifact evidence belongs to another run.' }
    if (-not (Test-Path -LiteralPath $record.path) -or (Get-FileHash -LiteralPath $record.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.sha256) { throw 'A previously downloaded installer no longer matches its checksum.' }
  }
  $artifacts = Get-GitHub "/actions/runs/$($Run.id)/artifacts"
  foreach ($arch in @('arm64', 'x86_64')) {
    $successfulJob = @($Jobs | Where-Object { $_.name.EndsWith(", $arch)") -and $_.conclusion -eq 'success' })
    if ($successfulJob.Count -ne 1 -or @($verified | Where-Object arch -eq $arch).Count) { continue }
    $artifact = @($artifacts.artifacts | Where-Object { $_.name -eq "RushLink-macos-$arch-$($Run.run_number)" -and -not $_.expired })
    if ($artifact.Count -ne 1) { throw "Expected exactly one unexpired $arch artifact for run $($Run.id)." }
    $dmgName = if ($arch -eq 'arm64') { "RushLink_${Version}_aarch64.dmg" } else { "RushLink_${Version}_x64.dmg" }
    $checksumName = "SHA256SUMS-macos-$arch.txt"
    $archivePath = Join-Path $RunDirectory ("artifact-$($artifact[0].id)-" + [Guid]::NewGuid().ToString('N') + '.zip')
    Save-GitHubDownload "/actions/artifacts/$($artifact[0].id)/zip" $archivePath
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
      $entries = @($archive.Entries)
      if ($entries.Count -ne 2 -or @($entries | Where-Object FullName -CEQ $dmgName).Count -ne 1 -or @($entries | Where-Object FullName -CEQ $checksumName).Count -ne 1) { throw 'Artifact ZIP must contain only the expected DMG and checksum file.' }
      $reader = [IO.StreamReader]::new($archive.GetEntry($checksumName).Open())
      try { $checksum = $reader.ReadToEnd().Trim() } finally { $reader.Dispose() }
      if ($checksum -cnotmatch '^(?<hash>[a-fA-F0-9]{64}) [ *](?<name>[^/\\\r\n]+)$' -or $Matches.name -cne $dmgName) { throw 'Invalid installer checksum record.' }
      $expectedHash = $Matches.hash.ToLowerInvariant()
      $architectureDirectory = Join-Path $RunDirectory "macos-$arch"
      New-Item -ItemType Directory -Force -Path $architectureDirectory | Out-Null
      $destination = Join-Path $architectureDirectory $dmgName
      $temporaryInstaller = Join-Path $architectureDirectory ([Guid]::NewGuid().ToString('N') + '.dmg')
      [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry($dmgName), $temporaryInstaller)
      $actualHash = (Get-FileHash -LiteralPath $temporaryInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualHash -cne $expectedHash) { throw 'Downloaded DMG checksum does not match.' }
      if (Test-Path -LiteralPath $destination) {
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $actualHash) { throw 'Refusing to replace a different installer in this run directory.' }
        Remove-Item -LiteralPath $temporaryInstaller
      } else { Move-Item -LiteralPath $temporaryInstaller -Destination $destination }
      [IO.File]::WriteAllText((Join-Path $architectureDirectory $checksumName), $checksum + "`n", $utf8)
      $record = [pscustomobject]@{ arch = $arch; name = $dmgName; path = $destination; bytes = (Get-Item -LiteralPath $destination).Length; sha256 = $actualHash; artifact_id = $artifact[0].id; artifact_url = "$($Run.html_url)/artifacts/$($artifact[0].id)"; run_id = $Run.id; run_url = $Run.html_url; source_sha = $Run.head_sha; verified_at = [DateTime]::UtcNow.ToString('o') }
      $verified += $record
      Write-JsonFile $manifestPath @($verified)
      Write-Host "Verified $arch DMG: $destination"
      Write-Host "SHA256 $actualHash"
    } finally { $archive.Dispose() }
  }
  $verified
}

try {
  foreach ($setting in @{ GIT_OPTIONAL_LOCKS = '0'; GIT_TERMINAL_PROMPT = '0'; GCM_INTERACTIVE = 'Never' }.GetEnumerator()) {
    $previousEnvironment[$setting.Key] = [Environment]::GetEnvironmentVariable($setting.Key, 'Process')
    [Environment]::SetEnvironmentVariable($setting.Key, $setting.Value, 'Process')
  }
  if ([IO.Path]::GetFullPath((Get-GitValue @('rev-parse', '--show-toplevel'))) -ne $repoRoot) { throw 'Run this script from the RushLink checkout.' }
  $remote = Get-GitValue @('remote', 'get-url', 'origin')
  if ($remote -cnotmatch '^(https://github\.com/Rush-Link/RushLink-App(\.git)?|git@github\.com:Rush-Link/RushLink-App\.git)$') { throw 'origin must point directly to the expected Rush-Link/RushLink-App repository.' }
  if ((Invoke-Git @('ls-files', '-u')).Lines.Count) { throw 'Resolve merge conflicts before building a source snapshot.' }
  if ((Invoke-Git @('check-ignore', '--quiet', 'release-artifacts/current-build/macos/.probe') -AllowFailure).Code -ne 0) { throw 'The artifact directory must be ignored by Git.' }
  $sourceManifest = Get-SourceManifest
  $token = Get-GitHubToken
  $headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'RushLink-private-build' }
  $token = $null
  $repository = Assert-PrivateRepository
  $workflow = Get-GitHub '/actions/workflows/macos-build.yml'
  if ($workflow.state -ne 'active') { throw 'The macOS Actions workflow is not active.' }
  if (-not $DownloadRun -and $repository.permissions.push -ne $true) { throw 'GitHub push access is required to create a private build branch.' }
  $workflowText = Get-Content -LiteralPath (Join-Path $repoRoot '.github/workflows/macos-build.yml') -Raw
  if ($workflowText -notmatch 'build/macos-\*' -or $workflowText -notmatch 'github\.event\.repository\.private == true' -or $workflowText -notmatch 'contents: read' -or $workflowText -match 'contents: write|tauri-apps/tauri-action|releaseDraft:|gh release') { throw 'The local macOS workflow must remain a private artifact-only build.' }
  if ($Check) {
    Write-Host "Ready: private $expectedRepository; macOS workflow active; GitHub authenticated."
    Write-Host "$($sourceManifest.Tracked.Count) tracked files and $($sourceManifest.NewSource.Count) eligible new source files will be considered."
    $sourceManifest.NewSource | ForEach-Object { Write-Host "New source: $_" }
    Write-Host 'Preflight only: no files, commits, branches or workflow runs were created.'
    return
  }
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if ($DownloadRun) {
    $run = Get-Run $DownloadRun
  } else {
    $base = Get-GitValue @('rev-parse', 'HEAD')
    $originalBranch = Get-GitValue @('rev-parse', '--abbrev-ref', 'HEAD')
    $indexPath = Get-GitValue @('rev-parse', '--git-path', 'index')
    if (-not [IO.Path]::IsPathRooted($indexPath)) { $indexPath = Join-Path $repoRoot $indexPath }
    $indexHash = (Get-FileHash -LiteralPath $indexPath -Algorithm SHA256).Hash
    $temporaryIndex = Join-Path $outputRoot ([Guid]::NewGuid().ToString('N') + '.index')
    Copy-Item -LiteralPath $indexPath -Destination $temporaryIndex
    $previousIndex = $env:GIT_INDEX_FILE
    try {
      $env:GIT_INDEX_FILE = $temporaryIndex
      Invoke-Git @('add', '-u', '--', '.') | Out-Null
      foreach ($newSource in $sourceManifest.NewSource) { Invoke-Git @('add', '--', $newSource) | Out-Null }
      $stagedFiles = @((Invoke-Git @('ls-files')).Lines)
      if (@($stagedFiles | Where-Object { Test-ExcludedPath $_ }).Count) { throw 'Snapshot contains excluded private/generated files.' }
      $credentialScan = Invoke-Git @('grep', '--cached', '-l', '-I', '-E', 'github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY', '--', '.') -AllowFailure
      if ($credentialScan.Code -gt 1 -or $credentialScan.Lines.Count) { throw 'Snapshot credential scan failed; inspect staged source without printing credential contents.' }
      # Tauri regenerates Android templates with trailing whitespace during local
      # builds. Include and scan those inputs, but leave their formatting intact.
      $whitespaceCheck = Invoke-Git @('diff', '--cached', '--check', '--', '.', ':!src-tauri/gen/android/**') -AllowFailure
      if ($whitespaceCheck.Code -ne 0) {
        $diagnostics = @($whitespaceCheck.Lines | Where-Object { $_ -match '^.+:\d+: (trailing whitespace|new blank line at EOF|space before tab in indent)' })
        throw ('Source whitespace check failed; fix the reported lines before snapshotting: ' + ($diagnostics -join '; '))
      }
      if ((Invoke-Git @('diff', '--quiet') -AllowFailure).Code -ne 0) { throw 'Source changed during snapshot preparation; retry after edits finish.' }
      $remainingNewSource = @((Invoke-Git @('ls-files', '--others', '--exclude-standard')).Lines | Where-Object { Test-EligibleNewSource $_ })
      if ($remainingNewSource.Count) { throw 'New source files appeared during snapshot preparation; retry.' }
      $tree = Get-GitValue @('write-tree')
      $changes = @((Invoke-Git @('diff', '--cached', '--name-status', $base)).Lines)
    } finally { $env:GIT_INDEX_FILE = $previousIndex }
    if ((Get-FileHash -LiteralPath $indexPath -Algorithm SHA256).Hash -ne $indexHash -or (Get-GitValue @('rev-parse', 'HEAD')) -ne $base -or (Get-GitValue @('rev-parse', '--abbrev-ref', 'HEAD')) -ne $originalBranch) { throw 'Local Git state changed during preparation; no branch was pushed.' }
    $commit = Get-GitValue @('commit-tree', $tree, '-p', $base, '-m', 'Build private macOS preview from current RushLink source')
    $branch = 'build/macos-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + $commit.Substring(0, 8)
    Invoke-Git @('check-ref-format', '--branch', $branch) | Out-Null
    if ((Invoke-AuthenticatedGit @('ls-remote', '--exit-code', '--heads', "https://github.com/$expectedRepository.git", "refs/heads/$branch") -AllowFailure).Code -ne 2) { throw 'Build branch is not confirmed to be new.' }
    Assert-PrivateRepository | Out-Null
    Write-Host "Snapshot $commit contains $($changes.Count) changed files."
    $changes | ForEach-Object { Write-Host $_ }
    $snapshot = [pscustomobject]@{ repository = $expectedRepository; private = $true; source_sha = $commit; tree_sha = $tree; base_sha = $base; branch = $branch; changes = $changes; new_source = $sourceManifest.NewSource; created_at = [DateTime]::UtcNow.ToString('o') }
    Write-JsonFile (Join-Path $outputRoot "snapshot-$commit.json") $snapshot
    Invoke-AuthenticatedGit @('-c', 'push.followTags=false', 'push', "https://github.com/$expectedRepository.git", "${commit}:refs/heads/$branch") | Out-Null
    Write-Host "Pushed private build branch $branch."
    $run = $null
    for ($attempt = 0; $attempt -lt 24 -and -not $run; $attempt++) {
      $branchQuery = [Uri]::EscapeDataString($branch)
      $runs = Get-GitHub "/actions/workflows/macos-build.yml/runs?branch=$branchQuery&event=push&per_page=20"
      $run = $runs.workflow_runs | Where-Object head_sha -EQ $commit | Sort-Object created_at -Descending | Select-Object -First 1
      if (-not $run) { Start-Sleep -Seconds 5 }
    }
    if (-not $run) { throw "Branch $branch was pushed, but no Actions run appeared. Check GitHub Actions before starting another build." }
    $run = Get-Run $run.id
    if ($run.head_sha -ne $commit -or $run.head_branch -ne $branch) { throw 'Actions run source does not match the snapshot.' }
  }
  Write-Host "macOS Actions run: $($run.html_url)"
  if ($NoWait) { Write-Host "Download later: powershell -File tools/build-macos.ps1 -DownloadRun $($run.id)"; return }
  $runDirectory = Join-Path $outputRoot $run.head_sha
  $existingEvidence = Join-Path $runDirectory 'macos-verified.json'
  if (Test-Path -LiteralPath $existingEvidence) {
    $previousRecords = @(Get-Content -LiteralPath $existingEvidence -Raw | ConvertFrom-Json | ForEach-Object { $_ })
    if (@($previousRecords | Where-Object run_id -NE $run.id).Count) {
      $runDirectory = Join-Path $outputRoot ("$($run.head_sha)-run-$($run.id)")
    }
  }
  New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
  $version = Get-SourceVersion $run.head_sha
  $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
  do {
    $run = Get-Run $run.id
    $jobs = @((Get-GitHub "/actions/runs/$($run.id)/jobs?per_page=100").jobs)
    foreach ($job in $jobs) {
      $step = ($job.steps | Where-Object status -EQ 'in_progress' | Select-Object -First 1).name
      Write-Host ("{0}: {1} {2}" -f $job.name, $(if ($job.conclusion) { $job.conclusion } else { $job.status }), $step)
    }
    $verified = @(Receive-CompletedArtifacts $run $jobs $version $runDirectory)
    Write-JsonFile (Join-Path $runDirectory 'macos-build-evidence.json') ([pscustomobject]@{ repository = $expectedRepository; run_id = $run.id; source_sha = $run.head_sha; branch = $run.head_branch; version = $version; url = $run.html_url; status = $run.status; conclusion = $run.conclusion; jobs = $jobs; installers = $verified; checked_at = [DateTime]::UtcNow.ToString('o') })
    $failedJobs = @($jobs | Where-Object { $_.status -eq 'completed' -and $_.conclusion -notin @('success', 'skipped') })
    if ($failedJobs.Count -or ($run.status -eq 'completed' -and $run.conclusion -ne 'success')) { throw "macOS build failed or was cancelled. Inspect $($run.html_url). Any completed installers remain in $runDirectory." }
    if ($run.status -eq 'completed') {
      if ($verified.Count -ne 2) { throw 'The successful run did not provide both verified Mac architectures.' }
      Write-Host "Both macOS installers are verified: $runDirectory"
      break
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "Wait timeout. The GitHub run continues; resume with -DownloadRun $($run.id)." }
    Start-Sleep -Seconds $PollSeconds
  } while ($true)
} finally {
  try {
    if ($temporaryIndex) {
      foreach ($ownedPath in @($temporaryIndex, ($temporaryIndex + '.lock'))) {
        $resolvedPath = [IO.Path]::GetFullPath($ownedPath)
        if (-not $resolvedPath.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
          [IO.Path]::GetFileName($resolvedPath) -notmatch '^[0-9a-f]{32}\.index(\.lock)?$') { throw 'Temporary-index cleanup path is outside the owned build directory.' }
        if (Test-Path -LiteralPath $resolvedPath -PathType Leaf) { Remove-Item -LiteralPath $resolvedPath }
      }
    }
  } finally {
    if ($headers) { $headers.Clear() }
    foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
  }
}
