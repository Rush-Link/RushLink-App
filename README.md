# RushLink

RushLink is a free, closed-source, unofficial companion for HeadRush Prime-family devices. The current implementation is desktop-first and uses the captured Flex Prime 5.1 API contract in `reference/headrush/`.

## Run the UI

```powershell
npm install
npm run dev
```

The browser build automatically uses a safe demo device. Native network access is enabled through Tauri.

## Run the Windows desktop app

Install the Rust MSVC toolchain and Microsoft C++ Build Tools, then:

```powershell
npm run tauri dev
```

RushLink communicates with HeadRush over Wi-Fi only, using a `.local`, loopback, or private-LAN address. Add a manual address in Settings if discovery is unavailable. NAM downloads save to `Neural Amp Modeler/Tone 3000`; the save popup lets you name the model or save the active audition as a rig. Custom NAM destinations are unavailable through the verified Wi-Fi API.

## Build and tablet shortcuts

In VS Code, choose **Terminal → Run Task → RushLink: Run on tablet** to build,
install and open the app in the PC tablet emulator. **Ctrl+Shift+B** runs the
Windows and Android build with checks.

```powershell
npm run tablet        # Build, install and launch the tablet app
npm run build:local   # Windows installers + Android APKs, built locally
npm run build:macos   # Apple Silicon + Intel DMGs, built in GitHub Actions
npm run build:all     # Local builds, then Mac builds and verified downloads
npm run builds:open   # Open the installers and checksum index
```

The tools reuse caches and collect output in `release-artifacts/current-build/`.
Build commands keep releases unpublished. See [the workflow guide](docs/WORKFLOW.md)
for first setup, stopping the emulator, and the full list of tasks.

## Project status

The desktop implementation includes continuous sync, a fixed two-row 14-slot rig workflow with graphical split routing, right-side block presets and graphic EQ, clickable rig history, embedded footswitch/scene/expression editing, shared MIDI configuration in Settings, and StageHand with persisted multi-stage layouts, rig-following stage selection, pointer/touch drag-and-drop, Web MIDI Learn, and wide tuner/drum/command-only Practice Tool remote decks based on the documented Flex Prime v5.1 CC map. It also includes live Tone3000/HeadRush Cloud audition and download, rig/setlist management, restorable snapshots, device-backed drums, Global EQ, tuner, diagnostics, and the native Rust transport. Firmware updating and Bluetooth audio configuration are intentionally excluded; OS-paired MIDI is supported where Web MIDI is available.

## Testing

```powershell
# Unit and jsdom integration tests
npm test

# Enforced deterministic-core coverage gate
npm run test:coverage

# Enforced regression floor across every executable source file
npm run test:coverage:all

# Detect hidden order coupling with a fresh randomized order
npm run test:stability

# Reproduce the two deterministic shuffled orders used by CI
npm run test:stability:ci

# Rust/Tauri device-bridge security and routing tests
npm run test:native

# Chromium critical user journeys
npm run test:e2e

# Whole-app coverage gate followed by E2E
npm run test:all

# Production build, coverage, shuffled-order stability and E2E release gate
npm run test:ci
```

The focused V8 gate covers domain rules, device/file/MIDI services, shared utilities and the sync adapter at a minimum of 95% statements, lines and functions. Branches are gated at 75% because reflected payload normalizers intentionally accept many optional firmware shapes. The whole-app gate includes page components and the large Zustand orchestration store and enforces at least 95% statements/lines, 78% branches, and 72% functions. Rust tests cover native address validation, route confinement, raw-request restrictions, and capability derivation. Testing Library integration tests, two deterministic shuffled runs, and real Chromium desktop/phone-sized journeys validate interactive layers without misrepresenting browser interaction coverage as isolated unit coverage.

Install the pinned E2E browser once on a new machine with `npx playwright install chromium`. HTML reports are generated in `coverage/`, `coverage-all/` and `playwright-report/`.

The `RushLink quality gates` GitHub Actions workflow runs native bridge tests, the production build, coverage, shuffled-order stability checks, and Playwright journeys on every pull request and main-branch push. Failed browser runs retain traces, screenshots, and video; coverage reports are retained for every run.

See [docs/APP_PLAN.md](docs/APP_PLAN.md) and [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Marketing website

The dependency-free GitHub Pages website lives in [`site/`](site/). It includes the animated product story, TonePilot and StageHand demonstrations, current-alpha documentation, roadmap, responsive layouts, and an opt-in `?stats=1` view for public GitHub Release asset totals.

```powershell
npm run test:site
```

The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) deploys the static directory through GitHub Pages. Select **GitHub Actions** as the Pages source in the repository settings.

## Desktop releases

Run the release payload checks and build Windows installers with:

```powershell
npm run build:windows
```

Windows installers and checksums are collected in `release-artifacts/current-build/windows/`.
`npm run build:macos` builds Apple Silicon and Intel DMGs using the private GitHub
Actions preview workflow and downloads them automatically. Public signing and
notarization are described in [docs/RELEASE.md](docs/RELEASE.md).

Only publish the generated installer artifacts. Do not upload `reference/`, `coverage/`, `playwright-report/`, `dist/`, or the Rust `target/` tree. The captured device research in `reference/` is development input and is never included in the application bundle. For the closed-source public release, the website and installer downloads are hosted in the separate public `rush-link/rush-link.github.io` repository rather than exposing this private source repository.

See [docs/RELEASE.md](docs/RELEASE.md) for the complete signing, verification, website, and publishing checklist. RushLink's data handling is documented in [PRIVACY.md](PRIVACY.md).
