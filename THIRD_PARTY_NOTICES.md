# Third-Party Notices

AIHub Desktop includes or is intended to include code derived from the following
open-source project:

## CC Switch

- Project: [farion1231/cc-switch](https://github.com/farion1231/cc-switch)
- Version reviewed for integration: `3.17.0`
- License: MIT
- Copyright: (c) 2025 Jason Young

The complete MIT license text is included in
[`licenses/CC-SWITCH-MIT.txt`](licenses/CC-SWITCH-MIT.txt). The copyright notice
and license must remain with all copies or substantial portions of CC Switch
source code, whether shipped in the application archive or as a sidecar.

## Dependencies

CC Switch is a Rust/Tauri and React application. Its transitive dependencies
are declared by the upstream `Cargo.toml`/`Cargo.lock` and `package.json`.
When source or compiled artifacts from those dependencies are redistributed,
their respective license and copyright notices must also be preserved. The
upstream lockfiles are the authoritative dependency inventory; generate a
machine-readable license report as part of release review (for example with
`cargo metadata`/`cargo about` and the JavaScript package manager's license
report) and append the generated notices here or under `licenses/`.

This file does not relicense any dependency. Each dependency remains under its
original license, and the applicable license terms take precedence for that
dependency.

## Source and attribution

The CC Switch source used for integration is available at the project URL
above. Changes made in this application should be documented in the local
release notes while retaining the upstream attribution.
