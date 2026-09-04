# Desktop release checklist

RushLink installers contain compiled application assets only. The device-reference tree, local WebView profile, cached TonePilot results, rig history, favourites, diagnostics, test output and developer logs are not Tauri bundle resources.

## Before building

1. Update the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Run `npm ci`.
3. Run `npm audit --omit=dev` and `npm run test:ci`.
4. Run `npm run release:check`. This rebuilds the frontend and rejects source maps, database files, private keys, absolute user paths, captured-device paths and known development-device identifiers.

## Local Windows build

From a Developer PowerShell with Node.js, Rust, WebView2 and the Microsoft C++ desktop workload installed:

```powershell
npm run build:desktop
```

Installers are written below `src-tauri/target/release/bundle/`. Test the installer and uninstall flow on a machine or Windows Sandbox that has never run RushLink; an existing development profile is never embedded in the installer but can make a local smoke test look pre-populated.

## macOS builds

Apple Silicon and Intel builds must run on macOS. The `Build RushLink desktop release` workflow builds both architectures on GitHub-hosted macOS runners and creates a draft prerelease containing the `.dmg` artifacts.

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
4. Verify the marketing site's `data-repository` remains `matcygal/RushLink-Releases`. Keep the proprietary source repository private.
5. Deploy GitHub Pages and verify the Downloads panel and release count against the published release.

Do not upload `reference/`, `coverage*`, `test-results/`, `playwright-report/`, `dist/` or the complete `src-tauri/target/` directory. Upload only the installer assets produced below the platform bundle directories.
