## Context

`JoinStep` (`backend/src/main/scala/com/helio/domain/steps/JoinStep.scala`) and `UnionStep`
(`backend/src/main/scala/com/helio/domain/steps/UnionStep.scala`, HEL-384) are the engine's two
async / repo-touching steps: both resolve a second `DataSource` via
`ctx.dataSourceRepo.findByIdInternal` (privileged at RUNTIME — the pipeline's ACL is the gate, not
per-source ownership) and load its rows via `ctx.loadSource`. `lookup` needs the identical
resolution shape but a third combination behavior: a constrained single-key left-join that brings
in only named columns (unlike `join`'s full-row `leftRow ++ rightRow` and `union`'s row-stacking).

HEL-278 (2026-05-24) added a creation/update-time `findByIdOwned` pre-flight ACL check in
`PipelineService.addStep`/`updateStep` for `JoinConfig.rightDataSourceId`; HEL-384 mirrored it for
`UnionConfig.otherDataSourceId` (`unionCheckF`, chained after `joinCheckF`). `LookupConfig`
references a second `DataSource` by id (`referenceDataSourceId`) exactly like both, so it MUST get
the symmetric `lookupCheckF` arm in both methods — without it, `lookup` ships a real cross-tenant
data read via the generic `case _ => Right(())` fallback (the specific risk this design pre-empts;
flagged in the ticket from HEL-384's design-gate history, where the equivalent union gap took 3
skeptic rounds to close).

`PipelineAnalyzeService.inferOutputSchema` has no repo access — it is pure schema-math. `join` and
`union` are both identity passthroughs there. `lookup` is NOT identity passthrough: it is additive
(brings in new columns), like `pivot`/`window`/`stringops`/`unpivot`. Those additive ops fall into
two families: (a) data-driven typing via a same-layer schema lookup (`pivot`'s `index` fields,
`unpivot`'s `valueVars` common-type), and (b) best-effort `string` typing for outputs whose real
type isn't knowable at this layer (`stringops.outputColumn`, `window`'s `lag`/`lead` fallback).
`lookup`'s brought-in columns belong to family (b): the reference source's schema requires a repo
round trip this layer doesn't have (same reasoning `union`'s Non-Goal already documented).

## Goals / Non-Goals

**Goals:**
- Define `LookupConfig`'s shape and the single-key left-join match/no-match/multi-match semantics
  precisely enough to write scenario-level spec requirements.
- Define the additive analyze/infer behavior (append `columns`, best-effort `string` typing) and
  justify it as intentional, matching the family-(b) precedent above.
- Close the cross-tenant ACL gap symmetrically with `join`/`union` from day one (not as a follow-up
  round).
- Decide `lookup`'s `OP_TYPES` picker exposure.

