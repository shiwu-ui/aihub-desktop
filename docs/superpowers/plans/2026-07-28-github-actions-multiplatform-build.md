# GitHub Actions Multiplatform Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build unsigned AIHub Desktop packages on native GitHub-hosted runners after every push to `main` and retain each platform's output as an Actions artifact.

**Architecture:** Electron Builder owns platform packaging metadata in `package.json`; one GitHub Actions workflow runs isolated native jobs for Windows x64, Linux x64, macOS x64, and macOS arm64. A local contract smoke test parses both configuration files and prevents trigger, matrix, target, or artifact regressions.

**Tech Stack:** GitHub Actions, Node.js 22, npm, Electron 36, electron-builder 26, PowerShell/Node smoke tests.

## Global Constraints

- Trigger builds for pushes to `main` and allow `workflow_dispatch`.
- Build Windows x64, Linux x64, macOS x64, and macOS arm64 on native hosted runners.
- Upload unsigned Actions artifacts only; do not add signing secrets or use the exposed GitHub token.
- Do not create GitHub Releases or tag-triggered publishing.
- Preserve the existing Windows portable and NSIS behavior.

---

### Task 1: Build Configuration Contract

**Files:**
- Create: `tools/github-actions-build-contract-smoke.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `package.json` Electron Builder fields and `.github/workflows/build.yml` text.
- Produces: exit code 0 only when the required trigger, runners, architectures, package targets, and artifact upload behavior are present.

- [ ] **Step 1: Write the failing contract smoke test**

Create a Node script using `assert` that verifies `package.json` has Windows portable/NSIS, Linux AppImage, macOS DMG, architecture-aware Linux/macOS artifact names, and that the workflow text contains `main`, all three runner labels, both macOS architectures, `npm ci`, explicit electron-builder commands, and four upload-artifact entries.

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `D:\dev\nodejs\node.exe tools/github-actions-build-contract-smoke.cjs`
Expected: FAIL because `.github/workflows/build.yml` and Linux/macOS package configuration do not exist.

- [ ] **Step 3: Add the npm test script**

Add `"test:github-actions-build": "node tools/github-actions-build-contract-smoke.cjs"` to `scripts`.

### Task 2: Cross-platform Electron Builder Targets

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: electron-builder 26 configuration schema.
- Produces: Windows portable/NSIS, Linux AppImage, and macOS DMG packaging targets with deterministic artifact names.

- [ ] **Step 1: Generalize package metadata**

Change the description from Windows-only wording to `AIHub cross-platform desktop dashboard`.

- [ ] **Step 2: Add Linux and macOS build blocks**

Add `linux.target = ["AppImage"]`, `linux.artifactName = "AIHub-Desktop-${version}-linux-${arch}.${ext}"`, `mac.target = ["dmg"]`, and `dmg.artifactName = "AIHub-Desktop-${version}-mac-${arch}.${ext}"`. Keep the existing Windows blocks unchanged.

- [ ] **Step 3: Validate package JSON**

Run: `D:\dev\nodejs\node.exe -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json valid')"`
Expected: `package.json valid`.

### Task 3: Native GitHub Actions Jobs

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: npm lockfile and Electron Builder configuration from Task 2.
- Produces: four independently downloadable artifact groups.

- [ ] **Step 1: Add workflow triggers and permissions**

Configure `push.branches: [main]`, `workflow_dispatch`, minimal `contents: read`, and cancellation concurrency keyed by workflow and ref.

- [ ] **Step 2: Add four native build jobs**

Each job uses checkout v4, setup-node v4 with Node 22 and npm cache, `npm ci`, then an explicit no-publish Electron Builder command: `--win --x64`, `--linux AppImage --x64`, `--mac dmg --x64`, or `--mac dmg --arm64`.

- [ ] **Step 3: Upload exact distributables**

Use upload-artifact v4 with `if-no-files-found: error`, 14-day retention, and platform/architecture names. Windows includes the portable and Setup EXEs; Linux includes the AppImage; each macOS job includes its architecture-specific DMG.

- [ ] **Step 4: Run the contract smoke test to verify it passes**

Run: `D:\dev\nodejs\node.exe tools/github-actions-build-contract-smoke.cjs`
Expected: `GitHub Actions build contract smoke test passed.`

### Task 4: Regression Verification and Delivery

**Files:**
- Modify: `work/HISTORY.md`

**Interfaces:**
- Consumes: committed workflow and build configuration.
- Produces: pushed `main` commit and verified GitHub Actions results.

- [ ] **Step 1: Run project smoke tests**

Run every existing `test:*` script plus `test:github-actions-build` using `D:\dev\nodejs\npm.cmd`.
Expected: every command exits 0.

- [ ] **Step 2: Review configuration diff**

Run `D:\dev\git\cmd\git.exe diff --check` and inspect `git diff`.
Expected: no whitespace errors and changes limited to the design, plan, workflow, package configuration, contract test, and history record.

- [ ] **Step 3: Commit and push**

Commit implementation as `ci: build desktop app on three platforms`, append a sanitized local history record, and push `main` to `origin`.

- [ ] **Step 4: Verify GitHub Actions**

Open the workflow run for the pushed commit and wait until all four jobs complete. Verify each job conclusion and the Windows x64, Linux x64, macOS x64, and macOS arm64 artifact groups. If a job fails, inspect its logs, fix the scoped cause, push a corrective commit, and repeat verification.
