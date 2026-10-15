# Development setup

## Browser demo

Use Git, Node.js 22.12 or newer, and npm. The CI workflow uses Node 22. Install dependencies from the committed lockfile:

```sh
npm ci
npm run dev
```

Vite serves the app at `http://localhost:1420` and requires that port to be available. Choose **Connect to your device** to enter the browser demo, then complete the first-run editing setup. The browser transport returns simulated responses; entering a real pedal address does not enable hardware access in the browser build.

Preferences, layouts and other app-owned data persist in local storage. Use a separate browser profile or clear this site's storage if you need a clean first-run session. Never commit a development profile or export containing personal information.

`package.json` keeps `private: true` to prevent accidental publication to npm. RushLink is a desktop application, not an npm package; this flag does not restrict its open-source license or repository visibility.

## Native prerequisites

Native builds need the Rust stable toolchain, Cargo and your platform's Tauri 2 system dependencies in addition to the frontend setup.

| Platform | Required environment |
| --- | --- |
| Windows | Rust MSVC toolchain, Visual Studio Build Tools with **Desktop development with C++**, and Microsoft Edge WebView2. |
| macOS | Xcode command-line tools and Rust. Apple signing/provisioning is separate from local development. |
| Linux | A supported Linux toolchain and WebKitGTK 4.1 development packages. The package list in [the Linux build workflow](../.github/workflows/linux-build.yml) is the maintained build reference. |
| Android | Android SDK/NDK, a compatible JDK and Android Rust targets. The Windows setup/build scripts manage an isolated toolchain; see [WORKFLOW.md](WORKFLOW.md). |
| iOS/iPadOS | A macOS/Xcode build environment. Preview workflows and physical-device signing limits are described in [WORKFLOW.md](WORKFLOW.md). |

After setup:

```sh
npm run tauri -- dev
```

The Tauri CLI starts Vite and the native host. Unlike the browser demo, native mode connects to a real pedal and can write to it.

## Connect a device

1. Put the app and HeadRush on the same local network.
2. Choose the correct model in the connection screen's advanced settings. The defaults are `headrushflexprime.local`, `headrushprime.local` and `headrushcore.local`.
3. If hostname resolution fails, select **Custom URL or IP** and enter the pedal's private IP. The app adds the API routes.
4. Inspect Diagnostics and choose the editing mode appropriate to your test. Back up the device before experimenting with writes or restores.

Live reflection determines available blocks, controls and methods. Flex Prime 5.1/5.2 has direct investigation evidence; another model or firmware version needs its own verification. See [HEADRUSH-5.2.0.md](HEADRUSH-5.2.0.md) before changing NAM allocation or calibration behavior.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Browser demo and frontend hot reload. |
| `npm run tauri -- dev` | Native app with frontend hot reload. |
| `npm run build` | TypeScript checks and production frontend bundle. |
| `npm run preview` | Serve the built frontend as a browser demo. |
| `npm run check:repo` | Check repository hygiene and local documentation links. |
| `npm test -- --maxWorkers=2` | Unit and jsdom integration tests with bounded workers. |
| `npm run test:e2e -- --workers=2` | Chromium browser journeys; starts Vite automatically. |
| `npm run test:native` | Rust device-bridge tests; requires native prerequisites. |
| `npm run release:check` | Build and verify the shipped frontend and icon payload. |

See [TESTING.md](TESTING.md) for choosing checks. Windows-only PowerShell helpers such as `npm run doctor`, `npm run tablet` and `npm run build:local` are optional; they are not required for browser contributions. Read [WORKFLOW.md](WORKFLOW.md) before using Apple build helpers: those commands push a source snapshot and start GitHub Actions jobs, so they require suitable repository access.

## Source and generated output

Commit source changes and intentional lockfile updates. `node_modules/`, `dist/`, Rust `target/`, coverage, browser reports, emulator tools and release artifacts are generated locally and ignored. Do not use another developer's local device captures as a prerequisite for a test; add a minimal sanitized fixture when needed.

Runtime logos and fonts live in `public/`, and native icons live in `src-tauri/icons/`. Keep the original identity and [license notices](../THIRD_PARTY_NOTICES.md) when changing assets. The public website is developed and deployed from its own [repository](https://github.com/Rush-Link/rush-link.github.io).
