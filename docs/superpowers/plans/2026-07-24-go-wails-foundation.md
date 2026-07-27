# AIHub Desktop Go/Wails Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a clean, testable Wails v2 + Go application shell in `D:\bot\desktop-app-go` without changing the existing Electron application.

**Architecture:** Wails owns the Windows window and WebView2 bridge. Go owns the application lifecycle and all future business services behind small interfaces. The TypeScript frontend is only a presentation layer and has no credentials, filesystem access, or direct network access.

**Tech Stack:** Go 1.26.5, Wails v2.13.0, WebView2, TypeScript, Vite, Windows DPAPI in later phases, absolute tool paths under `D:\dev`.

## Global Constraints

- The new project lives at `D:\bot\desktop-app-go`; the existing `D:\bot\desktop-app` is read-only reference material during this phase.
- Runtime core and all business logic are Go; TypeScript/HTML/CSS is limited to the Wails presentation layer.
- The future proxy listens on `127.0.0.1` only; no public or LAN listener.
- Only normal AIHub user endpoints are allowed; `/admin` and unregistered routes must be rejected.
- AIHub user Keys are the only Key source; local state is only a runtime pool view, health state, and user-selected group IDs.
- Never commit passwords, access tokens, refresh tokens, complete API Keys, or GitHub tokens.
- Use `D:\dev\go\bin\go.exe`, `D:\dev\nodejs\node.exe`, `D:\dev\nodejs\npm.cmd`, and `D:\dev\git\cmd\git.exe`; do not depend on the system `PATH`.
- Use TDD for exported Go behavior and run focused tests after every task.

---

## Sub-project Roadmap

The approved design contains independent subsystems. Execute them in this order, with a separate plan and review gate for each:

1. This plan: Wails/Go foundation and frontend shell.
2. `2026-07-24-aihub-user-api.md`: user authentication, token refresh, endpoint allowlist, and DPAPI storage.
3. `2026-07-24-client-config.md`: Codex/OpenCode detection, backup, switch, rollback, and direct-connect restoration.
4. `2026-07-24-aihub-pool.md`: group/Key synchronization, lowest-rate scheduling, cooling, and remote group clearing.
5. `2026-07-24-retry-proxy.md`: HTTP/SSE forwarding, pre-first-byte retries, Retry-After, and cancellation.
6. `2026-07-24-ui-migration-release.md`: page migration, monitoring UI, tray lifecycle, packaging, and release verification.

Do not implement proxy behavior or remote Key deletion in this foundation phase.

## File Map

- Create `D:\bot\desktop-app-go\go.mod`: module declaration and pinned Wails dependency.
- Create `D:\bot\desktop-app-go\main.go`: Wails startup wiring only.
- Create `D:\bot\desktop-app-go\app.go`: minimal bindable application boundary.
- Create `D:\bot\desktop-app-go\app_test.go`: unit tests for that boundary.
- Create `D:\bot\desktop-app-go\wails.json`: Wails build configuration.
- Create `D:\bot\desktop-app-go\frontend\package.json`: frontend scripts and pinned dependencies.
- Create `D:\bot\desktop-app-go\frontend\index.html`: WebView entry document.
- Create `D:\bot\desktop-app-go\frontend\src\main.ts`: Wails bridge call.
- Create `D:\bot\desktop-app-go\frontend\src\ui.ts`: pure DOM renderer.
- Create `D:\bot\desktop-app-go\frontend\src\ui.test.ts`: renderer smoke test.
- Create `D:\bot\desktop-app-go\frontend\src\style.css`: initial work-focused shell styling.
- Create `D:\bot\desktop-app-go\tools\verify-foundation.ps1`: deterministic local verification.
- Create `D:\bot\desktop-app-go\.gitignore`: build and secret exclusions.
- Create `D:\bot\desktop-app-go\README.md`: prerequisites and exact commands.

The files under `D:\bot\desktop-app\src` remain unchanged.

### Task 1: Create the isolated Wails project

**Files:**
- Create: `D:\bot\desktop-app-go\go.mod`
- Create: `D:\bot\desktop-app-go\wails.json`
- Create: `D:\bot\desktop-app-go\.gitignore`
- Create: `D:\bot\desktop-app-go\README.md`

**Interfaces:**
- Produces module `github.com/shiwu-ui/aihub-desktop`.
- Produces Wails project `aihub-desktop-go`.
- No existing Electron source is imported.

- [ ] **Step 1: Create the target directory and initialize Wails**

~~~powershell
New-Item -ItemType Directory -Force -Path 'D:\bot\desktop-app-go' | Out-Null
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\go\bin\go.exe' run github.com/wailsapp/wails/v2/cmd/wails@v2.13.0 init -n aihub-desktop-go -t vanilla-ts
~~~

Expected: Wails creates `main.go`, `app.go`, `frontend`, and `wails.json` under the new directory only.

