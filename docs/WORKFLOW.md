# Build and test from VS Code

Open the RushLink repository folder in VS Code. Choose **Terminal → Run Task →
RushLink: Run on tablet** to build and open the Android app. The same commands
also work in VS Code's PowerShell terminal.

## Everyday shortcuts

| What you want | VS Code task | Terminal command |
| --- | --- | --- |
| Test the current app on a tablet | RushLink: Run on tablet | `npm run tablet` |
| Build Windows and Android with checks | RushLink: Build locally (Windows + Android) | `npm run build:local` |
| Build all configured platforms | RushLink: Build everything (local + Apple Actions) | `npm run build:all` |
| Build only Mac previews | RushLink: Build Mac previews (GitHub Actions) | `npm run build:macos` |
| Check the local tools | RushLink: Check setup | `npm run doctor` |
| Prepare Android tools | RushLink: Prepare Android tools | `npm run android:setup` |
| Close the RushLink tablet emulator | RushLink: Stop tablet | `npm run tablet:stop` |
| Find the installers | RushLink: Open build folder | `npm run builds:open` |

**Ctrl+Shift+B** runs the local Windows and Android build. These are ordinary
[VS Code workspace tasks](https://code.visualstudio.com/docs/debugtest/tasks),
defined in `.vscode/tasks.json`.

## Tablet testing

`npm run tablet` prepares a dedicated tablet emulator, builds the current frontend
and x86-64 native app, installs the APK and launches RushLink. Run it again after
editing to rebuild and reinstall; the emulator and compiler caches are reused.
The tablet window stays open for testing. `npm run tablet:stop` closes it.

The emulator's SDK, AVD, data and logs stay under the ignored
`release-artifacts/build-tools` folder. It uses its own ADB server and emulator
ports, leaving Android Studio's other devices and Camo alone. ADB handles only the
local emulator; RushLink communicates with HeadRush over Wi-Fi.

The first boot and first render can take longer while Android prepares its data.
An emulator checks layout and app startup; physical-device discovery, saving,
audio and MIDI still need real hardware testing.

For a repeatable startup check without opening a tablet window:

```powershell
npm run tablet -- -Headless -SmokeTest
```

To install the APK already built in this workspace without rebuilding:

```powershell
npm run tablet -- -SkipBuild
```

## Builds and output

The local build checks the frontend payload, native tests, app coverage and browser
journeys, then builds Windows EXE/MSI installers and Android APKs for the emulator
and ARM64 tablets or phones. It builds the frontend once and reuses it for both
platforms. A workspace lock prevents competing local build tasks.
The test suites use bounded worker counts so a running tablet emulator can share
the PC without starting a large number of browser processes.

Installers, verified SHA-256 checksums and an automatically updated `README.md`
index are collected in `release-artifacts/current-build/`. The index identifies
each file; different platforms may represent different build runs. Android APKs
are debug previews, Windows installers are unsigned, and Mac previews use ad-hoc
signing without notarization.

Additional commands:

```powershell
npm run build:windows
npm run build:android
npm run build:android -- -Target emulator
npm run build:android -- -Target device
npm run build:local -- -SkipTests
```

`-SkipTests` skips the automated test suites for an iteration build; frontend
compilation and payload checks still run. Normal builds keep all checks enabled.
Changed JavaScript dependencies are installed from the lockfile automatically.
Rust builds use `--locked`.

## Mac builds

`npm run build:macos` sends a snapshot of the current application sources to the
private `Rush-Link/RushLink-App` repository, starts the Apple Silicon and Intel
GitHub Actions jobs, waits for their results and downloads verified DMGs. It
prints the run URL so progress can be checked in GitHub too.

The snapshot uses a separate `build/macos-*` branch. Your current branch, staged
changes and working files stay in place. Build outputs, profiles, signing keys
and private device captures are excluded. GitHub credentials stay in the local
credential manager or GitHub CLI; they are not written into project files.

Run `npm run macos:check` to verify GitHub access before a build. The account needs
access to push private build branches and read Actions artifacts. Mac jobs use
the repository's Actions allowance. `npm run build:all` performs the local build
followed by this Mac workflow.

Build tasks do not create tags, publish releases or deploy the website. Publishing
remains a separate step in [RELEASE.md](RELEASE.md). Linux is outside this Windows
workflow; it requires a Linux build environment. iOS is not configured yet.

## First setup on another Windows PC

Install Node.js 22 or newer, Git, the Rust MSVC toolchain, and the Microsoft Visual Studio
**Desktop development with C++** workload. Then run:

```powershell
npm run doctor
npm run android:setup
```

Android preparation downloads missing tools into the workspace and verifies the
archives. It selects a compatible JDK instead of relying on Android Studio's
bundled Java. SDK licenses are a one-time step: if setup reports missing license
acceptance, review the Android SDK terms and rerun with explicit acceptance:

```powershell
npm run android:setup -- -AcceptLicenses
```

No permanent environment variables or Windows security settings are changed.
Use `npm run doctor -- -IncludeMacos` to also check GitHub access. Setup errors
identify the missing tool or account access before a long build starts.
