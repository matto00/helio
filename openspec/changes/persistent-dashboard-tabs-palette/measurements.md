# Measurements - HEL-1575

## 1. `GET /api/dashboard-changes` queries: EXPLAIN (ANALYZE, BUFFERS) on the dev database (task 2.3)

Method. Dev database `helio` (Flyway at V134), PostgreSQL via `psql` as a superuser that then ran
`SET LOCAL ROLE hel1575_explain` (a throwaway `NOSUPERUSER NOBYPASSRLS` role, SELECT-only, dropped afterwards), with
`app.current_user_id` set to the user under test, so RLS policies evaluate exactly as for the app pool.
Seeded: one dashboard, 12 panels each bound to its own Output (12 pipelines/sources/outputs), 600 `output_snapshot_history`
rows per Output (7,200 rows), one `resource_permissions` row granting a second user the **dashboard only** (no pipeline
grant). Every seeded row was removed by exact id afterwards (history, permission, panels, dashboard, outputs,
pipelines, sources, both users); row counts were re-checked back to the pre-seed baseline (1137 history rows, 2725
dashboards) and the role was dropped. The two queries are the exact ones in `DashboardChangesRepository`.

| Caller                 | Query   | Execution time (cold, then warm) | Plan facts                                                                                                                                   |
| ---------------------- | ------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                  | content | 1.352 ms, 0.104 ms               | `dashboards_pkey` index scan, panels via `panels_dashboard_id_idx`                                                                           |
| Owner                  | data    | 1.087 ms, 0.230 ms               | `outputs_pkey` x12, then `idx_output_snapshot_history_output_captured` x12, **1 row per Output**, `Index Searches: 12`                       |
| Dashboard-only grantee | content | 0.129 ms, 0.089 ms               | same index scans                                                                                                                             |
| Dashboard-only grantee | data    | 0.161 ms, 0.158 ms               | `outputs` filter `helio_can_access_pipeline` removed all 12 Outputs; the LATERAL history probe is **`never executed`** (`Index Searches: 0`) |

All four are under the 20 ms bound (worst: 1.35 ms cold). Owner: history is read through the
`(output_id, captured_at DESC)` index with `LIMIT 1`, so 12 index probes, never a walk of the 7,200 rows
(`Buffers: shared hit=72` for the 12 probes). Grantee: the access function runs once per joined `outputs` row
(`Rows Removed by Filter: 1` per loop) and never against a history row, so there is no per-history-row access-function
evaluation.

### Owner data query plan (second run)

```
                                                                                     QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Nested Loop Left Join  (cost=20.86..29.15 rows=1 width=82) (actual time=0.151..0.221 rows=12.00 loops=1)
   Buffers: shared hit=186
   ->  Unique  (cost=20.58..20.59 rows=1 width=74) (actual time=0.140..0.142 rows=12.00 loops=1)
         Buffers: shared hit=114
         ->  Sort  (cost=20.58..20.58 rows=1 width=74) (actual time=0.140..0.140 rows=12.00 loops=1)
               Sort Key: p.dashboard_id, p.output_id
               Sort Method: quicksort  Memory: 26kB
               Buffers: shared hit=114
               ->  Nested Loop  (cost=4.57..20.57 rows=1 width=74) (actual time=0.026..0.135 rows=12.00 loops=1)
                     Buffers: shared hit=114
                     ->  Bitmap Heap Scan on panels p  (cost=4.29..12.00 rows=1 width=74) (actual time=0.017..0.062 rows=12.00 loops=1)
                           Recheck Cond: (dashboard_id = ANY ('{cf75b89a-2509-462b-a072-8a0405cb81d3}'::text[]))
                           Filter: helio_can_access_dashboard(dashboard_id)
                           Heap Blocks: exact=4
                           Buffers: shared hit=42
                           ->  Bitmap Index Scan on panels_dashboard_id_idx  (cost=0.00..4.29 rows=2 width=0) (actual time=0.003..0.003 rows=12.00 loops=1)
                                 Index Cond: (dashboard_id = ANY ('{cf75b89a-2509-462b-a072-8a0405cb81d3}'::text[]))
                                 Index Searches: 1
                                 Buffers: shared hit=2
                     ->  Index Scan using outputs_pkey on outputs ot  (cost=0.28..8.55 rows=1 width=37) (actual time=0.006..0.006 rows=1.00 loops=12)
                           Index Cond: (id = p.output_id)
                           Filter: helio_can_access_pipeline(pipeline_id)
                           Index Searches: 12
                           Buffers: shared hit=72
   ->  Limit  (cost=0.28..8.55 rows=1 width=8) (actual time=0.006..0.006 rows=1.00 loops=12)
         Buffers: shared hit=72
         ->  Index Scan using idx_output_snapshot_history_output_captured on output_snapshot_history  (cost=0.28..8.55 rows=1 width=8) (actual time=0.006..0.006 rows=1.00 loops=12)
               Index Cond: (output_id = p.output_id)
               Filter: helio_can_access_pipeline(pipeline_id)
               Index Searches: 12
               Buffers: shared hit=72
 Planning:
   Buffers: shared hit=13
 Planning Time: 0.093 ms
 Execution Time: 0.230 ms
```

### Dashboard-only grantee data query plan (first run)

