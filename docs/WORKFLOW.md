# Development and platform builds

Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for the portable frontend setup,
browser demo and contribution checks. No HeadRush unit, signing credentials or
GitHub write access are needed to develop and test the frontend.

The platform helpers below are optional Windows PowerShell workflows. Open the
repository in VS Code and choose **Terminal → Run Task → RushLink: Run on tablet**
to build and open the Android app. The same commands work in a PowerShell terminal.

## Everyday shortcuts

| What you want | VS Code task | Terminal command |
| --- | --- | --- |
| Check tablet sizes and rotation without building | RushLink: Check tablet layouts and rotation | `npm run test:tablet` |
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

For layout checks without building an app, run `npm run test:tablet` or choose
**RushLink: Check tablet layouts and rotation** in VS Code. This starts the local
development server and checks nine tablet sizes in both orientations, all app
workspaces with both menu states, rotation during editing, save dialogs, touch
setlist ordering and EQ dragging. EQ device writes are intercepted
inside isolated tests. Screenshots and measurements go to `test-results/`; the browser report
is in `playwright-report/`. This uses Chromium touch emulation and does not
replace native Android keyboard or hardware testing.

`npm run tablet` prepares a dedicated tablet emulator, builds the current frontend
and x86-64 native app, installs the APK and launches RushLink. Run it again after
editing to rebuild and reinstall; the emulator and compiler caches are reused.
The tablet window stays open for testing. `npm run tablet:stop` closes it.

The emulator's SDK, AVD, data and logs stay under the ignored
`release-artifacts/build-tools` folder. It uses its own ADB server and emulator
ports, leaving other Android Studio devices alone. ADB handles only the
local emulator; RushLink communicates with HeadRush over Wi-Fi.

The first boot and first render can take longer while Android prepares its data.
An emulator checks layout and app startup; physical-device discovery, saving,
audio and MIDI still need real hardware testing.

If the tablet cannot connect using `headrushflexprime.local`, open **Check advanced
settings**, choose **Custom URL or IP**, and enter the HeadRush's actual Wi-Fi IP
address. Use the pedal's address, not the PC's or emulator's address. The emulator
can have trouble resolving `.local` names even when Windows can reach the pedal.
RushLink remembers the IP as a manual fallback and adds its API paths automatically.
At the next startup, the main connection first uses the selected model's `.local`
hostname: `headrushflexprime.local`, `headrushprime.local` or `headrushcore.local`.
If that fails, choose **Custom URL or IP** in advanced settings to reuse the saved
IP. Older saved IP preferences without model information initially use Flex Prime;
choose the correct model in advanced settings if needed.

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
The development server and test discovery ignore the isolated toolchain and
artifact folder, so downloading tools or building installers does not trigger
reloads or watch locked build files.

Installers, verified SHA-256 checksums and an automatically updated `README.md`
index are collected in `release-artifacts/current-build/`. The index identifies
each file; different platforms may represent different build runs. Android APKs
are debug previews, Windows installers are unsigned, and Mac previews use ad-hoc
signing without notarization.

RushLink 0.1.3 downloads target **HeadRush firmware 5.2.0** and carry
`_headrush-5.2.0` before the file extension. Keep that firmware label separate
from the app version, architecture and preview/signing labels. Verify the
checksums for the final filenames; the [release guide](RELEASE.md) describes
publication and provenance for all platform pipelines.

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
GitHub repository configured as `origin`, starts the Apple Silicon and Intel
Actions jobs, waits for their results and downloads verified DMGs. It prints the
run URL so progress can be checked in GitHub too. Contributors should use a fork
as `origin`; the helper accepts GitHub HTTPS and SSH remotes, and rejects the
separate website repository.

The snapshot includes current working source, including eligible new files, and
uses a separate `build/macos-*` branch. Your current branch, staged changes and
working files stay in place. Build outputs, profiles, signing keys and device
captures are excluded. Review uncommitted source before running this command:
the snapshot is pushed to `origin` and has that repository's visibility.
GitHub credentials stay in the local
credential manager or GitHub CLI; they are not written into project files.

Run `npm run macos:check` to verify GitHub access before a build. The account needs
access to push build branches and read Actions artifacts. Enable Actions in your
fork before building. `npm run build:all` performs the local build
followed by this Mac workflow.

