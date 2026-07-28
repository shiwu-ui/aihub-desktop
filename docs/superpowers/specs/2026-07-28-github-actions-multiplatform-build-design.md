# GitHub Actions Multiplatform Build Design

## Goal

Build AIHub Desktop on GitHub-hosted native runners whenever a commit is pushed to `main`. Produce downloadable, unsigned Actions artifacts for Windows x64, Linux x64, and macOS x64/arm64. Release creation and tag-triggered publishing are outside this change.

## Workflow

Add `.github/workflows/build.yml` with a `push` trigger restricted to `main` and a manual `workflow_dispatch` trigger for recovery and verification. Use separate native jobs so platform-specific Electron Builder tooling runs on its supported operating system:

- `windows-latest`: build x64 portable and NSIS executables.
- `ubuntu-latest`: build an x64 AppImage.
- `macos-latest`: build separate x64 and arm64 DMG files.

Each job checks out the exact commit, installs the Node version declared by the workflow, restores npm's download cache, runs `npm ci`, invokes Electron Builder with an explicit platform and architecture, and uploads only the expected distributable files. Artifacts use platform and architecture in their names and have a bounded retention period. Jobs do not share mutable build output.

## Package Configuration

Keep the existing Windows targets and installer behavior. Extend Electron Builder configuration with:

- Linux AppImage target and a stable artifact name containing version and architecture.
- macOS DMG target and a stable artifact name containing version and architecture.
- Cross-platform product metadata that no longer describes the application as Windows-only.

The existing `sidecars` directory contains documentation rather than bundled executables, so it does not introduce architecture-specific binary requirements. The application remains unsigned because no Windows or Apple signing credentials are available. The workflow must not contain placeholder secrets or the previously exposed GitHub token.

## Failure Behavior

Any dependency installation or packaging failure fails its platform job. Artifact upload runs only after a successful build and fails when the expected files are absent, preventing a green workflow with missing deliverables. Independent jobs make platform failures visible without hiding successful results from other platforms.

## Verification

Before pushing, validate the workflow YAML and package JSON, inspect the resulting diff, and run the project's relevant smoke tests. After pushing, verify the first Actions run for commit, branch, job matrix, conclusions, and uploaded artifact names. A successful result requires all four jobs and all four artifact groups to be present:

- Windows x64
- Linux x64
- macOS x64
- macOS arm64

## Follow-up Scope

Repository About metadata, Wiki expansion, signed builds, notarization, and automatic GitHub Releases remain separate follow-up changes.