```
 Nested Loop Left Join  (cost=20.86..29.15 rows=1 width=82) (actual time=0.152..0.153 rows=0.00 loops=1)
   Buffers: shared hit=150
   ->  Unique  (cost=20.58..20.59 rows=1 width=74) (actual time=0.152..0.153 rows=0.00 loops=1)
         Buffers: shared hit=150
         ->  Sort  (cost=20.58..20.58 rows=1 width=74) (actual time=0.152..0.153 rows=0.00 loops=1)
               Sort Key: p.dashboard_id, p.output_id
               Sort Method: quicksort  Memory: 25kB
               Buffers: shared hit=150
               ->  Nested Loop  (cost=4.57..20.57 rows=1 width=74) (actual time=0.151..0.152 rows=0.00 loops=1)
                     Buffers: shared hit=150
                     ->  Bitmap Heap Scan on panels p  (cost=4.29..12.00 rows=1 width=74) (actual time=0.018..0.073 rows=12.00 loops=1)
                           Recheck Cond: (dashboard_id = ANY ('{cf75b89a-2509-462b-a072-8a0405cb81d3}'::text[]))
                           Filter: helio_can_access_dashboard(dashboard_id)
                           Heap Blocks: exact=4
                           Buffers: shared hit=66
                           ->  Bitmap Index Scan on panels_dashboard_id_idx  (cost=0.00..4.29 rows=2 width=0) (actual time=0.003..0.003 rows=12.00 loops=1)
                                 Index Cond: (dashboard_id = ANY ('{cf75b89a-2509-462b-a072-8a0405cb81d3}'::text[]))
                                 Index Searches: 1
                                 Buffers: shared hit=2
                     ->  Index Scan using outputs_pkey on outputs ot  (cost=0.28..8.55 rows=1 width=37) (actual time=0.006..0.006 rows=0.00 loops=12)
                           Index Cond: (id = p.output_id)
                           Filter: helio_can_access_pipeline(pipeline_id)
                           Rows Removed by Filter: 1
                           Index Searches: 12
                           Buffers: shared hit=84
   ->  Limit  (cost=0.28..8.55 rows=1 width=8) (never executed)
         ->  Index Scan using idx_output_snapshot_history_output_captured on output_snapshot_history  (cost=0.28..8.55 rows=1 width=8) (never executed)
               Index Cond: (output_id = p.output_id)
               Filter: helio_can_access_pipeline(pipeline_id)
               Index Searches: 0
 Planning:
   Buffers: shared hit=13
 Planning Time: 0.081 ms
 Execution Time: 0.161 ms
(34 rows)
```

## Warm vs cold tab switch on a 12-panel dashboard (task 8.2)

Spec: `e2e/hel1575-switch-measurement.spec.ts` (opt-in, `HEL1575_MEASURE=1`; it asserts nothing, so it never runs in the default e2e glob). Run with `HEL1575_MEASURE=1 DEV_PORT=7007 HELIO_PLAYWRIGHT_WORKERS=1` against `start-servers.sh` on this worktree's ports.

**Method.**

- A freshly registered test user whose tier was set to `owner` by exact id (the owner tier, so no tier cap applies). The user is removed by the run's global teardown.
- Dashboard X has 12 Output-bound table panels (one pipeline, 12 table Outputs of 100 rows, laid out 3 across so every body is on screen at 1440 x 1600). Dashboard Y is a small filler. Both are open as tabs.
- Time zero is the click on X's tab. The stop is the first animation frame at which all 12 panel bodies hold table cells and no body skeleton remains. Both are read inside the page with `performance.now()`, so no test-runner round trip is in the figure.
- Cold: the page is loaded on Y with the browser-stored warm copy deleted (IndexedDB `helio-warm`), so X has nothing to restore; then X's tab is clicked. This is the panel list, 12 metadata reads and 12 row reads.
- Warm: X was shown, left for Y, and clicked again within the TTL.
- Five iterations of each; the median is reported. The spec waits out the 60 s `/api` rate-limit window before each iteration (see below).

**Numbers** (local dev build: Vite dev server, React StrictMode on, backend and PostgreSQL on localhost):

| Switch | Runs (ms)                  | Median |
| ------ | -------------------------- | ------ |
| Cold   | 651, 525, 615, 599, 675    | 615 ms |
| Warm   | 287, 297, 282, 353, 342    | 297 ms |

Warm saves about 320 ms (about 52%) here, and the saving is network time only: on localhost a request costs a few milliseconds, so against the deployed backend the cold figure would carry the round-trips of the 25 requests (the list, 12 metadata reads, 12 row reads) and the gap would be larger. The warm 297 ms is the cost of mounting 12 data grids of 100 rows in a dev build, not waiting. "Warm makes no request" is asserted separately in `hel1575-dashboard-tabs.spec.ts` (panel-list and rows request counts of zero).

**Rate limit.** A first attempt without the waits failed: 8 of 12 panel bodies had no data (the one inspected showed "Rate limit exceeded"). One cold load of this dashboard is about 50 requests (panel list, per-panel metadata, rows and assertion status, run reads), the general `/api` limit is 120 per 60 s window per user, and API seeding by the same user shares the window. A user cold-loading two or three such dashboards inside a minute can hit it, which is one more reason a warm return (no requests) is worth having. This is existing behaviour and is not changed here.

**An in-session warm return after a run shows the previous rows briefly before refreshing.** When a pipeline run completes while the user is on another tab, returning to the tab restores the warm panels and rows immediately and the cards then reconcile the run and request fresh rows, so the old rows are visible for that moment. This is the existing HEL-1392 remount behaviour (a remounted card shows its held window and reconciles afterwards); this change does not alter it. A run that completes while the tab is active does not void warmth (the return makes no panel-list or rows request), proven by `a run while the tab is active, then leave and return within the TTL: still warm`.
