# Build and release guide

RushLink installers contain compiled application assets only. Local device captures, the WebView profile, cached ToneMod results, rig history, favourites, diagnostics, test output and developer logs are outside the maintained source and are not Tauri bundle resources.

For everyday preview builds, use the [development workflow](WORKFLOW.md).
`npm run build:all` builds locally on Windows and uses GitHub Actions for Mac,
collecting verified installers without publishing a release. Preview builds do
not require a version change.

The displayed product name is **RushLink by Cygma Audio**. Keep application
identifiers and existing data keys stable. Windows MSI uses the explicit
`bundle.windows.wix.upgradeCode` from the original RushLink name so a renamed
installer upgrades the existing installation. The Windows collection script
reads the branded source filenames and retains the established public download
filenames; macOS verification reads the app name from the Tauri configuration.

## Firmware labels and platform pipelines

The application version and target pedal firmware are separate. For RushLink
**0.1.3**, use **HeadRush firmware 5.2.0** in the release title and notes, and add
`_headrush-5.2.0` immediately before each download's extension. Preserve the
existing app version, platform, architecture and signing/flavor labels. Treat
`.app.zip` and `.app.tar.gz` as complete extensions when adding the suffix.
For example:

- `RushLink_0.1.3_windows_x64_setup_headrush-5.2.0.exe`
- `RushLink_0.1.3_android-arm64-device_debug_headrush-5.2.0.apk`
- `RushLink_0.1.3_ios-iphone-ipad_unsigned_headrush-5.2.0.ipa`
- `RushLink_0.1.3_ios-simulator-arm64_headrush-5.2.0.app.zip`

Generate checksum files using the final published filenames. Keep the release's
standard `SHA256SUMS.txt`, `SOURCE-MANIFEST.json` and `RELEASE-NOTES.md` names;
installer and source-ZIP filenames carry the firmware label. Renaming a packaged
installer does not change its internal app version or executable bytes; do not
edit signed package contents to add a firmware label.

Keep the established platform build paths available:

| Platform | Build path | Output |
| --- | --- | --- |
| Windows x64 | `npm run build:windows`, or the Windows job in **Build RushLink desktop release** | EXE and MSI installers |
| macOS ARM64 and Intel | **Build RushLink macOS preview** in `macos-build.yml`, or the macOS jobs in the desktop release workflow | Separate architecture-specific DMGs |
| Linux x64 | **Build RushLink Linux preview** in `linux-build.yml`, or the Linux job in the desktop release workflow | AppImage and Debian previews |
| Android | `npm run build:android` with the validated Windows Android toolchain | ARM64 device and x86-64 emulator debug APKs |
| iPhone and iPad | **Build RushLink iPhone and iPad preview** in `ios-build.yml`, also available through `npm run build:ios` | Unsigned ARM64 device IPA and ARM64 simulator app ZIP |

The dedicated Actions workflows upload checksummed artifacts; they do not
publish them as releases. Review and attach their verified outputs to the
intended release separately. Record the workflow run and source revision used
for each platform. Android build evidence records its toolchain and artifact
hashes. Simulator screenshots and diagnostic output are verification evidence,
not installer downloads.

## Before a release build

When converting an older private checkout into a public repository, review its
history as well as its current files. Removing a capture or third-party archive
from the working tree does not remove it from earlier commits. Start the public
repository from a reviewed source snapshot without `.git` or generated/local
data when the old history contains material that should stay private. Keep the
historical repository and its backup outside the public repository; do not push
its branches, tags or a mirror into the new repository. Preview snapshot helpers
retain their parent commit history and do not perform history sanitization.

1. Update the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
   Keep `package-lock.json`, `src-tauri/Cargo.lock` and the app's displayed version in sync.
   Write versioned notes in `docs/releases/<app-version>.md` and clearly separate
   the RushLink app version from its target HeadRush firmware. RushLink **0.1.3**
   targets HeadRush firmware **5.2.0**; see the [0.1.3 release notes](releases/0.1.3.md).
2. Run `npm ci`.
3. Run `npm audit --omit=dev` and `npm run test:ci`. Review dependency advisories rather than applying unreviewed updates during packaging.
4. Run `npm run release:check`. This rebuilds the frontend and rejects source maps, database files, private keys, absolute user paths, captured-device paths and known development-device identifiers.
5. Check that the license, third-party notices, release notes and supported-platform notes match the release. Confirm that any new fixtures or assets can be redistributed.

Pull requests run the quality workflow without signing secrets or a HeadRush unit.
Packaging and publishing use separate workflows; a successful test run does not
publish an installer or verify physical-device behavior.

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

