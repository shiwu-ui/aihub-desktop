# AIHub Site Feature Parity Design

## Goal

Bring the Node/Electron desktop app up to date with the current ordinary-user capabilities on `aihub.top`: complete API key failover policy controls, rate-change email notification, failover audit logs, self-service invoices, and the current eight-section tutorial.

The app remains a client of AIHub's official APIs. It does not proxy model traffic, choose upstream accounts, or execute failover locally.

## Decision

Use native desktop pages backed by the existing authenticated request bridge.

Alternatives considered:

1. Link every new feature to the website. This is low effort but does not meet the desktop parity requirement.
2. Embed authenticated website pages. This duplicates authentication and increases session, CSP, navigation, and trust-boundary risk.
3. Add native controls and pages. This matches the existing application, keeps the ordinary-user API allowlist explicit, and is testable without real credentials. This is the selected approach.

## API Key Policy

The create/edit dialog will persist the site's current fields through `POST /keys` and `PUT /keys/:id`:

- `max_rate_multiplier`: non-negative number; `0` means unlimited.
- `rate_change_notify_enabled`: boolean.
- `failover_enabled`: boolean.
- `failover_strategy`: `manual`, `lowest_rate`, or `fastest`.
- `failover_group_ids`: ordered candidate groups for `manual`.
- `failover_excluded_group_ids`: excluded groups for automatic strategies.
- `failover_recovery_mode`: `sticky`, `prefer_primary`, or `manual_only`.

The UI uses segmented controls for strategy and recovery mode, toggles for binary settings, and compact group selectors. The primary group is always excluded from both candidate and exclusion lists. Candidate order is explicit and can be moved with arrow controls.

The explanatory copy states that AIHub performs failover only before semantic output and bases eligibility on real usage samples, provider monitoring, and an active probe after both preceding signals agree.

## Failover Logs

The existing request log page gains a two-mode segmented control: request logs and failover logs. Failover mode calls:

```text
GET /usage/failovers?page&page_size&start_date&end_date&model&api_key_id
```

It supports date, model, and API key filters. Rows display key, model, source and target groups, source and target multipliers, strategy, recovery mode, reason, health class, active-probe marker, upstream status, and time. Unknown enum values fall back to their raw value.

## Self-Service Invoices

A new account navigation item opens a native invoice page backed by:

```text
GET /invoices/eligible-orders
GET /invoices/my
POST /invoices
```

The page explains the current service contract: a single completed recharge of at least 300 is eligible, duplicate applications are rejected, content is "研发服务", and delivery is by email in about 1-3 business days.

The form submits `payment_order_id`, `company_title`, `tax_number`, and normalized `email`. Company title is limited to 200 characters, tax number to 64, and normalized email text to 255 UTF-8 bytes. Multiple addresses may be separated by Chinese/English commas, semicolons, or whitespace. The desktop does not add invoice file download because the current user flow delivers externally by email.

## Tutorial

Replace the old six-card desktop tutorial with the site's current eight sections:

1. Node.js environment installation
2. API key advanced features
3. CCS one-click import
4. Claude Code configuration
5. Codex configuration
6. Gemini CLI configuration
7. AIHubRouter
8. Community tools

The desktop version keeps commands copyable and links official external resources through the existing HTTPS-only external-link bridge. It uses the site's current examples but treats model recommendations as documentation content rather than application defaults.

## Security And Boundaries

- Add only `/invoices` to the main-process ordinary-user allowlist; `/keys` and `/usage` are already allowed.
- Do not store account passwords, GitHub tokens, invoice details, or model API keys in source, tests, screenshots, or project history.
- Tests use synthetic keys, invoice data, and failover events.
- No administrator route is allowed or called.
- No new dependency is required.

## Testing

- Extend the provider/key smoke test to verify all policy controls and submitted fields.
- Add a failover-log smoke test with mocked filtering, pagination, enum display, health probe, and upstream status.
- Add an invoice-flow smoke test covering eligible orders, multiple-email normalization, submission payload, and application status.
- Update the guide contract smoke test to assert the eight current chapters and absence of the obsolete six-section wording.
- Run all existing smoke tests after focused tests pass.

## Release And Delivery

Keep the existing Electron and Node dependency versions. The work will be committed without secrets and pushed to `origin/main`. Project history will record source/config changes, verification, build activity if performed, and the final push.
