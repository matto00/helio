## Context

`AnalyzeSchemaWarnings.compute` (backend/src/main/scala/com/helio/domain/engine/AnalyzeSchemaWarnings.scala) is a pure
pass over `analyzeNodes` projections, called from three `PipelineService` sites (full analyze ~L1010, concise ~L1149,
proposal ~L1471). Four codes exist (HEL-1235 three + HEL-1403 `numeric-op-on-text-field`). Consumers today: the wire
(full `warnings[]`, concise per-node `warnings?: string[]`), helio-mcp types/descriptions. The frontend has the
`AnalyzeWarning` type only (`frontend/src/features/pipelines/types/pipelineStep.ts`); `get_workspace_context`
(`helio-mcp/src/context.ts` ~L534) maps `analyzed.steps` and drops `warnings`.

Secondary inputs: `secondaryOf` resolves a lane via `laneDependencyOf` (join/union/lookup) or a source via
`sourceDependencyOf`, which is JOIN-ONLY (PipelineAnalyzeService.scala:215). `resolveSecondarySourceSchemas`
(PipelineService.scala ~L1106) loads only those ids. So a lookup with a `source` secondary has `sec = None` and
`lookupRenames` returns nothing (item 4). Join's key-type check (`joinWarnings`) has no lookup twin (item 3); the
runtime `LookupStep` indexes `refRows.groupBy(lookupKey value)` and probes with the raw `sourceKey` value, i.e. the
same `Map[Any,_]` equality `family()` already models for join.

## Goals / Non-Goals

Goals: items 1–6 of the ticket, all four codes. Non-goals: see proposal (no blocking, no projection change, no new
codes, no HEL-1437 fix, no proposal-modal rendering).

## Decisions

**D1 — Lookup key type mismatch reuses `join-key-type-mismatch`.** Precedent: HEL-1235 already emits
`join-column-renamed` for lookup with a `lookup:` message prefix. A new code would widen two JSON schemas, the frontend
type and the helio-mcp union for no behavioural gain. Message: `lookup: source key '<sourceKey>' is <t1> on the input
but lookup key '<lookupKey>' is <t2> on the secondary input; values of different types never match, so no row will
find a match (types are from the inferred schemas)`. Gate identical to join: enabled, no validationError, both key
fields present, `in.types && sec.flags.types`, both families defined and different. The spec requirement text is
widened from "join" to "join or lookup". (The missing-`lookupKey` case is D1b.) The helio-mcp `analyze_pipeline` and
`analyze_pipeline_proposal` descriptions' `join-key-type-mismatch` text is extended to say it also covers lookup keys.

**D1b — Missing `lookupKey` on the secondary warns (absorbed; same code path).** The new lookup key function mirrors
`joinWarnings`' right-side check line for line: when the secondary is name-complete and lacks `lookupKey`, emit
`field-not-in-input-schema` via `missingMessage("lookup", lookupKey, sec.schema, "this step's inferred secondary input
schema", secondary = true)`; `missingMessage`'s `key '...'` wording condition (today `secondary && op == "join"`,
AnalyzeSchemaWarnings.scala ~L219) is widened to `op == "join" || op == "lookup"`. The input-side `sourceKey` is already covered by
`referencedFields`. Driver ruled: absorb only if trivially the same code path — it is the same new function and gate.

