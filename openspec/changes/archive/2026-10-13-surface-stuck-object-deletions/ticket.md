# HEL-1531: Surface stored_object_deletions rows stuck at the attempt cap

## Description

origin_kind: followup
origin_ticket: HEL-1434

HEL-1434's drain (`StoredObjectDeletionService`) retries a failed object delete with exponential backoff, from 60 s up to a 1 h cap, and stops after 10 attempts. A row at the cap stays queued forever. Each failure is logged, but nothing alerts when a row reaches the cap. Both skeptic gates flagged this as non-blocking.

Options:

* log a distinct ERROR or metric when a row reaches the cap;
* include the stuck count in an existing health or admin view;
* re-arm stuck rows after a long cool-down.

Probe: `select count(*) filter (where attempts >= 10) as stuck, count(*) as queued from stored_object_deletions;`.

Triage note: `triage-followup.sh` recommended fold-in (small, high overlap). It was filed standalone because HEL-1434's execution budget was exhausted, with one extra cycle already granted, and both gates had passed.

## Context

- Queue introduced by HEL-1434 (V128, archive `2026-10-12-delete-blobs-with-rows`); extended by HEL-1530 (V132, archive `2026-10-13-remove-form-and-conversation-blobs`): dataset-row and conversation triggers, deferral via `not_before` (hourly hold for copy-only keys), new-style rows with `claimed_at = 'infinity'`.
- The surfacing mechanism is a product call, escalated to the owner (see Owner Decision below once resolved).

## Owner Decision (escalation 2026-10-13, recorded via chat from the main root)

1. **admin-view**: add stuck/queued counts to the owner-only `GET /api/admin/usage` totals; change the frontend adminUsage types and contract to match; follow the HEL-1211/HEL-1420 rules (owner tier only, aggregates only, no identifiers); update the schema in `schemas/`; keep the existing per-failure WARN unless evidence says otherwise.
2. **rearm-24h**: re-arm a stuck row 24 h after its last attempt.

## Acceptance Criteria

- `GET /api/admin/usage` `totals` carries live, non-null `storedObjectDeletionsQueued` and `storedObjectDeletionsStuck` counts (stuck = attempts at the drain's cap), owner-only, with no key / source table / row id in the body, on both the rolled-up and not-rolled-up paths.
- `schemas/admin/admin-usage-response.schema.json`, the frontend `AdminUsageTotals` type, fixture and contract test match; the admin usage totals card shows both counts.
- A row at the cap is re-armed 24 h after its last attempt (attempts reset, normal backoff), for both legacy (V128) and new-style (V132) rows; new-style rows keep `claimed_at = 'infinity'`; the reference check still applies.
- The per-failure WARN log is unchanged.
- Tests prove the count fires at the cap and not below it, the re-arm boundary, and the counts under the production role shape.
