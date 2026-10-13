## Why

The stored-object deletion queue (HEL-1434, V128; extended by HEL-1530, V132) stops retrying a row after 10 failed
storage deletes. Such a row then stays queued forever, its object leaks, and nothing shows it: each failure is only a
WARN line. The owner ruled (HEL-1531 escalation, 2026-10-13) that stuck rows are surfaced in the owner admin view and
re-armed after a 24 h cool-down.

## What Changes

- `GET /api/admin/usage` `totals` gains two identifier-free counts: queue rows waiting for deletion, and rows stuck at
  the attempt cap. They are live counts, independent of `days`, and are returned whether or not anything has been
  rolled up.
- `schemas/admin/admin-usage-response.schema.json`, the frontend `AdminUsageTotals` type, fixture and contract test
  change to match; the admin usage page's all-time totals card shows both counts.
- The deletion drain re-arms a row at the attempt cap once 24 h have passed since its last attempt: its attempt
  count resets and it is retried under the normal backoff. The reference guard still runs on every claim, so a
  re-armed row can never delete a referenced object.
- The existing per-failure WARN log stays unchanged; no new ERROR log (the owner chose the admin view, not a log).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `owner-usage-admin`: the `totals` object and the totals card include the stored-object deletion queue counts.
- `stored-object-lifecycle`: a row at the attempt cap is re-armed after a 24 h cool-down instead of staying stuck.

## Impact

- Backend: `StoredObjectDeletionRepository` (count + re-arm statements), `StoredObjectDeletionService` (re-arm step),
  `AdminUsageService` / `AdminUsageProtocol` / `ApiRoutes` wiring.
- API: additive fields on an owner-only endpoint; `schemas/admin/admin-usage-response.schema.json`.
- Frontend: `features/adminUsage` types, fixture, contract test, `UsageTotals`.
- No migration (no new column or index; V134 stays free).

## Non-goals

- No ERROR log, metric, alert policy or notification on reaching the cap.
- No per-row detail (keys, owners, source tables) anywhere in the API.
- No change to the attempt cap, backoff formula, lease, or the derived-copy deferral.
