# RushLink by Cygma Audio

RushLink is an open-source, unofficial companion for HeadRush Prime-family devices. Edit rigs, organize setlists, explore captures with ToneMod, and build a touch-friendly performance layout with StageHand.

**RushLink 0.1.3 targets HeadRush firmware 5.2.0.** Read the [release notes](docs/releases/0.1.3.md) for multiple-NAM support, resource limits and compatibility details. `0.1.3` is the app version; `5.2.0` is the pedal firmware version.

Download installers and platform previews from the [0.1.3 GitHub release](https://github.com/Rush-Link/RushLink-App/releases/tag/rushlink-v0.1.3). Filenames include `headrush-5.2.0`. Windows and macOS installers are available alongside Linux, Android and iOS previews; read the [download table and platform limits](docs/releases/0.1.3.md) before choosing a package. The iPhone/iPad IPA requires Apple developer signing before use on a physical device.

The app uses React, TypeScript and Tauri 2. A browser demo lets you work on the interface without a pedal; native builds communicate with the selected HeadRush over the local network.

**Early alpha:** live API behavior has been investigated on Flex Prime firmware 5.1 and 5.2.0. Other models and operating systems need further hardware testing. RushLink is not affiliated with or endorsed by HeadRush or inMusic. Keep a device backup before testing changes that write to a pedal.

## Try the browser demo

Install Git and Node.js 22.12 or newer, then:

```sh
git clone https://github.com/Rush-Link/RushLink-App.git
cd RushLink-App
npm ci
npm run dev
```

Open `http://localhost:1420` and choose **Connect to your device**. In a regular browser this starts a simulated session, without connecting to a real pedal. Follow the first-run editing setup to explore the workspaces. Demo data and preferences are stored in that browser's local profile.

Dark is the default. Choose Light or System in **Settings → Appearance → Color mode**.

## Run the native app

Install the Rust stable toolchain and your platform's Tauri prerequisites, then run:

```sh
npm run tauri -- dev
```

Windows needs the Microsoft C++ desktop workload and WebView2. macOS needs Xcode command-line tools; Linux needs the WebKitGTK and system development packages used by the Linux workflow. See [development setup](docs/DEVELOPMENT.md) for platform details and device connection.

## Features and compatibility

The app includes a 14-slot Rig Editor, routing and assignments, rigs/setlists, configurable ToneMod Test Rigs and auditions, StageHand performance layouts, snapshots, drums, Global EQ, tuner, settings and diagnostics. It adapts to desktop, tablet and phone screens.

Feature availability comes from the connected device's reflected capabilities. Firmware updating and Bluetooth audio configuration are outside the current scope. The verified Wi-Fi API saves Tone3000 NAM downloads to `Neural Amp Modeler/Tone 3000`; arbitrary upload destinations are not supported. See the [5.2 firmware notes](docs/HEADRUSH-5.2.0.md) for multiple NAM hosts, measured allocation limits and compatibility details.

## Contribute

Start with [CONTRIBUTING.md](CONTRIBUTING.md), the [development guide](docs/DEVELOPMENT.md), and the [architecture map](docs/ARCHITECTURE.md). Documentation, accessibility, reproducible bug reports, tests and verified device compatibility reports are welcome.

Common local checks:

```sh
npm test -- --maxWorkers=2
npm run build
npx playwright install chromium
npm run test:e2e -- --workers=2
```

Run the checks relevant to your change; [testing guidance](docs/TESTING.md) explains native, browser, coverage and release checks. Use [the security policy](SECURITY.md) for sensitive reports.

## Documentation and releases

The [documentation index](docs/README.md) links the maintained guides, including [build/emulator workflows](docs/WORKFLOW.md), [releases](docs/RELEASE.md), [privacy](PRIVACY.md) and [third-party/font notices](THIRD_PARTY_NOTICES.md).

The public website is maintained and deployed from the separate [Rush-Link/rush-link.github.io repository](https://github.com/Rush-Link/rush-link.github.io). Website contributions belong there.

## License

Source code is licensed under the [MIT License](LICENSE). Preserve third-party notices and the licenses supplied with fonts and other assets. The license does not grant rights to HeadRush or other third-party names and marks.
