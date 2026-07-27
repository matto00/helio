## Context

`WorkspaceContextService.assemble` (HEL-371) builds `dataTypes[]` from `typesPage.items` — structure only,
no values. The row source already exists: `DataTypeRowRepository` stores one JSONB snapshot per
pipeline-output DataType (`overwriteRows`, called only from `PipelineRunService` after a successful run —
source-companion DataTypes never get a row). `DataTypeService.listRows` is the existing owner-scoping choke
point (`findByIdOwned` before touching the repo, which itself runs under `ctx.withSystemContext` with no
RLS of its own) — the same pattern `GET /api/types/:id/rows` already uses. `helio-mcp/src/context.ts` has
no shared runtime with the Scala service; parity today is achieved by independently-duplicated logic plus
tests (`panelCount`, `flattenRowCount`), not shared code.

## Goals / Non-Goals

**Goals:**
- Bounded-by-construction sample rows per pipeline-output DataType: row count and Content-category field
  exclusion enforced at the SQL tier (Postgres never sends bytes the response won't use), column count and
  cell length capped in a pure, unit-testable sanitizer — never truncated only-after-the-full-fetch.
- Same owner-scoping choke point the existing `/rows` endpoint uses — no new RLS surface.
- Backend and MCP produce structurally identical `sampleRows`, verified independently on each side.

**Non-Goals:**
- Column statistics, semantic hints (HEL-373/374).
- Cross-field/global token budgeting (HEL-377) — this ticket's caps are local to `sampleRows` only.
- Redaction/opt-out affordance (Decision D5).

## Decisions

**D1 — Bound at the SQL tier: `LIMIT` for row count, `jsonb` key-stripping for Content-category fields
(round-1 skeptic finding, closed for real — not fetch-then-slice, and not app-level-only truncation).**
`DataTypeRowRepository.listRows` gains `limit: Option[Int] = None` AND `excludeKeys: Set[String] =
Set.empty`. When `excludeKeys` is non-empty the query becomes `SELECT (data - $k1 - $k2 - ...)::text FROM
data_type_rows WHERE data_type_id = $id ORDER BY row_index ASC LIMIT $n` (Postgres `jsonb -
text` top-level-key removal, each key a proper bind param via `sql"..." ++ sql" - $k"` concatenation — no
string-built SQL, no injection surface). `DataTypeService.listRows` forwards both params after
`findByIdOwned`. `GET /api/types/:id/rows` gains optional `?limit=`/`?excludeContentFields=` (boolean; when
true the route computes `excludeKeys` itself from the DataType's own fields via `category`) query params,
additive and backward-compatible — omitting both preserves today's exact unbounded behavior for the one
existing caller. `WorkspaceContextService` calls `dataTypeService.listRows(dt.id, user, Some(5),
excludeKeys = dt.fields.filter(f => contentCategory(f.dataType)).map(_.name).toSet)`; MCP's
`getDataTypeRows(id, limit, excludeContentFields=true)` passes the equivalent query params over the same
route. **Why this had to move to the SQL tier**: round-1 review found `StringBodyType`/`BinaryRefType`
content fields (HEL-217) store up to `TEXT_MAX_FILE_SIZE_BYTES` (10 MB default,
`DataSourceRoutes.scala:40`) of raw text/binary-ref JSON directly in the `data_type_rows` blob
(`PipelineRunService.scala:307-354`'s `jsRows` → `overwriteRows`); a plain `LIMIT 5` with app-level-only
truncation would still pull up to 5 × 10 MB = 50 MB across the wire *before* the 200-char sanitizer ever
ran — bounded on row count only, not the actual worst case. Stripping content keys inside the query means
Postgres never sends those bytes to the app at all. A fetch-then-discard alternative, or a byte-size guard
measured after fetch, both still pay that transfer cost — rejected for the same reason.

**D2 — Sample rows only for `pipelineOutput` DataTypes; no query for source-companions.**
`data_type_rows` is only ever written for a pipeline's output DataType — confirmed via `overwriteRows`'s
two call sites: `PipelineRunService.scala:354` (normal run-success path) and `BoundPanelService.scala:297`
(compensating rollback cleanup, clears rows for a just-created-then-rolled-back output DataType); neither
is ever called with a source-companion DataType id. A source-companion DataType's `listRows` call would
always return empty — skipping the query entirely for `dt.sourceId.isDefined` avoids that guaranteed-empty
round trip, mirroring D5's fan-out-cost discipline from the parent change.

**D3 — Column/cell caps, and the exact non-string-cell truncation algorithm (round-1 gap, now pinned).**
Column projection: (1) filter `dt.fields` to `DataFieldType.category(fromString(f.dataType)) ==
Structured` only — `Content`-category fields (`string-body`/`binary-ref`) are excluded from `sampleRows`
entirely, both at the SQL tier (D1's key-stripping) and, as a defense-in-depth fallback if a key somehow
survives, the projection step; a field whose `dataType` string doesn't parse is conservatively treated as
excluded; (2) of the remaining Structured fields, take the first 40 in `dt.fields` declared order (matches
the design-gate's "500-column DataType" question — also matches the `columns[]` array's own order in the
same entry, so an agent can correlate positionally). Cell truncation, pinned exactly: for any `JsValue` v
whose `v.compactPrint.length > 200`, replace it with `JsString(v.compactPrint.take(200) + "…[truncated]")`
— this applies uniformly regardless of `v`'s original JSON type, so a `JsString` and a stray oversized
non-string value (defensive case only — Structured-category fields are scalars, so this path is expected
to be rare/unreachable in practice, but must still be deterministic) both become a `JsString` on
truncation; both the Scala and TS sanitizers use the literal marker `"…[truncated]"` so the two
implementations can't silently diverge. Worst case per DataType with Content fields fully excluded at the
SQL tier: 5 rows × 40 Structured columns × ~210 bytes ≈ 42 KB, now actually bounded end-to-end (fetch +
output), not just at the output stage. A pure `sanitizeSampleRows(fields, rawRows)` function performs the
column projection + cell truncation so it's unit-testable without a DB fixture per case (oversized string
cell, oversized non-string cell, wide DataType, Content field present, empty snapshot).

**D4 — RLS: no new surface, same choke point as the existing `/rows` endpoint.** Sample rows are fetched
exclusively through `DataTypeService.listRows(id, user, limit)`, which checks `dataTypeRepo.findByIdOwned`
before ever touching `DataTypeRowRepository` (system-context, no RLS of its own). The `dt` being sampled
already came from `typesPage.items` (itself `dataTypeRepo.findAll(user.id, ...)`-scoped), so the
`findByIdOwned` re-check is defense-in-depth, not the only guard — same double-check shape the current
`/rows` route already relies on. No new repository entry point bypasses ownership.

**D5 — No redaction/opt-out affordance in this ticket; explicitly considered and deferred, and narrowed by
D1/D3's Content-field exclusion.** This endpoint puts real row *values* into a payload an LLM prompt will
consume. The risk is materially different from a cross-tenant leak (HEL-363/384's class of bug): every read
stays owner-scoped (D4), so this is a user's own data reaching their own agent call, already gated by the
PAT-scope model (HEL-148) they opted into — and a user can already pull the full unbounded row snapshot
today via `GET /api/types/:id/rows` directly, so this aggregates a bounded slice rather than exposing a new
capability. D1/D3's Content-category exclusion strengthens this further: the practical worst case is no
longer "full extracted document text in every LLM prompt for content pipelines" — it's a small
scalar-valued preview, which is the "boolean flag vs. category" case the ticket actually describes. Ticket
acceptance criteria don't ask for redaction, and none of the four sibling HEL-345 tickets own it either.
Flagging explicitly rather than silently omitting: if per-column redaction (e.g. marking a Structured field
`sensitive: true` to also exclude it) is wanted later, it's a clean follow-up ticket — the
`sanitizeSampleRows(fields, rawRows)` seam from D3 is exactly where that filter would slot in.

**D6 — MCP-side caps are an independent implementation of the same constants, not a shared library.**
`context.ts` has no runtime shared with the Scala service (confirmed — `panelCount`/`flattenRowCount` are
already duplicated, not imported). `buildWorkspaceContext` gets its own `sanitizeSampleRows`-equivalent in
TS applying the identical Structured-only/40-column/200-char/`"…[truncated]"` rules from D3, with its own
unit test. `schemas/workspace-context.schema.json` is the documented shared contract (satisfies the
ticket's "parity test or documented shared schema" acceptance criterion); each side's test additionally
asserts its own caps independently.

**D7 — `WorkspaceContextService` swaps its `dataTypeRepo: DataTypeRepository` constructor dependency for
`dataTypeService: DataTypeService`.** Today `assemble` uses `dataTypeRepo` for exactly one call
(`dataTypeRepo.findAll(user.id, Page.Default)`), and `DataTypeService.findAll(user, page, tag)` already
wraps that identical call (it's what `DataTypeRoutes` itself uses). Since `listRows` — needed for sample
rows — only exists on `DataTypeService` (the owner-scoping choke point, D4), and `DataTypeService` already
fully covers the one thing `dataTypeRepo` was used for, this is a straight swap, not an additive second
dependency: remove the `dataTypeRepo` constructor param, add `dataTypeService`, update the call site
(`ApiRoutes.scala:212`, which already constructs a `dataTypeService` val) and the test fixture in
`WorkspaceContextServiceSpec`. Small, behavior-preserving, and directly required by this ticket's own
feature — not an unrelated refactor.

## Risks / Trade-offs

- [Risk] MCP fetches via HTTP (`?limit=5&excludeContentFields=true`) while the backend assembler calls the
  service in-process — if the two forwarding paths ever diverge, MCP could silently get unbounded/
  content-inclusive rows.
  → Mitigation: single route (`GET /api/types/:id/rows`) and single service method both sides funnel
  through; a route-level test pins both params actually bound/strip the response.
- [Risk] Column projection by `dt.fields` order could omit a column present in the raw snapshot if the
  DataType's schema changed after the last successful run (rare, same-call upsert+overwrite in
  `persistRunResults`), and a Structured string field could still individually exceed 200 chars.
  → Mitigation: both accepted/intended — the former already affects `columns[]` identically (no new
  inconsistency); the latter is exactly what D3's per-cell truncation exists to catch, complementary to
  the Content-field exclusion, not a gap in it.
- [Risk] `WorkspaceContextServiceSpec` is already at 431 lines (past CONTRIBUTING's ~400-line guidance)
  before this ticket's new tests.
  → Mitigation: extract the JSON-Schema-validation harness (`workspaceContextSchemaFile`,
  `schemaValidationErrors`) into a shared `backend/src/test/scala/com/helio/testsupport/` helper before
  adding new cases (pre-approved by the ticket brief).

## Migration Plan

Purely additive: new optional params (backward-compatible defaults — omitting both `limit` and
`excludeContentFields` preserves today's exact unbounded/full-content behavior), one new response field
(always present, no `Option` — no spray-json omission risk), one constructor-dependency swap (D7,
behavior-preserving). No migration, no existing wire-shape change.

## Open Questions

None outstanding. `rowCount` on `GET /api/types/:id/rows` reports the post-`limit` count (`rows.size`,
already correct today, no change needed) — pinned here per round-1's non-blocking note so the executor
doesn't have to guess. Round-1 REFUTE's four change requests are resolved above (D1/D3 rewritten, D2
corrected, D7 added, tasks.md updated); non-blocking notes folded into D5/this section.