- [ ] **Step 2: Pin the Go module**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\go\bin\go.exe' mod edit -module github.com/shiwu-ui/aihub-desktop
& 'D:\dev\go\bin\go.exe' get github.com/wailsapp/wails/v2@v2.13.0
& 'D:\dev\go\bin\go.exe' mod tidy
~~~

Expected: `go.mod` contains `github.com/wailsapp/wails/v2 v2.13.0` and `go.sum` exists.

- [ ] **Step 3: Replace the generated ignore rules**

~~~gitignore
bin/
build/bin/
dist/
*.exe
*.log
.env
.env.*
!.env.example
node_modules/
frontend/dist/
frontend/.vite/
coverage/
~~~

Add a README stating that development uses Go 1.26+, Wails 2.13.0, WebView2, and the absolute tools under `D:\dev`.

- [ ] **Step 4: Verify the generated baseline**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\go\bin\go.exe' test ./...
~~~

Expected: PASS with all generated packages compiling.

- [ ] **Step 5: Create the first local commit**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\git\cmd\git.exe' init -b main
& 'D:\dev\git\cmd\git.exe' add .
& 'D:\dev\git\cmd\git.exe' commit -m 'chore: scaffold Go Wails desktop app'
~~~

Expected: one local commit and no staged credential file.

### Task 2: Define the minimal Go application boundary

**Files:**
- Modify: `D:\bot\desktop-app-go\app.go`
- Modify: `D:\bot\desktop-app-go\main.go`
- Create: `D:\bot\desktop-app-go\app_test.go`

**Interfaces:**
- Produces `NewApp(version string) *App`.
- Produces bindable `Health() HealthStatus`.
- The frontend receives only `status` and `version`.

- [ ] **Step 1: Write the failing test**

~~~go
package main

import "testing"

func TestHealthReturnsReadyStatus(t *testing.T) {
	app := NewApp("0.1.0")
	got := app.Health()
	if got.Status != "ready" || got.Version != "0.1.0" {
		t.Fatalf("Health() = %#v, want ready/0.1.0", got)
	}
}
~~~

- [ ] **Step 2: Run the test and confirm failure**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\go\bin\go.exe' test ./... -run TestHealthReturnsReadyStatus -count=1
~~~

Expected: FAIL because `NewApp`, `Health`, and `HealthStatus` do not exist.

- [ ] **Step 3: Implement `app.go`**

~~~go
package main

import "context"

type HealthStatus struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

type App struct {
	version string
	ctx     context.Context
}

func NewApp(version string) *App {
	return &App{version: version}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) Health() HealthStatus {
	return HealthStatus{Status: "ready", Version: a.version}
}
~~~

- [ ] **Step 4: Implement `main.go`**

~~~go
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

const version = "0.1.0"

func main() {
	app := NewApp(version)
	err := wails.Run(&options.App{
		Title:     "AIHub Desktop",
		Width:     1280,
		Height:    820,
		MinWidth:  980,
		MinHeight: 680,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 245, G: 246, B: 248, A: 1},
		OnStartup:       app.startup,
		Bind:            []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
~~~

- [ ] **Step 5: Run focused and complete Go tests**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\go\bin\go.exe' test ./... -run TestHealthReturnsReadyStatus -count=1
& 'D:\dev\go\bin\go.exe' test ./...
~~~

Expected: both commands PASS.

- [ ] **Step 6: Commit the Go boundary**

~~~powershell
& 'D:\dev\git\cmd\git.exe' add app.go main.go app_test.go
& 'D:\dev\git\cmd\git.exe' commit -m 'feat: add minimal Go application boundary'
~~~

### Task 3: Replace the demo frontend with a typed shell

**Files:**
- Modify: `D:\bot\desktop-app-go\frontend\package.json`
- Modify: `D:\bot\desktop-app-go\frontend\index.html`
- Modify: `D:\bot\desktop-app-go\frontend\src\main.ts`
- Create: `D:\bot\desktop-app-go\frontend\src\ui.ts`
- Create: `D:\bot\desktop-app-go\frontend\src\ui.test.ts`
- Modify: `D:\bot\desktop-app-go\frontend\src\style.css`

**Interfaces:**
- Consumes the generated Wails `Health()` binding.
- Produces pure `renderHealth(root, health)`.
- Makes no direct HTTP call and imports no Node runtime API.

- [ ] **Step 1: Add the frontend test dependencies and scripts**

Use these scripts in `frontend/package.json` while preserving Wails-generated runtime dependencies:

~~~json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest --environment jsdom"
  },
  "devDependencies": {
    "jsdom": "26.1.0",
    "typescript": "5.7.3",
    "vite": "6.1.0",
    "vitest": "3.2.4"
  }
}
~~~

- [ ] **Step 2: Write `src/ui.test.ts`**

~~~typescript
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHealth } from './ui'

describe('renderHealth', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>'
  })

  it('renders the product, readiness, and version', () => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) throw new Error('missing app root')

    renderHealth(root, { status: 'ready', version: '0.1.0' })

    expect(root.textContent).toContain('AIHub Desktop')
    expect(root.textContent).toContain('ready')
    expect(root.textContent).toContain('0.1.0')
  })
})
~~~

