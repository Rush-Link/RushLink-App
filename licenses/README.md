# Third-party license texts

These texts apply to the named third-party components, independently of
RushLink's own [LICENSE](../LICENSE). They do not change the license of other
code in this repository.

- [Apache-2.0.txt](Apache-2.0.txt) is the unmodified Apache License 2.0 from
  <https://www.apache.org/licenses/LICENSE-2.0.txt>. It accompanies the vendored
  Gradle Wrapper and may also be used by dependencies with that license.
- [MPL-2.0.txt](MPL-2.0.txt) is the unmodified license included in the locally
  resolved `cssparser` 0.36.0 crate. The following Cargo dependencies declare
  MPL-2.0. Their upstream source packages include their original authorship and
  source notices; those notices must remain with any copied or modified source.

| Crate version in Cargo.lock | Authors declared by the crate | Corresponding source package |
| --- | --- | --- |
| `cssparser` 0.36.0 | Simon Sapin | [Source](https://crates.io/api/v1/crates/cssparser/0.36.0/download) |
| `cssparser-macros` 0.6.1 | Simon Sapin | [Source](https://crates.io/api/v1/crates/cssparser-macros/0.6.1/download) |
| `dtoa-short` 0.3.5 | Xidorn Quan | [Source](https://crates.io/api/v1/crates/dtoa-short/0.3.5/download) |
| `option-ext` 0.2.0 | Simon Ochsenreither | [Source](https://crates.io/api/v1/crates/option-ext/0.2.0/download) |
| `selectors` 0.36.1 | The Servo Project Developers | [Source](https://crates.io/api/v1/crates/selectors/0.36.1/download) |

These libraries are resolved from Cargo rather than copied into the source
tree. Recheck this list and the applicable source packages when updating
`src-tauri/Cargo.lock`. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for
font notices, other dependency terms and the scope of this summary.
