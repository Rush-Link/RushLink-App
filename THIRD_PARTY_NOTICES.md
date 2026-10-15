# Third-party notices

RushLink's license does not replace the licenses of its dependencies, fonts or
third-party content. Keep the relevant copyright and license notices when
redistributing them.

## Bundled fonts

The unmodified font files in `public/fonts/` use the SIL Open
Font License 1.1:

| Font | Copyright | License text |
| --- | --- | --- |
| Inter | Copyright 2020 The Inter Project Authors | [OFL-Inter.txt](public/fonts/OFL-Inter.txt) |
| Manrope | Copyright 2018 The Manrope Project Authors | [OFL-Manrope.txt](public/fonts/OFL-Manrope.txt) |

The font license texts accompany the runtime font files. No Bahnschrift font
binary is distributed; the RushLink wordmark is stored as vector outlines.

## JavaScript runtime dependencies

These licenses were checked against the installed package manifests and license
files. `package-lock.json` records exact package versions, including transitive
dependencies. Each package's own license text is included in its npm package.

| Package or family | Declared license |
| --- | --- |
| React and React DOM | MIT |
| Radix UI (`@radix-ui/react-dialog`, `react-slot`, `react-switch`, `react-tabs`) | MIT |
| Tauri API and dialog, filesystem and opener plugins | Apache-2.0 OR MIT |
| `class-variance-authority` | Apache-2.0 |
| `clsx` | MIT |
| `lucide-react` | ISC; portions derived from Feather retain their MIT notice |
| `tailwind-merge` | MIT |
| Zustand | MIT |

Lucide's license credits Lucide Contributors and Cole Bemis for the
Feather-derived portions. Preserve both notices in `lucide-react/LICENSE` when
redistributing its icons.

## Native runtime dependencies

These declarations were checked against the local Cargo registry manifests.
`src-tauri/Cargo.lock` records the exact resolved crates and their transitive
dependencies; each crate distribution carries its license files.

| Crate or family | Declared license |
| --- | --- |
| Tauri, `tauri-build`, dialog, filesystem and opener plugins | Apache-2.0 OR MIT |
| `serde`, `serde_json`, `reqwest`, `futures-util`, `url` | MIT OR Apache-2.0 |
| Tokio and `tokio-tungstenite` | MIT |

This table covers direct dependencies. The native dependency tree also includes
components under other terms, including:

- `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext` and `selectors`:
  MPL-2.0.
- ICU4X crates and related Unicode data: Unicode-3.0.
- `webpki-roots`: CDLA-Permissive-2.0.
- `ring`: Apache-2.0 AND ISC, including its component notices.

The [license texts and source-package links](licenses/README.md) include the
MPL-2.0 text and identify the resolved MPL components. This audit checked the
locally installed npm packages and available Cargo registry sources. Some
platform-specific locked crates were not installed on the audit machine;
their license and binary-distribution requirements still need checking for
each release target.

Preserve the license and notice texts for the resolved transitive dependencies
and any platform runtime in a distribution, and provide corresponding source
where its license requires it. The dependency tables are a source-level summary,
not a complete license inventory for every platform's compiled release. Build
and test tools also retain their own licenses; they are not relicensed by
RushLink.

## Vendored build tooling

The Android [Gradle Wrapper notice](src-tauri/gen/android/gradle/wrapper/NOTICE.md)
identifies the vendored wrapper and preserves its launch-script attribution.
The full [Apache License 2.0](licenses/Apache-2.0.txt) accompanies these files.

## External content and names

HeadRush and inMusic names and marks belong to their respective owners.
RushLink is an unofficial project and is not affiliated with or endorsed by
HeadRush or inMusic. Cygma Audio and RushLink branding remains subject to any
applicable trademark rights.

The repository does not include the HeadRush Remote Editor vendor bundle,
downloaded vendor artwork, copied manuals, private device captures, or the
historical third-party browser extension. External tone models, impulse
responses and catalogue artwork remain subject to their creators' terms.
Displaying or accessing them through a device does not grant redistribution
rights. Do not add these files to a contribution without permission and the
required notices.
