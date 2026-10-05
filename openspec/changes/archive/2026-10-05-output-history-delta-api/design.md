## Context

L1 (merged `1606ba8c`) left `OutputHistoryRepository` with `listRecent(outputId, limit)` (newest first, `id DESC`
tiebreak), `nearestAtOrBefore(outputId, at)` and `earliest(outputId)`. All run on the privileged pool, with the caller
authorizing first through `OutputRepository.findById`, which is sharing-aware purely via RLS (`withUserContext`, V94
`outputs_select`). `ApiRoutes.outputHistoryRepoOpt` is already wired. The stored `summary` (v1) is
`{v, rowCount, columns, columnsTruncated, metric: {field, agg, value} | null, series | null}` from
`OutputSummaryReducer`.

Constraints: `OutputService.scala` is already 469 lines and `PublicDashboardRoutes.scala` is 463, so new logic goes in
new files. spray-json omits `None` (MISTAKES.md). Parallel lanes L2/L8 touch `Main`, scheduler and alerts.

## Goals / Non-Goals

Goals: one resolution routine shared by both routes, a strict wire shape with explicit nulls, compare validated on
every config write path, and a statement count independent of history size. Non-goals: see proposal.md.

## Decisions

**D1 Compare grammar.** A pure `OutputCompare` (domain) parses `previous_run | 1d | 7d | 30d | custom:<d>` into
`PreviousRun | Window(java.time.Duration)`. `<d>` must match `^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$`
with at least one component (bare `P`/`PT` rejected), and is then parsed with `Duration.parse` inside a `Try`, so an
overflowing digit run is a 400, never a 500. It must be > 0 and ≤ 365 days (the owner tier's
max retention, D4, so a longer window can never have a baseline). The regex comes first because `Duration.parse`
alone accepts lowercase and signed forms. W/M/Y are rejected because month/year are calendar-relative and have no
fixed duration. `1d` etc. are fixed 24h multiples, which is fine because captured_at is a UTC instant. Absent and JSON
`null` both mean "no comparison". Alternative rejected: `java.time.Period`, which mixes calendar semantics into an
instant-based window.

**D2 Where validation runs.** `OutputService.validateConfig(kind, config)` = existing `validateFieldMapping`, then
`OutputCompare.validateConfig`. It replaces the bare `validateFieldMapping` calls in `OutputService.create`, `update`
(on the merged config) and `PatchSetPreviewProjection.outputUpdateAfter`, so preview and apply agree (HEL-1239's
invariant). In `PipelineService`, the compare check goes inside the private `validateOutputFieldMapping` (before its no-fieldMapping early return, so it
always runs), which is shared by
single-call create (`buildOutputsAction`) and proposal grounding (`resolveOneProposalOutputAnalysis`). One hunk covers
both, so a bad compare is rejected at propose time, not only at apply. This is a small hunk outside this lane's owned
files, needed because otherwise `POST /api/pipelines` and proposals would carry an unvalidated compare. `PatchSetUndoService` re-inserts a previously persisted config
and is left alone. Patch-set apply routes through `OutputService.update`, so it is covered.

**D3 Resolution and query plan.** A new `OutputHistoryService(outputRepo, historyRepo)` exposes
`forOutput(output, config, limit, since)` (no ACL; used by the public route after its gate) and
`read(id, user, limit, since)`, which runs `outputRepo.findById` (404 on None) and `findConfigById`, then
`forOutput`. `forOutput` issues (empty history: step 1 only, and every resolved field is `null`):
1. `listRecent(id, max(limit, 2))`. The head is `current`, and the second element is the `previous_run` baseline.
   `points` = the first `limit` elements filtered to `capturedAt >= since`. Because newest-first order makes the
   `>= since` set a prefix, this equals "newest `limit` points since `since`" with no new query.
2. For a window only: `nearestAtOrBefore(id, current.capturedAt − w)`. The target is measured from the latest
   point, not wall-clock now (D6).
3. Only when a window baseline is missing: `earliest(id)`, giving `availableFrom = earliest + w`. For
   `previous_run` with fewer than two points, `availableFrom` is `null`, because no date can be promised.

