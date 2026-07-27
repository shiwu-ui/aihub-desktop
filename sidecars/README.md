# CC Switch Core Sidecar

The Electron host reserves the `cc-switch` executable ID for a Rust JSON-RPC
sidecar. The sidecar must speak newline-delimited JSON-RPC 2.0 over stdin/stdout
and implement `hello`, `version`, `capabilities`, `subscribe`, and the CC Switch
command namespaces. It must not open a public TCP port.

The current Windows build contains the safe local configuration engine in
`src/config-service.cjs` and the host-side protocol client in
`src/sidecar-rpc.cjs`. The Rust core requires Rust 1.85+, MSVC v143, and the
Windows SDK to compile; those toolchains are intentionally not bundled in the
portable application.

Do not place an unverified executable here. Release builds must record the
sidecar source revision and SHA-256 in the release notes.
