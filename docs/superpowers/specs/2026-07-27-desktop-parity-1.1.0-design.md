# AIHub Desktop 1.1.0 User Feature Parity Design

## Goal

Bring the existing Node/Electron desktop application to practical parity with the current ordinary-user workflows on `aihub.top`, correct the incomplete 1.0.7 failover and invoice behavior, remove subscription functionality, and ship version 1.1.0 without adding dependencies.

## Product Boundaries

The desktop application remains a client of AIHub's official ordinary-user APIs. AIHub continues to execute routing, failover, billing, payment, email delivery, and account security decisions on the server.

Included:

- API key lifecycle, advanced restrictions, failover policy, search, filters, pagination, usage metadata, endpoint copy/test, and client-configuration handoff.
- Usage analytics, detailed request logs, compact failover audit logs, CSV export, and IP region lookup.
- Invoice eligibility and application history.
- Dashboard, provider hall, recharge orders, affiliate details, account profile, email change, low-balance notification, and the complete eight-section tutorial.
- Version 1.1.0 packaging for portable and NSIS installer targets.

Excluded:

- A separate channel-status page. The provider hall remains the desktop monitoring surface.
- Subscriptions, plans, and package purchasing. AIHub will use recharge only.
- LinuxDo, DingTalk, OIDC, WeChat, or other third-party account binding.
- Enabling, disabling, or enrolling two-factor authentication. Existing login-time 2FA verification remains supported.
- Error-request logs while the current site keeps that user feature disabled.
- Administrator APIs and local model-request proxying.

## Architecture

Keep the existing Electron main process, preload bridge, renderer route functions, and authenticated `window.aihub.request()` flow. Do not add packages or rewrite the application in another framework.

The renderer continues to use `src/renderer/app.js` and `src/renderer/fluent.css`. New pure helpers are added near the features they serve so smoke tests can verify serialization and presentation behavior without introducing a broad renderer refactor.

The main-process allowlist remains explicit. Existing `/keys`, `/usage`, `/user`, `/payment`, `/invoices`, `/groups`, and `/announcements` prefixes cover the required API calls. Do not add `/channel-monitors` because the separate channel-status page is excluded.

## Navigation And Versioning

- Change the application and package version to `1.1.0`.
- Remove the `plans` navigation entry and all subscription rendering and `/subscriptions/*` requests.
- Redirect a stale internal `plans` route to `billing` so saved UI state cannot open a blank page.
- Keep recharge, orders, invoices, redeem, affiliate, account, tutorial, changelog, and about routes.
- Update README output names, release notes, in-app changelog, screenshots, tests, and package metadata to 1.1.0.

## API Key Management

### Policy Semantics

Use the server enum values without translation changes:

- `manual`: ordered candidate groups.
- `lowest_rate`: lowest multiplier first, excluding selected groups.
- `fastest`: fastest first-token response first, excluding selected groups.
- `sticky`: natural recovery after the primary group becomes stably healthy.
- `prefer_primary`: return to the primary group as soon as it leaves cooldown.
- `manual_only`: remain on the fallback group until the user changes configuration.

Desktop labels must be:

- `按我选择的分组顺序`
- `按最低倍率优先`
- `按最快首字优先`
- `自然回切（推荐）`
- `积极回主`
- `不自动回切`

Manual candidates use explicit up/down icon controls. Their visible order is the exact submitted `failover_group_ids` order. The primary group is removed from candidates and exclusions whenever it changes.

### Advanced Fields

Create and update requests support the site's current fields:

- `use_custom_key` and `custom_key`
- `ip_whitelist` and `ip_blacklist`
- `quota`
- `max_rate_multiplier`
- `rate_change_notify_enabled`
- all failover fields
- `rate_limit_5h`, `rate_limit_1d`, and `rate_limit_7d`
- `expires_at` or the server-supported create-time expiration representation

Secret values are never written to source, logs, screenshots, history, or persisted desktop state.

### Key List

Add server-backed search, group/status filters, page-size selection, pagination, and column visibility. Display current concurrency, today usage, 30-day usage, and expiration when returned by the API.

Show the current default and image API endpoints with copy actions and HTTPS-only speed-test links. A `Configure client` action opens the existing client configuration route with the selected key preselected; it does not duplicate CC Switch logic.

## Failover Audit Presentation

Retain the `Usage details` and `Failover` tabs, shared date/key/model filters, refresh, and pagination.

Replace the 11-column desktop table with the site's compact six-column structure:

1. API key
2. Model
3. Group switch (`source -> target`)
4. Multiplier change (`source -> target`)
5. Switch reason
6. Time

The reason cell stacks strategy, recovery mode, reason, `health_class`, active-probe state, and upstream status. Clicking a row opens a detail view containing every raw field. Unknown enum values display unchanged.

