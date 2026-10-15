# Testing

Most tests do not need HeadRush hardware. Unit/integration tests use jsdom and mocked services; Chromium journeys use the browser demo. These checks verify application behavior, not the pedal's DSP or every native WebView.

## Choose checks for your change

| Change | Useful checks |
| --- | --- |
| Domain rules or store behavior | The adjacent Vitest tests, then the wider unit suite when needed. |
| UI behavior or styles | Relevant component tests and Playwright journeys; inspect Dark/Light and affected viewport sizes. |
| Native transport | `npm run test:native` and a native build with the required system packages. |
| Packaging or assets | `npm run release:check` and the affected platform build. |
| Documentation only | `npm run check:repo`, then check commands and claims against the current source; installers are unnecessary. |

Run focused tests while iterating:

```sh
npx vitest run src/domain/nam.test.ts --maxWorkers=2
npx playwright test e2e/multiple-nam.spec.ts --workers=2
```

## Frontend and browser checks

```sh
# Repository hygiene and local documentation links
npm run check:repo
# Unit and jsdom integration tests
npm test -- --maxWorkers=2
# TypeScript checks and production bundle
npm run build
# Install the pinned browser once
npx playwright install chromium
# Chromium journeys; starts the local server automatically
npm run test:e2e -- --workers=2
```

The development-server browser suite uses `http://127.0.0.1:1420`. Stop a conflicting server or ensure it serves the same checkout. Use `npm run test:e2e:production -- --workers=2` to build and exercise the production bundle when investigating lazy-loaded styles or asset delivery. `npm run test:phone` and `npm run test:tablet` run the responsive subsets with bounded browser workers.

Coverage and order checks are available separately:

```sh
npm run test:coverage -- --maxWorkers=2
npm run test:coverage:all -- --maxWorkers=2
npm run test:stability -- --maxWorkers=2
npm run test:stability:ci
```

`vitest.config.ts` gates the deterministic core at 92% statements, 95% lines, 95% functions and 75% branches. `vitest.all.config.ts` includes the wider executable frontend with a regression floor of 84% statements, 91% lines, 76% branches and 79% functions.

The whole-app floor and core statement floor were rebaselined against measured Vitest 4 V8 reports when upgrading the test tooling. AST source remapping changed the reported coverage, so earlier percentages are not directly comparable. The gates retain their executable source scope and behavior tests; the other core thresholds remain unchanged. For later changes, preserve the regression floors and add meaningful behavior tests rather than changing the denominator to pass. `test:stability:ci` replays two fixed shuffled orders to catch shared-state coupling.

## Native and release checks

```sh
npm run test:native
npm run release:check
```

Native tests exercise bridge address validation, route confinement and device capability handling. They require the platform's Tauri system dependencies. `release:check` builds the frontend and checks shipped files/icons for forbidden development material. It does not build or publish installers.

The [quality workflow](../.github/workflows/quality.yml) runs repository hygiene, release-payload verification, native tests, whole-app coverage, fixed shuffled orders and Chromium journeys on pull requests and main-branch pushes. `npm run test:ci` runs the corresponding checks locally and requires both the native toolchain and Playwright browser.

Reports go to ignored `coverage/`, `coverage-all/`, `playwright-report/` and `test-results/`. Inspect the first failure and its browser trace before repeating broad suites. Keep reports and local screenshots out of source commits.

## Hardware verification

Automated browser tests and Android emulation do not establish real-device discovery, MIDI support, model allocation, audio quality or saving behavior. For hardware results, record the app commit, platform, HeadRush model/firmware, exact setup, observed readback and restoration result. Separate observations from assumptions.

Normal automated tests use simulated device responses. For physical-device work, read [DEVICE-API.md](DEVICE-API.md) and [HEADRUSH-5.2.0.md](HEADRUSH-5.2.0.md), use a backed-up device you control, and plan how to restore changed state. Share only minimal sanitized evidence; keep tokens, user content, raw captures and third-party model/audio files out of issues and fixtures.