- [ ] **Step 3: Install and run the test to confirm failure**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go\frontend'
& 'D:\dev\nodejs\npm.cmd' install
& 'D:\dev\nodejs\npm.cmd' test -- --run
~~~

Expected: FAIL because `renderHealth` is not defined.

- [ ] **Step 4: Implement `src/ui.ts`**

~~~typescript
export type HealthStatus = {
  status: string
  version: string
}

export function renderHealth(root: HTMLElement, health: HealthStatus): void {
  root.innerHTML = [
    '<div class="app-shell">',
    '  <header class="app-header">',
    '    <strong>AIHub Desktop</strong>',
    '    <span class="status" data-status="' + health.status + '">' + health.status + '</span>',
    '  </header>',
    '  <main class="workspace" aria-label="AIHub workspace">',
    '    <h1>AIHub Desktop</h1>',
    '    <p>Version ' + health.version + '</p>',
    '  </main>',
    '</div>',
  ].join('')
}
~~~

- [ ] **Step 5: Implement `src/main.ts`**

~~~typescript
import './style.css'
import { Health } from '../wailsjs/go/main/App'
import { renderHealth } from './ui'

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('missing #app')
  const health = await Health()
  renderHealth(root, health)
}

void boot()
~~~

Use an `index.html` containing only document metadata, `<main id="app"></main>`, and the Vite module script. Style the shell as a restrained operational interface with a fixed header height and accessible status contrast.

- [ ] **Step 6: Run frontend tests and build**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go\frontend'
& 'D:\dev\nodejs\npm.cmd' test -- --run
& 'D:\dev\nodejs\npm.cmd' run build
~~~

Expected: PASS and `frontend/dist/index.html` exists.

- [ ] **Step 7: Re-run Go tests and commit**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\go\bin\go.exe' test ./...
& 'D:\dev\git\cmd\git.exe' add frontend
& 'D:\dev\git\cmd\git.exe' commit -m 'feat: add typed Wails frontend shell'
~~~

### Task 4: Add deterministic foundation verification

**Files:**
- Create: `D:\bot\desktop-app-go\tools\verify-foundation.ps1`
- Modify: `D:\bot\desktop-app-go\README.md`

**Interfaces:**
- Produces one local verification command.
- Does not log in, call AIHub, start a listener, or use a GitHub token.

- [ ] **Step 1: Create `tools\verify-foundation.ps1`**

~~~powershell
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$required = @(
  'go.mod',
  'wails.json',
  'app.go',
  'app_test.go',
  'frontend\package.json',
  'frontend\dist\index.html'
)

foreach ($relative in $required) {
  $path = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required foundation file: $relative"
  }
}

Push-Location -LiteralPath $root
try {
  & 'D:\dev\go\bin\go.exe' test ./...
  if ($LASTEXITCODE -ne 0) { throw 'Go tests failed' }

  Push-Location -LiteralPath (Join-Path $root 'frontend')
  try {
    & 'D:\dev\nodejs\npm.cmd' test -- --run
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed' }

    & 'D:\dev\nodejs\npm.cmd' run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

Write-Output 'foundation verification passed'
~~~

- [ ] **Step 2: Run the verification script**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& '.\tools\verify-foundation.ps1'
~~~

Expected: `foundation verification passed`.

- [ ] **Step 3: Build the Windows application**

Wails invokes frontend child tools by name, so set its child-process path from the known absolute tool directories before invoking Go:

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
$env:Path = 'D:\dev\nodejs;D:\dev\go\bin;' + $env:Path
& 'D:\dev\go\bin\go.exe' run github.com/wailsapp/wails/v2/cmd/wails@v2.13.0 build -clean -platform windows/amd64
~~~

Expected: a Windows executable appears under `build\bin` and opens the health shell.

- [ ] **Step 4: Scan tracked files for credential patterns**

~~~powershell
Set-Location -LiteralPath 'D:\bot\desktop-app-go'
& 'D:\dev\git\cmd\git.exe' grep -n -I -E 'ghp_|sk-[A-Za-z0-9]{16,}'
~~~

Expected: no credential match.

- [ ] **Step 5: Commit verification**

~~~powershell
& 'D:\dev\git\cmd\git.exe' add README.md tools
& 'D:\dev\git\cmd\git.exe' commit -m 'test: verify Go Wails foundation build'
~~~

## Self-review

- Spec coverage: foundation, Go boundary, TypeScript boundary, tool paths, packaging isolation, and credential exclusions are covered. User API, client config, pool, proxy, and release are intentionally separate plans.
- Placeholder scan: there is no hidden implementation step or unresolved design choice in this phase.
- Type consistency: Task 2 defines `HealthStatus`, `App`, `NewApp`, and `Health()`; Task 3 consumes the generated binding with matching field names.