Bound: authenticated = 5 repository calls. In executed JDBC statements, the two `withUserContext` calls are each
`set_config` + select (2 each) and the three `withSystemContext` calls are 1 each, so the bound is ≤ 7. Public:
`findAllByDashboardId` + `findByIdInternal` + `findConfigsByIdsInternal` + 3 history + the ACL directive's own lookups,
enumerated for an anonymous caller on a publicly shared dashboard as AclDirective owner resolution 1 +
`hasPublicViewerGrant` 1 + `findAllByDashboardId` count+slice 2 + 1 + 1 + 3 = 9 (a `?token=` caller adds the token
validator's lookups and is not part of the bound). Scope: counting starts at the route with an already-resolved
caller (the spec constructs `OutputRoutes`/`PublicDashboardRoutes` directly, as `OutputRoutesSpec` does), so session
authentication, which precedes every route and is history-independent, is excluded. Counting mechanism: a counting `DataSource`/`Connection`/
`Statement` proxy (the pattern in L1's `OutputHistoryCostMeasurementSpec`) wraps BOTH the app and privileged pools of
a dedicated `OutputHistoryQueryCountSpec`, which counts `execute*` calls for one request at 3 points vs 150 points. A stored compare that fails to parse (only possible for rows written
outside the validated paths) resolves as "no comparison" with a WARN log, never a 500.

**D4 Headline value.** `value` = `summary.metric.value` when `summary.v == 1` and it is a JSON number, else `null`.
This is L1's server-computed all-rows headline (D3), exposed unmodified so L5 can switch the headline to it.
Non-metric kinds therefore get `value: null`, while `rowCount` is still present on each resolved point.
`delta = cur − base`, and `pct = delta / |base| × 100` (percent units, e.g. `12.5`). A non-finite result is `null`.

**D5 Wire shape.** A new `OutputHistoryProtocol` with `OutputHistoryResponse(outputId, compare, current, baseline,
delta, pct, availableFrom, sparkline, points)`, `PublicOutputHistoryResponse` (same, minus `outputId`, with
`PublicOutputHistoryPoint(capturedAt, rowCount, summary)`), `OutputHistoryPointResponse(capturedAt, runId,
triggerSource, rowCount, summary)` (named apart from L1's repository `OutputHistoryPoint` to avoid an import clash), `ResolvedHistoryPoint(capturedAt, rowCount, value)` and `SparklinePoint(capturedAt, value)`.
Hand-written `RootJsonWriter`s emit explicit `JsNull` for every nullable field, so schemas can list them as `required`
with `["…","null"]` types. The case classes carry no defaults or nested parens (the drift checker's regex is
not paren-balanced). Schemas: `schemas/outputs/output-history-response.schema.json` and
`public-output-history-response.schema.json`, with a strict `$defs` for the v1 summary, all `additionalProperties:
false`. `create-/update-output-request` schemas document `config.compare`. The public type is an allowlist by
construction: it has no field that could carry a run id or owner id.

**D6 Routes.** `OutputRoutes` gains `path("history")`, plus an optional `OutputHistoryService` constructor param.
`PublicDashboardRoutes` gains `pathPrefix(Segment / "history")` using the existing `resolvePanelOutput` gate, plus an
optional constructor param. Shared `limit`/`since` parsing lives in a new `OutputHistoryQueryParsing`. `ApiRoutes`:
one `outputHistoryServiceOpt` val and two constructor args. `JsonProtocols`: one mixin. `Main` is untouched.

**D7 Access.** History reads stay on the privileged pool behind `findById` (D8 ruling), so the visibility proof is a
NEW `OutputHistoryRoutesSpec` (`OutputRoutesSpec` is ~1950 lines). It copies `OutputRoutesSpec`'s fixture: Flyway, then
`CREATE ROLE … NOSUPERUSER`, `GRANT … ON ALL TABLES` (after Flyway, so it covers `output_snapshot_history`), and the app
pool's `SET ROLE` init SQL. Before any 200/404 assertion, the spec queries `SELECT rolsuper OR rolbypassrls FROM
pg_roles WHERE rolname = current_user` through the app pool (`ApplyProposalSpecBase.appPoolRlsPosture`'s shape) and
asserts `false`. Grantee access is seeded as a real `resource_permissions` row on the pipeline. Owner 200, viewer
grantee 200, and non-grantee 404 byte-identical (status + body) to an unknown id.

**D8 Proof fixtures.** D6 fixtures put the newest point T at now−3d or earlier. Then `now − 7d` and `T − 7d` select
different points (points T−9d, T−8d, T−6d, T: the correct target T−7d selects T−8d, while a now-relative target
now−7d = T−4d selects T−6d). The no-baseline fixture has distinct earliest, earliest+w and current+w. At least one
seam response comes from a real pipeline run through `PipelineRunService`, not a hand-built summary.

## Risks / Trade-offs

- [Thinning makes `previous_run` skip runs] → Documented in schema and spec as "previous retained point" (L1
  divergence).
- [Non-metric Outputs get null deltas] → Intentional for L3. Per-kind chart/table deltas belong to L5's rendering
  decisions. `rowCount` and `summary` are still exposed.
- [`PublicDashboardRoutes` grows past its budget] → Only one route block is added. The split is proposed in the PR
  body rather than done here (behavior-preserving refactors stay separate).
- [Public summary exposes stats/series for every column, not only the panel's control columns] → Consistent with D8
  and with public `rows` already returning every column; stated in the PR body.
- [Response size] → limit ≤ 100 × summary (≤ 20 columns, ≤ 200 series points).
- [Window ≤ 365d may lock out a future longer tier] → Deliberately easy to relax: a single constant.

## Planner Notes

Self-approved: `availableFrom = earliest + window` (D6 says "available from <date>", the date the comparison becomes
possible, not the earliest point). `pct` is in percent units. `limit` out of range is 400, not clamped (HEL-1211
precedent). The PipelineService/PatchSetPreview validation hunks fall outside the named touch list (D2 rationale).
L1 divergences checked against code: `columns.count` is the coercible-cell count (reducer `columnStats`); `root_id` is
NULL for step-bound rows (irrelevant here, because reads key on `output_id`).
