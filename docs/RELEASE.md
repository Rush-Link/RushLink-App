# Build and release checklist

RushLink installers contain compiled application assets only. The device-reference tree, local WebView profile, cached ToneMod results, rig history, favourites, diagnostics, test output and developer logs are not Tauri bundle resources.

For everyday preview builds, use the [automated VS Code workflow](WORKFLOW.md).
`npm run build:all` builds locally on Windows and uses GitHub Actions for Mac,
collecting verified installers without publishing a release. Preview builds do
not require a version change.

## Before a release build

1. Update the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Run `npm ci`.
3. Run `npm audit --omit=dev` and `npm run test:ci`.
4. Run `npm run release:check`. This rebuilds the frontend and rejects source maps, database files, private keys, absolute user paths, captured-device paths and known development-device identifiers.

## Local Windows build

From a Developer PowerShell with Node.js, Rust, WebView2 and the Microsoft C++ desktop workload installed:

```powershell
npm run build:windows
```

Installers and checksums are collected in `release-artifacts/current-build/windows/`.
The original Tauri output remains below `src-tauri/target/release/bundle/`. Test the installer and uninstall flow on a machine or Windows Sandbox that has never run RushLink; an existing development profile is never embedded in the installer but can make a local smoke test look pre-populated.

## Local Android preview on Windows

`tools/build-android.ps1` builds separate debug APKs for an x86-64 emulator and
ARM64 tablets or phones. The Android project is in `src-tauri/gen/android`, with
mobile window settings in `src-tauri/tauri.android.conf.json`. Desktop window
settings are unchanged.

The local build uses JDK 17, Android SDK platform 36, Build Tools 35.0.0 and
36.0.0, NDK 28.2.13676358, and the Rust targets `x86_64-linux-android` and
`aarch64-linux-android`. Its Gradle 8.14.3 wrapper checks the official distribution
SHA-256. Android Studio's bundled Java 25 cannot run this wrapper; select JDK 17.

On this prepared Windows workspace:

```powershell
npm run build:android
```

The script prefers the validated isolated SDK and JDK under `release-artifacts/build-tools`
and prepares missing tools automatically. To select another installation directly,
pass `-JavaHome`, `-AndroidHome` and, if needed, `-NdkHome`. It sets environment
variables only for its process and restores them after the build. Tool downloads,
caches, signing keys and generated native binaries are ignored by Git.

The script automatically uses copying on Windows installations where Tauri cannot create
symbolic links. Tauri still compiles each native library and embeds the frontend;
the script copies those libraries and packages them with the generated Gradle
project. It does not require Windows Developer Mode or administrator rights.
`-CopyNativeLibraries` remains available as an explicit override. `-SkipFrontendBuild` is only
for reusing a verified, current `dist/` build.

Verified APKs and `SHA256SUMS.txt` are written to
`release-artifacts/current-build/android/`. Use the `x86_64-emulator` APK for the
PC tablet emulator and the `arm64-device` APK for most current Android tablets
and phones. These APKs use a local debug signing key and are previews, not store
releases. An emulator startup check does not verify live HeadRush discovery,
Wi-Fi saving, audio, or MIDI on physical Android hardware.

## Linux preview builds

The separate `Build RushLink Linux preview` workflow in `.github/workflows/linux-build.yml`
builds x86-64 `.deb` and `.AppImage` packages on Ubuntu 22.04. This baseline follows
[Tauri's Linux compatibility guidance](https://v2.tauri.app/distribute/debian/).
It runs application tests, native Linux tests, and release privacy checks before
packaging. Only installers and SHA-256 checksums are uploaded as private Actions
artifacts, retained for 14 days. It does not create or modify public releases.

Run it manually after the workflow exists on the private repository's default
branch, or push an approved build snapshot to a `build/linux-*` branch to trigger
it without changing the default branch. Include the current app sources and new
component styles; building an old committed revision will omit local fixes.
Do not include local profiles, databases, credentials, or device captures.
Private-repository builds consume the organization's Actions allowance.

Download the `RushLink-linux-x64-<run number>` artifact from the completed run.
Verify its checksums before testing. Linux GUI startup, WebKitGTK rendering,
HeadRush discovery, and live device interaction still require Linux smoke tests;
a successful package build alone does not establish hardware compatibility.
StageHand MIDI input depends on the Linux WebView exposing Web MIDI and may be
unavailable. A numeric LAN address can be used if `.local` discovery is unavailable.
An AppImage downloaded inside an Actions ZIP may need `chmod +x` before launch.

On a prepared Linux machine, the equivalent package command is:

```sh
npm ci
npx playwright install --with-deps chromium
npm run release:check
npm run tauri -- build --ci --bundles deb,appimage -- --locked
```

Install the Linux system packages listed in the workflow and a Rust toolchain
first. Keep Linux build output separate from Windows build output.

## macOS builds

Apple Silicon and Intel builds run on GitHub-hosted macOS runners. The
`Build RushLink macOS preview` workflow in `.github/workflows/macos-build.yml`
uses native runners for both architectures. Run it manually or push a build
snapshot to a `build/macos-*` branch. It runs native tests and release checks,
builds `.dmg` installers, and verifies the app signatures and binary architectures.
Only installers and SHA-256 checksums are uploaded as private Actions artifacts,
retained for 14 days.

Preview builds use ad-hoc signing and need no Apple credentials. They are not
notarized; successful packaging does not establish Gatekeeper acceptance or live
HeadRush compatibility. Test installation, GUI startup, discovery and Wi-Fi NAM saving
on each Mac architecture before public distribution. Private macOS builds consume
the organization's Actions allowance.

The `Build RushLink desktop release` workflow also builds both Mac architectures
alongside Windows, and creates a draft prerelease in the private source repository.
It uses ad-hoc signing when an Apple signing identity is not configured.

For public distribution, configure these repository secrets before running the workflow:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD` (an app-specific password)
- `APPLE_TEAM_ID`

Without Apple signing and notarisation, macOS users will receive Gatekeeper warnings. Windows installers are also unsigned until a code-signing certificate is configured.

## Publish and website

1. Trigger the release workflow or push a tag such as `rushlink-v0.1.0`.
2. Download and smoke-test all three draft artifacts: Windows x64, macOS Apple Silicon and macOS Intel.
3. Edit the generated release notes, keep the early-alpha warning, then publish the draft.
4. Verify the marketing site's `data-repository` remains `rush-link/rush-link.github.io`. Keep the proprietary `rush-link/RushLink-App` source repository private.
5. Deploy GitHub Pages and verify the Downloads panel and release count against the published release.

Do not upload `reference/`, `coverage*`, `test-results/`, `playwright-report/`, `dist/` or the complete `src-tauri/target/` directory. Upload only the installer assets produced below the platform bundle directories.