**Non-Goals:**
- Multi-key lookups (ticket scope: single key only).
- Resolving the reference source's live schema at analyze time — no repo access at this layer
  (matches `union`'s existing, accepted limitation).
- Restricting the RUNTIME `findByIdInternal` lookup in `evaluate` to caller-owned/shared sources —
  stays privileged, matching `join`/`union`'s "pre-flight + runtime internal" model; only the
  creation/update-time pre-flight is ownership-scoped.

## Decisions

**Decision 1 — Config shape.** `LookupConfig(referenceDataSourceId: String, sourceKey: String,
lookupKey: String, columns: Vector[String])`, per the ticket. Tolerant `decode` defaults:
`referenceDataSourceId -> ""`, `sourceKey -> ""`, `lookupKey -> ""`, `columns -> Vector.empty`
(mirrors `JoinConfig`/`UnionConfig.decode`'s "missing keys default to the least-surprising empty
value" pattern — an empty `columns` list is a no-op enrichment, not an error, matching `select`'s
empty-`fields` precedent of "silently keep nothing").

**Decision 2 — single-key match semantics.** Index the reference rows by `lookupKey` (one
`Map[Any, Seq[Row]]`, mirroring `JoinStep`'s `rightIndex`). For each left row, look up its
`sourceKey` value in that index.

**Decision 3 — no-match handling: null-fill (left join).** If no reference row matches, the left
row is preserved unchanged except the requested `columns` are added with `null` values — every left
row survives (true left-join cardinality), matching `JoinStep`'s `"left"` join-type branch and the
ticket's explicit acceptance criterion.

**Decision 4 — multiple-matches handling: first match wins.** If more than one reference row
matches a given `sourceKey` value, only the first matching row's `columns` values are used — no row
multiplication. Rationale: `lookup`'s entire purpose (per the ticket) is enrichment against a
*small reference table* expected to have unique keys; multiplying left rows on a duplicate-key
reference would silently change the row count of the primary data, surprising for what's framed as
a "bring in a few columns" op (contrast `join`, whose `inner`/`left` types are explicit about
cardinality expansion). Deterministic "first" = index order, i.e. reference rows in `loadSource`'s
returned order (same determinism guarantee `JoinStep.rightIndex`'s `groupBy` already provides,
since `Seq.groupBy` preserves each group's original element order).

**Decision 5 — column collision handling.** For each name in `columns`, if it collides with an
existing key in the left row, the reference value overwrites it in the output row (matching
`JoinStep`'s `leftRow ++ rightRow` — right-hand values win on key collision — for direct
consistency with the sibling op, not a new precedent). Only the requested `columns` are brought in
from the reference row; every other reference-row key is dropped (this is the ergonomic
"only named columns" contract distinguishing `lookup` from `join`).

**Decision 6 — execute-time errors.** Missing/invalid `referenceDataSourceId` (empty-string
default, or an id that doesn't resolve via `findByIdInternal`) fails with
`IllegalArgumentException("DataSource not found for lookup: " + referenceDataSourceId)`, matching
`JoinStep`'s `"DataSource not found for join: " + rightDsId` / `UnionStep`'s `"... for union: " +
otherDsId` message shape.

**Decision 7 — analyze inference is additive, family (b) best-effort typing.** Add a dedicated
`"lookup"` dispatch case (`inferLookup`) to `PipelineAnalyzeService.inferOutputSchema` — NOT the
identity-passthrough group `join`/`union` belong to. `inferLookup` parses `columns` from config and
appends each as `SchemaField(name, "string")`, replacing any existing same-named field in place
(the same collision-safe `filterNot` + `:+` shape `inferStringOps`/`inferWindow` already use for
their single-output-column case, generalized here to a `Vector[String]` of output columns). No
field-existence validation against `inputSchema` is performed for `sourceKey` (matching
`stringops`'/`datebucket`'s "accept any field name, null-coerce at execute time" precedent) — this
is a dedicated dispatch case, not the unknown-op fallback, so `analyze_pipeline` never emits a
false `validationError` for a `lookup` step.

**Decision 8 — expose `lookup` in the `OP_TYPES` picker.** Like `union` (Decision 7 there), and
unlike `join`, `lookup` ships with both a creation/update-time `findByIdOwned` ACL check (Decision
9 below) and a full frontend editor (this change) — neither of `join`'s real exclusion reasons
(no editor; HEL-264) applies. `stepNarrowing.ts` adds `lookup` directly to `OP_TYPES`, with
`defaultConfigFor` returning `{"referenceDataSourceId": "", "sourceKey": "", "lookupKey": "",
"columns": []}`.

**Decision 9 — mirror HEL-278/HEL-384's ACL pattern for `LookupConfig.referenceDataSourceId`.**
Add a `lookupCheckF` pre-flight (parallel to `joinCheckF`/`unionCheckF`) in both
`PipelineService.addStep` and `updateStep`: `case lc: LookupConfig =>
dataSourceRepo.findByIdOwned(DataSourceId(lc.referenceDataSourceId), user).map { case None =>
Left(NotFound(...)); case Some(_) => Right(()) }`, chained after `unionCheckF` and falling through
to the existing `case _ => Right(())` default. A cross-user `referenceDataSourceId` returns `404
Not Found` at creation/update time, identical to `join`/`union`. Test parity: mirror
`PipelineStepRoutesSpec.scala`'s join/union POST 404/201 test pair for `lookup`, PLUS a fresh PATCH
404 test (config-unchanged) — the join tests are POST-only and `union`'s PATCH test (task 6.8 in
its change) is the template to replicate, not skip.

**Decision 10 — `jsonFormat6` for `LookupStepResponse`.** Fields: `id, pipelineId, position,
createdAt, updatedAt, config` — identical shape to `JoinStepResponse`/`UnionStepResponse`.

**Decision 11 — frontend field pickers.** `referenceDataSourceId` uses a `Select` sourced from the
sources-feature redux slice, identical to `UnionConfig.tsx`'s other-source picker. `sourceKey` uses
a `Select` sourced from `analyzeSchema` (the current step's input schema — already available to
every editor via `StepCard`, e.g. `UnpivotConfig`'s field selects), since that schema is known.
`lookupKey` and `columns` reference the SECOND source's schema, which is not fetchable by id from
the frontend today (no existing endpoint resolves an arbitrary `DataSource`'s inferred schema by
id post-creation — `inferSqlSource`/`inferFromCsv`/`inferFromJson` are creation-time-only, operating
on not-yet-persisted config). Adding such an endpoint is out of scope (not requested by the ticket,
and a real new capability, not incidental plumbing). `lookupKey` is therefore a free-text
`TextField` (labeled with a hint that it's a column name on the reference source) and `columns` is
a free-text add/remove row list, mirroring `UnpivotConfig.tsx`'s `idVars`/`valueVars` row-add UI
shape but with `TextField` rows instead of `Select` rows (same interaction pattern, text input
instead of a populated dropdown).

## Risks / Trade-offs

- [Risk] Without Decision 9's ACL check, `lookup` would ship a REAL cross-tenant `DataSource` read
  via the generic `case _ => Right(())` fallback (worse than `join`/`union`, which already closed
  this) → Mitigation: Decision 9 adds a symmetric `findByIdOwned` pre-flight check + a mirrored
  POST 404/201 pair AND a fresh PATCH 404 test (tasks.md 2.6, 6.7, 6.8).
- [Risk] "First match wins" (Decision 4) silently drops rows from a reference table with duplicate
  keys rather than erroring → Mitigation: documented in the step's scaladoc and spec as an
  intentional, ticket-aligned design choice ("small reference table" framing); `columns`-only
  enrichment plus deterministic ordering keeps behavior predictable and testable.
- [Risk] Best-effort `string` typing (Decision 7) will be wrong for numeric/boolean reference
  columns, degrading downstream cast/aggregate accuracy until the user manually re-casts →
  Mitigation: documented limitation, consistent with `union`'s equivalent accepted limitation and
  `stringops`' existing best-effort typing precedent; not a regression relative to today's engine.
- [Risk] Flyway V-number collision — this is the last of the epic's ops but other lanes could still
  be mid-flight → Mitigation: tasks.md includes an explicit "re-confirm max migration number" task
  both at scheduling time (3.1) and immediately before the delivery push (7.1), per orchestrator
  instructions.

## Planner Notes

- Self-approved: Decision 4 (first-match-wins vs. error/multiply) — a direct, ticket-scoped design
  call ("small reference table", "bring in named columns") with a documented, testable rule; not a
  new architectural direction.
- Self-approved: Decision 8 (picker inclusion) and Decision 9 (ACL parity) directly mirror
  `union`'s already-reviewed precedent (HEL-384) — not new architectural calls.
- Self-approved: Decision 11 (free-text `lookupKey`/`columns` instead of schema-driven selects) —
  no reference-schema-by-id endpoint exists today; adding one is a distinct capability outside this
  ticket's stated scope (`LookupConfig.tsx` editor only). Flagged here rather than silently
  narrowed, since the ticket's prose said "selects"/"multi-select" — the free-text approach still
  satisfies the acceptance criterion ("frontend StepCard renders a working editor; config PATCHes
  round-trip") without inventing new backend surface.
- No ESCALATION raised — no new external dependency, no breaking API change, scope matches ticket;
  the ACL gap is closed via a direct mirror of existing shipped precedent (HEL-278/HEL-384).