At compact widths, each record becomes a stable two-row layout without page-level horizontal overflow.

## Invoice Eligibility

`GET /invoices/eligible-orders` is an eligibility listing, not a list in which every item is actionable.

- Display every returned recharge order with its amount, completion time, and status.
- `applied=true` displays `Already applied` and cannot reopen the form.
- `eligible=true` and `applied=false` displays the apply command.
- Other rows display `Amount below 300` or the server-provided raw eligibility reason and cannot submit.
- Only an actionable row can set `payment_order_id` in `POST /invoices`.
- Paginate both recharge eligibility and invoice application history.
- Preserve email normalization, byte-length validation, and refresh both lists after success.

## Usage Analytics And Logs

Use the official `/usage` API family.

The usage overview gains:

- selectable date range and day/hour granularity;
- model, group, and inbound-endpoint distributions;
- Token trend;
- actual and standard cost comparison.

Detailed request records add reasoning effort, inbound endpoint, IP address and region, group, request type, billing type, billing mode, input/output/cache tokens, multiplier, billed/original cost, first-token time, duration, and created time when returned by the API.

Filters cover API key, model, group, request type, billing type, and billing mode. CSV export uses the same visible semantic fields, protects spreadsheet-formula prefixes, and retains the existing 5,000-row upper bound.

IP lookup supports an individual refresh and a bounded batch operation. Failures leave the original IP visible and do not prevent the rest of the log page from rendering.

## Dashboard And Provider Hall

The dashboard keeps the existing eight headline metrics and announcements, then adds:

- platform breakdown;
- model distribution;
- recent usage;
- quick actions for creating a key, opening usage, opening failover logs, and redeeming a code.

The provider hall remains the only channel-health surface. Add sorting by multiplier, fastest first token, and availability. Allow the trend column to switch among first-token time, TPS, and input tokens while retaining 6h/24h/7d/30d windows and `Use this group`.

## Recharge And Orders

Keep recharge as the only purchase workflow. Continue to use official AIHub payment APIs and HTTPS payment pages.

The existing order table gains status filtering, page-size selection, and full pagination through `/payment/orders/my`. Pending-order verify/cancel behavior remains unchanged.

Remove subscription plans, active-subscription summaries, and website subscription purchase links.

## Account And Affiliate

Account features included in the native page:

- avatar upload with static-image compression to the site's current size limit;
- avatar removal;
- username update;
- primary-email verification-code flow;
- low-balance email-notification enablement and settings;
- password change and revoke-all-sessions.

Do not render third-party binding controls. Do not render 2FA enrollment controls while the site reports the feature unavailable.

Affiliate adds separate copy commands for the invitation code and invitation URL, plus the site's available per-invitee rebate details. Transfer-to-balance behavior remains server-controlled.

## Tutorial

Keep eight chapters matching the public `/tutorial` route:

1. Node.js environment installation
2. API key advanced features
3. CCS one-click import
4. Claude Code
5. Codex
6. Gemini CLI
7. AIHubRouter
8. Community tools

Add the site's Windows/macOS/Linux or WSL variants where relevant, complete ordered steps, copyable commands, and current official HTTPS links. Examples use `<AIHUB_API_KEY>` and never contain live credentials.

## Error Handling

- A failed optional dashboard or analytics request renders an error state for that section without hiding independent data.
- Form validation prevents invalid payloads before network requests.
- Server messages are used when safe and otherwise fall back to concise Chinese messages.
- Unknown enums and eligibility reasons display their raw value.
- Authentication refresh and logout behavior remain centralized in the existing main-process request bridge.
- No page calls administrator endpoints.

## Testing

Follow red-green-refactor for each behavior group.

- Extend the key smoke test for advanced fields, exact enum labels, primary-group exclusion, and candidate reordering.
- Extend the invoice smoke test with eligible, ineligible, and already-applied orders.
- Extend the failover smoke test for the six-column layout, health class, details, and compact viewport behavior.
- Add focused usage parity tests for distributions, filters, detailed fields, CSV safety, and IP lookup failure isolation.
- Add account tests for avatar limits, email verification requests, low-balance notification, and absence of third-party/2FA controls.
- Update dashboard, provider, payment/order, affiliate, guide, navigation, version, and installer contracts.
- Run every registered smoke test, then capture 1280x820 and 980x680 screenshots for all materially changed views.
- Build both NSIS and portable 1.1.0 artifacts and verify their PE and embedded ASAR versions.

## Delivery And Security

- Do not install or update dependencies.
- Do not persist passwords, API keys, GitHub tokens, cookies, invoice details, or other secrets.
- Commit only reviewed source, tests, documentation, and project history.
- Push the completed source to `origin/main` using transient authentication without storing credentials in the remote URL or Git configuration.
- Use the configured domestic Electron and electron-builder mirrors for packaging.
