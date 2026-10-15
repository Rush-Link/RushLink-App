# Contributing to RushLink

Thank you for helping improve RushLink by Cygma Audio. You can contribute without owning a pedal: the browser demo supports interface work, and most automated tests use simulated device responses.

## Start here

1. Read the [development guide](docs/DEVELOPMENT.md) and start the browser demo with `npm ci` and `npm run dev`.
2. Find the relevant code using the [architecture map](docs/ARCHITECTURE.md).
3. Check [existing issues](https://github.com/Rush-Link/RushLink-App/issues) before opening a bug or proposing a larger change.
4. Fork the repository and create a branch for your change. Keep each pull request focused on one problem.

For a substantial feature or device-protocol change, open an issue first to discuss behavior and evidence. Small fixes and documentation corrections can go straight to a pull request.

## Report a bug

Include the app version or commit, operating system, workspace, steps to reproduce, expected behavior and actual behavior. Say whether it happened in the browser demo or a native build. For device issues, include the HeadRush model and complete firmware version.

Screenshots and sanitized diagnostics help. Review files before attaching them: remove tokens, account details, serial numbers, private network addresses and personal rig names. Never attach a complete local profile, raw device capture, signing key or third-party model/audio file. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

## Make a change

- Follow nearby TypeScript, React and Rust conventions. Keep device-independent rules in `src/domain/`, transport work in `src/services/` or `src-tauri/`, and workflow state in `src/stores/`.
- Prefer capability and metadata checks to guessed firmware behavior. Preserve the 5.1 fallback when adding support for 5.2 controls.
- Use existing UI components and semantic style tokens. Check Dark and Light appearance, keyboard focus, and relevant phone/tablet layouts when changing the interface. Dark remains the default.
- Keep application identifiers, persisted data keys and migrations compatible with existing installations.
- Add a focused regression test when a behavior change needs one. Reuse sanitized fixtures and existing test helpers.
- Update the relevant documentation when setup, supported behavior or a command changes. Commit dependency lockfile changes with intentional dependency updates.

Do not weaken native network restrictions to work around a discovery issue. Use a numeric private IP for local testing and investigate the underlying resolution problem instead.

## Verify your work

Run the smallest meaningful tests while developing, then the checks relevant to your change:

```sh
npm run check:repo
npm test -- --maxWorkers=2
npm run build
npm run test:e2e -- --workers=2
# When the Rust bridge changes:
npm run test:native
```

Install Chromium once with `npx playwright install chromium`. See [TESTING.md](docs/TESTING.md) for focused commands, coverage gates and hardware-test limits. A documentation-only correction does not require building installers.

Hardware verification is separate from automated tests. Read the [device API guide](docs/DEVICE-API.md) and firmware notes, use a backed-up device you control, and report any state restoration problems. A successful HTTP response alone does not verify that a model loaded or that audio behaves correctly.

## Open a pull request

Describe the problem, resulting behavior and checks you ran. Include screenshots for visible changes and distinguish simulated, emulator and physical-device results. State any known limitations or tests you could not run.

Keep generated reports, builds, profiles, credentials and raw device research out of the diff. Preserve copyright, dependency and font notices. Contributions must be yours to submit and compatible with the project's [license](LICENSE).

Treat other contributors respectfully, keep feedback specific to the change, and allow maintainers time to review. Publishing releases and signing packages are maintainer tasks. Website contributions belong in the separate [website repository](https://github.com/Rush-Link/rush-link.github.io).
