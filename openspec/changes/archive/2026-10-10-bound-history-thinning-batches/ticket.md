# HEL-1435: Output-history thinning DELETE is one unbounded statement: batch it per Output, bound backlog catch-up, and measure on prod-class hardware

## Description

Origin: HEL-1284 (matto00/helio#880, d390a62e, V120). Measurements are in
`openspec/changes/archive/2026-10-09-measure-history-retention-delete-cost/measurements.md`.

Findings (desktop, PG16-proxy plans):

* The thin DELETE is 95–99.9% of the retention tick's cost: 0.79 s at 1k Outputs, ~9.4 s at 10k, 14.7 s all-owner,
  17.8 s for a 7-day backlog. No index helps it. At 5M rows it spills ~600 MB to temp.
* **Disk risk:** a year of un-thinned backlog for 1k Outputs extrapolates to ~20 GB temp, more than prod's 10 GB Cloud
  SQL disk. A long backlog becomes one long transaction.
* The free-tier age purge still reads ~317k rows to delete ~297 at 10k Outputs, because the tier is joined after the
  `captured_at` cutoff.
* Prod-class hardware (shared-core `db-g1-small`, PG16) wasn't measured; a 3–10× slowdown was assumed. At that, the
  120 s lock-retry window is reached at ~10k–30k Outputs.

## Acceptance Criteria

* Rewrite the thin DELETE to be bounded: rank once and batch per Output or per N Outputs, each in its own short
  statement, with `SET LOCAL work_mem` if needed. Show before and after plans, timings and temp usage.
* Bounded catch-up: a backlog is drained over several ticks without a single huge transaction. Prove it on a seeded
  backlog in a scratch DB, never the shared dev DB.
* Measure one tick on prod-class hardware, or justify a proxy, replacing the assumed slowdown.
* Evidence gaps from HEL-1284's gates: commit raw logs for the insert-path and build timings and all EXPLAIN runs, and
  note that the payload "unreferenced" DELETE can't be bounded by an index.

## Driver constraints (from the dispatching driver; claims verified in premise validation)

* Keep every thinning/retention semantic identical (tier age caps, bucket widths, newest-101 protection, lock, retry
  window, payload retention); only HOW the thin executes changes. Prove semantic equivalence: identical surviving rows
  vs the old single statement on the same seeded data (row-by-row diff), plus red/green tests.
* Measure only in a scratch database (never the shared `helio` dev DB), 1–10M rows, `nice -n 19`, abort if host
  available memory drops below ~12 GB; drop scratch artifacts by exact name at the end. No cloud resources, no prod access.
* Next free migration number is V122 if one is needed (none expected).
