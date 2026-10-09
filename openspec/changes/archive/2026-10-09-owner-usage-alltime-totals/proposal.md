## Why

The owner usage page (`/admin/usage`, HEL-1211) only shows a 1..90-day window ending at `rolled_through`. Prod's 8 users
signed up 53-166 days ago, so none appear in the default view and 6 of 8 cannot appear at any setting. The owner asked
(2026-10-09) for all-time headline totals, still identifier-free, plus longer windows.

## What Changes

- `GET /api/admin/usage` gains a `totals` object: `totalUsers` (registered users, excluding the V10 system user),
  `activeLast7Days` and `activeLast30Days` (distinct users with any tracked product event in the trailing 7/30 UTC days
  ending at `rolled_through`; `null` when not computable), and `asOf` (the day the active counts describe).
- New V121 nullable rollup column `product_active_users_daily.monthly_active_users`, written by the existing daily
  rollup (trailing 30-day distinct users; `null` where the window has left raw-event retention).
- `days` accepts 1..365 (was 1..90); out-of-range or non-numeric stays `400`, never clamped. Default stays 30.
- Page: an all-time totals card, window choices 7/30/90/180/365, and a prominent "data through" line explaining the ~2-day
  rollup lag. Active counts are labelled as tracked-event activity, not general app use.
- Contract updated in the same change: response schema, owner-usage-admin spec, CLAUDE.md endpoint line.

## Capabilities

### New Capabilities

### Modified Capabilities
- `owner-usage-admin`: adds all-time totals, widens the `days` range to 1..365, amends "rollups only" to permit one
  identifier-free `users` count, and requires the data-through date to be shown with the lag explained.
- `product-telemetry`: the daily active-users rollup also records a trailing 30-day distinct-user count.

## Impact

Backend: `AdminUsageService`, `ProductUsageRepository`, `ProductEventRepository` rollup, `AdminUsageProtocol`, V121.
Frontend: `features/adminUsage` (types, page, tests). Contract: `schemas/admin/admin-usage-response.schema.json`,
`openspec/specs/owner-usage-admin`, `openspec/specs/product-telemetry`, CLAUDE.md.

## Non-goals

- Any per-user list or identifier (owner ruling: totals only).
- A real "used the app" activity signal (follow-up; `user_sessions.last_seen_at` is never written).
- Deleting or cleaning the system user (HEL-1421).
- Backfilling `monthly_active_users` for already-rolled days (not possible from the migration; see design).
