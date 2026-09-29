# HEL-1188: Output filter capability contract: range/equals/in-list operators + distinct-values endpoint

## Description

Leaf 1 of HEL-915 (re-scoped 2026-09-29 with the owner, see the epic). Backend foundation for per-panel output controls.

### Why

HEL-1027 shipped server-side filtering on `GET /api/outputs/:id/rows`, but only as per-column "contains" text matching plus a quick term (`OutputRowsQuery.FilterParam(quick, columns: Map[String, String])`). Controls need date range, numeric range, dropdown (equals / in-list) and text. The owner also ruled that the controls a panel offers must derive strictly from what THIS Output can actually be filtered by: a capability contract, not column type alone. Two Outputs with the same data types may legitimately offer different controls.

## Scope

1. **Operators.** Extend the rows filter with `gte`/`lte` (range, on number and date/timestamp columns), `eq`, and `in` (list), alongside HEL-1027's existing contains/quick term. Keep HEL-1027's guarantees: the whole Output is filtered before offset/limit, the filtered `total` drives `hasMore`, user-supplied column names and values are bound parameters, never interpolated, and non-filterable columns get a defined 400. Typing comes from the Output's declared schema (never row-0 inference, MISTAKES.md). Reuse HEL-1027's safe-cast functions (V111).
2. **Capability contract.** A read API that says, per column of an Output, which operators are allowed (and so which control kinds are valid). Candidate: extend the existing node-capabilities endpoint `GET /api/pipelines/:id/capabilities` / `capabilitiesAtNode`, which is already used for panel binding. Driver claim, verify: that it's the right home. Decide and justify in design.md.
3. **Distinct values** (merged in from the draft's separate leaf, owner ruling): a capped top-N-by-frequency distinct-values read for one column, offered only where the contract allows `eq`/`in`. Enforce ownership. Decide whether public dashboards need it here or in the viewer leaf (they need dropdown options for public viewers, via the optional-auth public route tree).
4. **Spec amendment:** update `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` §3 to record the owner's 2026-09-29 re-scope: per-panel controls, server refetch only, "Recompute" dropped for v0.8, dashboard variables deferred to v0.9.

## Acceptance criteria

* On an Output larger than one page, a range filter on a date column and an `in` filter on a text column narrow the whole Output; `total`/`hasMore` describe the filtered set. Red-first against current main.
* The capability contract lists exactly the operators the rows endpoint will accept for each column, and a request using an operator the contract doesn't declare is rejected with a defined 400 (test both directions: the contract and the endpoint can't drift).
* The distinct-values read is capped, ordered by frequency, ownership-checked, and refused for columns without `eq`/`in`.
* A hostile column name or value can't alter the SQL (test).
* The performance of range/in on large snapshots is stated (index needed or not).
* Schemas/openspec contract updated in the same change.

## Out of scope

Any UI (leaves 2-4), recompute/`{{var}}` pipeline parameters (dropped), dashboard-wide variables (v0.9).

## Owner decisions (via the driver, recorded on HEL-915)

- Per-panel controls, server refetch only, NO recompute. Dashboard variables deferred to v0.9 (HEL-1192).
- Rigidity: the controls/options a panel offers derive strictly from what THIS Output can be filtered by (the capability contract), not from column type alone. Two Outputs with the same column types may legitimately differ. The contract and the rows endpoint must not be able to drift: test both directions.
- Dropdown options = capped top-N-by-frequency distinct values, only where the contract allows eq/in.

## Driver notes (claims to verify, not facts)

- HEL-1027 (merged a4dbd83c) built the base: `OutputRowsQuery.scala` (`FilterParam(quick, columns: Map[String,String])`, contains-only), `NodeSnapshotRepository` sort/filter SQL with the `nodeFilterFragment` helper, V111 safe-cast functions (`safe_numeric` IMMUTABLE sql, `safe_timestamptz` STABLE plpgsql), typing from the Output's DECLARED schema (never row-0 inference), bound parameters for every user-supplied column/value. Read its archived change dir (`openspec/changes/archive/2026-09-28-server-side-sort-filter-output-rows/`, design D1-D10) before designing.
- `capabilitiesAtNode` (`PipelineService.scala:~1228`, `GET /api/pipelines/:id/capabilities`) is keyed by pipeline + step (a NODE), while controls attach to an OUTPUT. Decide in design.md whether the contract belongs there or on an Output-scoped read, and justify it.
- Public dashboards (optional-auth `PublicDashboardRoutes`) will need dropdown options for anonymous viewers in HEL-1190. Decide here whether the distinct-values read gets a public variant, and check the ownership/RLS path. `listRows*` runs under `withSystemContext` (RLS-bypassing), so the ownership check is the only gate: prove it.
- `scripts/check-node-root-encoding.mjs` is CI-only (not pre-commit) and allowlists `NodeSnapshotRepository.scala` lines BY LINE NUMBER (HEL-1186 tracks fixing that). If touching that file, run `npm run check:node-root-encoding` + `:selftest` + `:ts` + `:ts:selftest` locally before every gate, and add no new ambiguous `node_step_id IS NULL` arm.
- Migrations: V112 is the next free number.

## Iron laws

- Red-first: a test on an Output larger than one page where range/in filtering FAILS on current main, then passes. Guard tests must be failable by mutation; show it.
- The evaluator must make its checks discriminating: reproduce the pre-fix behaviour on the base commit before accepting the fix.
- A hostile column name/value test.
- Hardware cap: 6c/12t desktop. Any loop or parallel workload runs at <=3-4 workers under `nice -n 19`.