After preparing the Windows prerequisites in [WORKFLOW.md](WORKFLOW.md):

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
packaging. Only installers and SHA-256 checksums are uploaded as Actions artifacts,
retained for 14 days. It does not create or modify releases.

Run it manually from the repository's **Actions** tab, or push a committed build
snapshot to a `build/linux-*` branch. Contributors can run the workflow in a fork.
Build the intended committed revision: uncommitted local changes are not included
when starting Actions from GitHub. Do not include local profiles, databases,
credentials or device captures in source snapshots or artifacts.

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
Only installers and SHA-256 checksums are uploaded as Actions artifacts,
retained for 14 days.

Preview builds use ad-hoc signing and need no Apple credentials. They are not
notarized; successful packaging does not establish Gatekeeper acceptance or live
HeadRush compatibility. Test installation, GUI startup, discovery and Wi-Fi NAM saving
on each Mac architecture before distributing them as supported releases.

The `Build RushLink desktop release` workflow also builds both Mac architectures
alongside Windows, and creates a draft prerelease in the application source repository.
It uses ad-hoc signing when an Apple signing identity is not configured.

For public distribution, configure these repository secrets before running the workflow:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD` (an app-specific password)
- `APPLE_TEAM_ID`

Without Apple signing and notarisation, macOS users will receive Gatekeeper warnings. Windows installers are also unsigned until a code-signing certificate is configured.

## iPhone and iPad preview builds

The dedicated `ios-build.yml` workflow builds on GitHub-hosted Apple Silicon
macOS runners, with separate device and simulator jobs. Run it through Actions
or use `npm run build:ios` from Windows as described in [WORKFLOW.md](WORKFLOW.md).
It checks the package's app version, ARM64 architecture, iPhone/iPad device
families, orientation settings and local-network permission description. The
simulator job also installs and launches the app on iPhone and iPad simulators
and saves startup evidence separately from the downloads.

The device output is an **unsigned ARM64 IPA**, not an App Store or TestFlight
release. A developer must sign and provision it before installation on physical
hardware. The **ARM64 simulator app ZIP** requires an Apple Silicon Mac and an
iOS Simulator runtime; it does not run on physical iPhones/iPads or in a Windows
Android emulator. No Apple signing secrets are needed for these preview builds.
Successful simulator checks do not establish real Wi-Fi discovery, device
writes, audio or MIDI behavior on physical iOS hardware.

## Draft releases and website

1. Review the source revision and matching versions, then trigger **Build RushLink desktop release** or push a `rushlink-v<version>` tag. This needs repository write access and creates a draft prerelease.
2. Download and inspect the Windows x64 installers, macOS Apple Silicon/Intel DMGs and Linux x64 Debian/AppImage preview packages. Build Android ARM64 device/x86-64 emulator APKs and iPhone/iPad unsigned IPA/ARM64 simulator ZIP through their separate platform paths when including mobile previews. Verify architecture, app version, payload and checksums. Test installation and startup on each available platform; report any platform or hardware checks that were not performed.
3. Apply the target-firmware filename suffix, regenerate checksums and review the final download list. Edit the generated release notes to identify the app version, firmware target, per-platform signing/preview limitations and build provenance; keep the early-alpha warning, then publish the draft.
4. Coordinate the download catalog with the separate website repository, `rush-link/rush-link.github.io`. Its `data-repository` identifies the repository supplying its download releases; creating a source-repository release does not copy assets there automatically.
5. Make website changes and deploy GitHub Pages from that website repository. Verify the Downloads panel and release count against its configured release source. Website sources, validation and Pages deployment are maintained separately from the application repository.

For a published release, keep the released tag immutable. `rushlink-v0.1.3`
identifies the application source revision `271a1e5`; do not retag it to claim
that later packaging changes were in those binaries. Firmware filename labels
can be added without recompiling unchanged packages. The 0.1.3 platform builds
use that released application source: Windows retains its desktop-release
build, macOS/Linux/iOS use their dedicated Actions workflows at the released
tag, and Android uses the validated local toolchain with app-source equality
checked against the tag. Record exact revisions and Actions runs, verify app
versions, and refresh the checksums and website catalog together. A refreshed
source ZIP can include later packaging scripts and documentation; its manifest
must identify both the exported snapshot and the released application-source
commit rather than imply that the original tag moved.

Preview Actions run in public repositories and forks as well as private ones.
Their logs and artifacts follow the repository's access rules. Treat every build
input and uploaded artifact as redistributable; the 14-day artifact expiry is not
a privacy guarantee. Keep signing credentials in repository secrets, and never
put credentials or captured user/device data in release notes or diagnostics.

Do not upload `reference/`, `coverage*`, `test-results/`, `playwright-report/`, `dist/` or the complete `src-tauri/target/` directory. Upload only the installer assets produced below the platform bundle directories.