Build tasks do not create tags, publish releases or deploy the website. Publishing
remains a separate step in [RELEASE.md](RELEASE.md). Linux is outside this Windows
workflow; it requires a Linux build environment. See [RELEASE.md](RELEASE.md) for
the Linux workflow and the iOS preview section below for iPhone and iPad builds.

## Phone UI checks without building

Run `npm run test:phone`, or select **RushLink: Check phone layouts and rotation**
from VS Code's **Tasks: Run Task** menu. It checks six phone sizes in portrait and
landscape using the development server, including editing dialogs and StageHand
fullscreen. See [PHONE-UX.md](PHONE-UX.md) for coverage and native testing limits.

## First setup on another Windows PC

Install Node.js 22.12 or newer, Git, the Rust MSVC toolchain, and the Microsoft Visual Studio
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


### Phone emulator: same commands as tablet

Replace `tablet` with `phone`; both workflows support the same options:

| Action | Tablet | Phone |
| --- | --- | --- |
| Build, install and open | `npm run tablet` | `npm run phone` |
| Open the existing APK | `npm run tablet -- -SkipBuild` | `npm run phone -- -SkipBuild` |
| Build and smoke-test headlessly | `npm run tablet -- -Headless -SmokeTest` | `npm run phone -- -Headless -SmokeTest` |
| Smoke-test the existing APK | `npm run tablet -- -SmokeTest -SkipBuild` | `npm run phone -- -SmokeTest -SkipBuild` |
| Stop the emulator | `npm run tablet:stop` | `npm run phone:stop` |
| Browser layout and rotation checks | `npm run test:tablet` | `npm run test:phone` |

In VS Code, choose **Tasks: Run Task → RushLink: Run on phone** or
**RushLink: Stop phone**. No emulator extension is required.
The phone starts in portrait at 1080 × 2340 with 440 dpi (approximately 393 × 851
CSS pixels before system insets). Use the emulator rotation controls for landscape.
It uses the same Android emulator APK as the tablet, with its own persistent AVD,
app data, ports and session record. Running or stopping one does not stop the other.
Each emulator defaults to 3 GB RAM. The first phone run prepares its AVD automatically
using the existing Android toolchain and system image.

Phone startup checks verify the packaged WebView, foreground app and fatal logs;
screenshots and results are saved in `release-artifacts/current-build/android/phone/`.
A smoke test closes only emulator processes it started. Browser tests separately
cover multiple sizes and orientations. The emulator cannot replace physical-device
checks for real Wi-Fi discovery or hardware behaviour. HeadRush communication stays
on Wi-Fi; ADB here communicates only with the local PC emulator.
For a setup-only check, run
`powershell -ExecutionPolicy Bypass -File tools/run-android.ps1 -Profile phone -Check`.


### iPhone and iPad builds on GitHub

Run `npm run build:ios` or select **RushLink: Build iPhone and iPad (GitHub Actions)**
in VS Code. This snapshots current source into a build branch on `origin`, builds on
GitHub's macOS runners, and downloads checksum-verified artifacts. Windows does
not compile Apple code. The same app supports iPhone and iPad, including rotation.

The workflow produces an **unsigned ARM64 IPA** for iPhone/iPad and an **ARM64
simulator app ZIP**. The simulator job installs and launches it on an iPhone and
an iPad, retaining screenshots as a separate Actions artifact. These
startup checks do not verify a live HeadRush connection from GitHub.

No Apple signing secrets are required for these preview builds. The unsigned IPA
cannot be installed directly on a physical device or uploaded to TestFlight;
Apple signing and provisioning must be configured first. Simulator apps run on
a Mac, including the GitHub runner, and do not run in the Windows Android emulator.
Actions artifacts expire after 14 days and follow the repository's visibility;
do not upload sensitive data. Downloaded copies are kept under
`release-artifacts/current-build/<source SHA>/ios-device/` and
`ios-simulator/`. No App Store upload or public release is performed.

For the 0.1.3 release, device previews use a filename ending in
`_unsigned_headrush-5.2.0.ipa`; the ARM64 simulator preview ends in
`_headrush-5.2.0.app.zip`. Preserve these distinctions when selecting or sharing
a build. Published releases keep their original tags; build snapshots and
packaging follow-ups record their own source revisions instead of moving a
released tag.

Use `npm run build:ios -- -NoWait` to queue without waiting. Resume downloading
with `npm run build:ios -- -DownloadRun <run ID>`.
