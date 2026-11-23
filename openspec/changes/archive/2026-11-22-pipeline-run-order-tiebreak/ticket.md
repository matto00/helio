# HEL-1626: Pipeline run-history and latest-run assertions have no id tie-break, so equal timestamps order nondeterministically

## Description

origin_kind: followup
origin_ticket: HEL-1619

Found by the HEL-1619 lane. Both the existing run-history read (`GET /api/pipelines/:id/run-history`) and the new
`GET /api/pipelines/context-details` (latest-run assertions = `run-history[0].assertions`) order by timestamp only. Two
runs with an equal `started_at`, or assertions with equal sort keys, can come back in either order. "Latest run" and
assertion order are then nondeterministic, which can also make the HEL-1619 parity guarantee flaky.

This is a pre-existing gap, not introduced by HEL-1619.

**Fix:** add an `id` tie-break to every ORDER BY that feeds run-history, latest-run and assertion lists, in both reads.
Write a test with two same-timestamp runs that fails first.

## Acceptance Criteria

(Restated by the driver, 2026-11-22; binding.)

- Every query that picks a latest run, or orders runs or assertion results, is enumerated (including HEL-1625
  `context-analyze`, the HEL-1815 run-history route, HEL-1786 `panel-status`, `last_run_*`, and the HEL-1511 stale-run
  reaper). A deterministic tie-break is added wherever the order is observable; the PR lists the reads changed and
  the reads left alone, each with a reason.
- The tie-break direction is chosen deliberately and stated in the PR: run ids are random UUIDs, so `id` makes the
  order deterministic, not "more recent". A better deterministic key is used if one exists, with the reason.
- A failing-first test per read with two same-`started_at` runs (and same-key assertions), committed red before the fix.
- Reads that run under the caller's RLS context are proven on `helio_app_test` (`rolbypassrls = false`).
- The HEL-1619 / HEL-1625 MCP goldens are unchanged.
- No migration unless a measured query plan needs an index (V147 is the next free version).
