## Why

HEL-1027 shipped server-side "contains"/quick-term filtering on `GET /api/outputs/:id/rows`.
HEL-915's owner-ruled per-panel controls (date range, dropdown, numeric range) need `gte`/`lte`/
`eq`/`in`, plus a per-Output capability contract so a panel only offers controls the Output can
actually answer — derived from the Output's real data, not column type alone (two same-typed
Outputs may legitimately differ), and a capped, frequency-ordered distinct-values read to power
dropdowns.

## What Changes

- Extend `GET /api/outputs/:id/rows`'s `filter` param with an `ops` array: `eq`/`in` (list,
  ≤100 values)/`gte`/`lte`, alongside HEL-1027's unchanged `quick`/`columns` contains shape.
  Values are always JSON strings, cast via the existing `safe_numeric`/`safe_timestamptz` (V111)
  on both sides of the comparison — a malformed value degrades to "no match," never a 500.
- New `GET /api/outputs/:id/filter-capabilities`: per-column operator list, computed from the
  Output's declared schema (type-based `contains`/`gte`/`lte`) plus an actual-data cardinality
  check (`eq`/`in`, capped) — the single source of truth the rows endpoint's own `ops` validation
  also calls, so the two can't drift. Cost is one full Output-row scan per Structured column (no
  functional index is feasible for an arbitrary per-Output column) — stated explicitly, with a
  named near-term caching mitigation, in design.md D7; not free, but bounded and one-time per load.
- New `GET /api/outputs/:id/distinct-values?column=`: capped, frequency-ordered distinct values
  for one column, gated on the same contract's `eq`/`in` eligibility. Ownership-checked
  (`outputRepo.findById`, same ACL as `/rows`).
- Update `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` §3 to record the
  owner's 2026-09-29 re-scope (server-refetch only; Recompute dropped for v0.8; dashboard
  variables deferred to v0.9/HEL-1192).

## Capabilities

### Modified Capabilities

- `output-routes-api`: `GET /api/outputs/:id/rows` gains `gte`/`lte`/`eq`/`in` filter operators;
  two new routes (`filter-capabilities`, `distinct-values`) added under the same Output-scoped ACL
  surface.

## Impact

`backend/src/main/scala/com/helio/services/pipelines/{OutputRowsQuery,OutputService}.scala`,
`.../OutputFilterCapability.scala` (new), `backend/.../persistence/pipelines/NodeSnapshotRepository.scala`,
`backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala`, V112 migration only if
needed (none currently anticipated — reuses V111's `safe_numeric`/`safe_timestamptz`),
`schemas/outputs/*.schema.json`, `openspec/specs/output-routes-api/spec.md`,
`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`. No frontend changes
(out of scope — leaves 2-4).

## Non-goals

Any UI/frontend wiring (HEL-1189/1190/1191/1193); `{{var}}` pipeline-parameter recompute (dropped
by owner re-scope); dashboard-wide variables (HEL-1192, v0.9); a public/anonymous route variant
for `filter-capabilities`/`distinct-values` (deferred to HEL-1190 — see design.md).