**D2 — Source-kind lookup secondary resolved for WARNINGS ONLY.** Add `PipelineAnalyzeService.secondarySourceIdOf(op,
config)` covering `join` AND `lookup` source-kind secondaries. `resolveSecondarySourceSchemas` loads ids via it (so the
map also holds lookup sources), and `AnalyzeSchemaWarnings.secondaryOf` resolves via it. `sourceDependencyOf` stays
join-only and `analyzeNodes` keeps calling it, so no projection changes (a lookup over a source still projects its
documented `"string"` placeholder types). Because the projection did NOT see the source schema, a source-secondary
lookup's OUTPUT must stay type-untrusted: `typesPreserved("lookup")` only trusts a lane secondary (add an explicit
`viaLane` flag on `Secondary`); otherwise downstream steps would compare placeholder `string` types as trusted and emit
false `join-key-type-mismatch` / `numeric-op-on-text-field` warnings. Name-completeness of the lookup output is
unchanged (`in.names`). The source secondary is name+type complete (same as join's source secondary today), so it
enables both item 4 (renames) and D1 (key types) for source-kind lookups.

**D3 — `get_workspace_context` per-step warnings.** Group `analyzed.warnings` by `stepId` and attach
`warnings: [{code, message}]` to the matching step entry in BOTH full and concise mode (omitted when a step has none).
Concise mode keeps the warnings in full, exactly as concise analyze already keeps per-node messages, so concise mode
omits no new detail kind: `CONCISE_OMITTED_DETAIL_KINDS` (context.ts ~L276) and the `mcp-concise-response-modes` spec
are untouched (design-gate r1 CR4). The `get_workspace_context` description (`helio-mcp/src/tools/read.ts`) states
they are non-blocking hints. `analyzed.warnings` missing (older server) is treated as `[]`.

**D4 — Concise wording (item 5): fix the description, keep the messages.** Replace "no column lists" in the
`analyze_pipeline` description with wording that concise omits the per-step schema column lists but a warning message
may name up to 20 available columns. Trimming messages would make the concise hint less actionable and diverge from
the full response's message for the same warning. No behaviour change.

**D5 — Doc leftovers (item 6).** `PipelineAnalyzeSchemaWarningsSpec` header: replace "see the change's verification
notes" with a pointer to `openspec/changes/archive/2026-10-08-analyze-schema-warnings/evaluation-1.md` ("My own
mutation runs") and `evaluation-2.md`, and note the D6b/D6d mutations were synthetic. `files-modified.md` does not exist
in the archive (deleted at delivery), so the stale `compute` rationale is corrected where it survives: append a
one-line correction to archived `tasks.md` 1.3 pointing at the shipped reason in `AnalyzeSchemaWarnings.typeTrusted`'s
scaladoc (inferType not proven equal to the run-time class), which evaluation-2.md verified.

**D6 — Editor rendering (item 1): OWNER RULED option A** (2026-10-09, AskUserQuestion via the driver, recorded
`escalation.answered optionA`; mockups `.concertino/runs/HEL-1414/evidence/mockups/optionA-*.png`). Mirrors the
`pipeline-step-validation-display` pattern: (a) StepCard header: a compact, non-interactive warning-intent indicator
(TriangleAlert in `--app-warning`, placed beside where the error chip sits) with an accessible name
("N schema warning(s)") and a visible count when N > 1; visible collapsed and expanded. (b) Expanded card, placement
pinned to the ruled mockup (design-gate r1 CR3): rendered only when `expanded`, as a sibling immediately AFTER the
header row and BEFORE `<OutputsRail>` (StepCard.tsx ~L361), i.e. outside `step-card-body`. The `validationError`
`InlineError` stays where it is inside `step-card-body` (~L394), so a step with both shows the warning region above
the Outputs rail and the error in the body below it. Region: a warning-tinted block (styling recipe of `.pipeline-detail-page__truncation-banner` — share the rule via a combined selector rather
than duplicating it: `--app-warning-surface`, border
`color-mix(--app-warning 35%)`) headed "Check before running" + "(these don't block runs)", listing each message.
Not `role="alert"` (non-blocking, refreshed on every analyze). The card gets NO errored accent/class; a step with both
a validationError and warnings shows both. Copy never says "can't run". Data flow mirrors `getAnalyzeValidationError`:
a `getAnalyzeWarnings(stepId)` callback (memoised group-by-stepId of `analyzeResult.warnings`, stable empty array)
threaded through `PipelineRiverView` → `RootColumn` → `LaneColumn` → `StepCard`, and the same in any other StepCard
call site in `PipelineRiverView`. Disabled steps never get warnings from the backend; no client filtering needed.
Verified in the running app in light and dark (evidence screenshots).

**D7 — Never-blocks guard.** No new path from `AnalyzeSchemaWarnings` into validationError / costVerdict /
`stepConfigProblem` / `validateRawConfig` / RunConfigGate. HEL-1235's guard specs (`PipelineAnalyzeSchemaWarningsSpec`
"never blocks" cases) and the HEL-1279 auto-run specs must stay green unmodified. New tests add a lookup-key-mismatch
pipeline to the "warned pipeline remains runnable" guard.

## Risks / Trade-offs

- D2's untrusted source-lookup output means a type mismatch DOWNSTREAM of a source lookup is still not reported —
  deliberate (false positives are worse; the projection does not know the types).
- Stored source schemas can be stale (HEL-1280): messages keep the "inferred schemas" evidence wording.
- Reusing `join-key-type-mismatch` for lookup slightly overloads the code name; documented in the spec + tool text.

## Planner Notes

- Self-approved: D1 code reuse, D2 warnings-only resolution, D3 shape, D4 wording-over-trim, D5 re-target.
- Red-first: D1/D2/D3 tests must fail on the WHOLE pre-fix tree (driver rule) before implementation.
- Lint: @typescript-eslint/recommended enforced (HEL-1448). Local caps (HEL-1442): `nice -n 19`, sbt `-J-Xmx3g`.
