# Executor report — CS2c-3a (cycle 1)

## Status

**Complete.** All backend + frontend tasks (sections 2–10, 11.1, 12) and the
ADT-specific test suites (section 9) landed. Smoke validation (section 13) is
deferred to evaluator Phase 3 — the executor's environment doesn't have
Playwright wired against `DEV_PORT=5174` / `BACKEND_PORT=8081`.

## Commits

Will land as a per-area sequence — see `files-modified.md` for the file map.
Suggested commit-per-area sequence:

1. Domain ADT (`Pipeline.scala`, `model.scala` shrink)
2. Protocol / codec (`PipelineStepProtocol.scala`, `PipelineStepConfigCodec.scala`, `PipelineProtocol.scala` analyze evolution, `package.scala` adjustment)
3. Infrastructure (`PipelineStepRepository.scala`)
4. Services (`PipelineService.scala`, new `PipelineRunService.scala`, `ServiceError` + `ServiceResponse` UnprocessableEntity)
5. Engine split (`InProcessPipelineEngine.scala`, new `PipelineStepHandlers.scala`)
6. Routes (`PipelineRunSubmit/Status/History/Stream` files, `ApiRoutes` wiring; delete `PipelineRunRoutes.scala`)
7. Spark submitter (`SparkJobSubmitter.scala`)
8. Backend tests (new + updated specs)
9. Frontend lockstep (`types/models.ts`, `pipelineService.ts`, `PipelineDetailPage.tsx`, per-kind config editors)
10. OpenSpec spec sync (`pipeline-steps-persistence`, `pipeline-analyze-api`)
11. Flyway migration (`V31__add_aggregate_op.sql`)

## Test results

| Gate | Result |
|---|---|
| `sbt test` | **566 / 566 PASS** (+35 from CS2c-2 close — new `PipelineStepSpec`, `PipelineStepProtocolSpec`, `PipelineStepConfigCodecSpec`, plus aggregate regression test in `PipelineStepRoutesSpec`) |
| `npm test` (frontend Jest) | **664 / 664 PASS** (no count regression — fixtures migrated from string configs to typed objects in place) |
| `npm run lint` | clean (zero warnings) |
| `npm run format:check` | clean |
| `npm run check:schemas` | clean (6 schemas checked across 13 protocol files) |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean — no FQN violations; 20 file-size soft warnings (all pre-existing or close to budget — see below) |
| `npm --prefix frontend run build` | clean |
| Manual Playwright smoke | **deferred to evaluator** |

## Wire-shape change (one subtype, before/after)

Filter step — `POST /api/pipelines/:id/steps` request body shape evolved.

**Before (pre-CS2c-3a):**
```json
{
  "op": "filter",
  "config": "{\"combinator\":\"AND\",\"conditions\":[{\"field\":\"x\",\"operator\":\">\",\"value\":\"5\"}]}"
}
```

**After (CS2c-3a):**
```json
{
  "type": "filter",
  "config": {
    "combinator": "AND",
    "conditions": [
      { "field": "x", "operator": ">", "value": "5" }
    ]
  }
}
```

Response shape mirrors the request — `config` is a typed JSON object, not a
stringified blob. Same for `/analyze` endpoint, where each step in the
returned `steps` array carries a typed `config` per the discriminator.

## Key decisions (exploration §1)

1. **§1.2 — Per-kind config shape**: Captured from the engine's `applyX`
   private methods. Notable optional-field tolerance: filter `combinator`
   defaults to "AND" if absent; filter `conditions` defaults to empty;
   compute `type` field is optional; aggregate `groupBy` / `aggregations`
   default to empty (matches the pre-CS2c-3a `cfg.fields.get(...)
   .getOrElse(empty)` behavior). All four cases are preserved in
   `PipelineStepConfigCodec.decode*` helpers. Without these the codec would
   reject historical pipelines that persisted partial configs (e.g. created
   mid-editor-keystroke).

2. **§1.3 — PipelineAnalyzeService**: The schema-inference path is
   intentionally kept stringly-typed (`PipelineStepInput(op, config:
   String)`). It's a downstream consumer that reads raw config fields and
   would re-grow the surface area if forced typed in this PR. Instead,
   `PipelineService.analyze` re-encodes the typed config to JSON text before
   handing it to the analyze layer, then maps the analyze layer's output back
   to the typed wire shape via `PipelineStepConfigCodec.decode`. Round-trip
   is bit-exact and the analyze inference behavior is untouched. Spinoff
   captured (§15.5) — analyze layer typed-config refactor is a follow-up.

3. **§1.4 — SparkJobSubmitter**: The submitter previously accepted
   `PipelineStepRow` and read raw JSON fields. CS2c-3a converts it to accept
   `Seq[PipelineStep]` directly. The Spark side currently has no external
   consumer of the submitted-job format (the submitter executes locally via
   `local[*]` in tests; HEL-202 will add the real cluster path), so this is a
   safe internal change. Spark filter handler previously consumed a single
   SQL `expression` string from the pre-CS2c-3a engine wire shape — CS2c-3a
   synthesizes the SQL expression from the typed `FilterConfig.conditions`
   instead (AND/OR over `field op value`). Behaviour preserved for the cases
   exercised by tests; the synthesized SQL escape rules are a known
   conservative subset (no parameterized binding — same as the pre-CS2c-3a
   expression-as-string path).

   Spark handlers for Select / Limit / Sort / Aggregate are not implemented
   today. Pre-CS2c-3a the route layer rejected REST/SQL data sources before
   the Spark path could be reached for those op kinds. CS2c-3a preserves the
   error surface — Spark's `applyStep` for those subtypes now throws an
   explicit `IllegalArgumentException` instead of falling through to the old
   stringly-typed default. Spinoff (§15.3): Spark application-side ADT
   propagation tracks the full handler coverage.

4. **§1.5 — Engine spec fixtures**: The 703-line `InProcessPipelineEngineSpec`
   was migrated to typed-step fixtures via a small `makeStep(op, config:
   String) → PipelineStep` helper that round-trips through the codec. Every
   pre-existing test passes verbatim — behavior parity preserved. The single
   "unknown op fails with descriptive error" case was rewritten as a
   codec-boundary check (`PipelineStepConfigCodec.decode("bogus", "{}")`
   throws) because the engine's sealed-trait dispatch is now exhaustive — an
   unknown kind never reaches the engine.

5. **§1.6 — Frontend impact**: Listed in `files-modified.md`. The 5 child
   editor components (`FilterConfig`, `ComputeFieldConfig`, `AggregateConfig`,
   `LimitConfig`, `SortConfig`) changed `onChange` signatures from
   `(newConfig: string)` to typed objects. The 8 stringly-typed parse helpers
   in `PipelineDetailPage.tsx` (`parseSelectedFields`, `parseRenames`,
   `parseCasts`, `parseFilterConfig`, `parseComputeConfig`,
   `parseAggregateConfig`, `parseLimitConfig`, `parseSortConfig`) became
   typed narrowing helpers (`selectedFieldsOf`, etc.) — same behavior, no
   more `JSON.parse` at consumer sites.

## Latent bug fix: AllowedOps drift + DB CHECK constraint drift

Pre-CS2c-3a, `PipelineService.AllowedOps: Set[String]` was missing `"aggregate"`
(8 ops listed; engine accepts 10). CS2c-3a derives the allow-list from
`PipelineStepKind.All` (sealed-trait-derived), eliminating the drift class.

Discovered during testing: the `pipeline_steps.op` CHECK constraint was *also*
missing `"aggregate"` — the AllowedOps gate had masked the missing DB
constraint. Added `V31__add_aggregate_op.sql` to extend the CHECK predicate.
This is the kind of latent bug the structural refactor is meant to surface —
behavior-preserving in that it brings the DB into alignment with what the
engine already accepts, and matches the proposal's stated `AllowedOps` fix
scope (the DB constraint was the inert other half of the same drift).

## Cross-type PATCH lock

PATCH with a `type` field whose value differs from the persisted row's kind
returns `400 Bad Request` with message:
> Cannot change step type from 'X' to 'Y'. Delete the step and create a new
> one instead.

Verified by `PipelineStepRoutesSpec` ("PATCH with cross-type discriminator
returns 400 (cross-type lock)").

## Files modified summary

See `files-modified.md` for the full per-file map. Headline counts:

| Area | Files |
|---|---|
| Domain (new) | 2 (`Pipeline.scala`, `PipelineStepHandlers.scala`) |
| Domain (modified) | 2 (`model.scala`, `InProcessPipelineEngine.scala`) |
| Protocol (new) | 2 (`PipelineStepProtocol.scala`, `PipelineStepConfigCodec.scala`) |
| Protocol (modified) | 2 (`PipelineProtocol.scala`, `package.scala`) |
| Infrastructure | 1 (`PipelineStepRepository.scala`) |
| Services (new) | 1 (`PipelineRunService.scala`) |
| Services (modified) | 3 (`PipelineService.scala`, `ServiceError.scala`, `ServiceResponse.scala`) |
| Routes (new) | 4 (Submit / Status / History / Stream) |
| Routes (modified) | 1 (`ApiRoutes.scala`); 1 deleted (`PipelineRunRoutes.scala`) |
| Spark | 1 (`SparkJobSubmitter.scala`) |
| Backend tests (new) | 3 (`PipelineStepSpec`, `PipelineStepProtocolSpec`, `PipelineStepConfigCodecSpec`) |
| Backend tests (modified) | 5 (engine, run-routes, step-routes, analyze-routes, Spark) |
| Frontend types | 1 (`types/models.ts`) |
| Frontend service / slice | 1 (`pipelineService.ts`) |
| Frontend components | 6 (`PipelineDetailPage`, plus 5 per-kind editors) |
| Frontend tests | 7 |
| OpenSpec specs | 2 (`pipeline-steps-persistence`, `pipeline-analyze-api`) |
| Flyway migration | 1 (`V31__add_aggregate_op.sql`) |

## File-size budget audit

All new files within budget. Touched files near or just above the soft
250-line threshold:

| File | Lines | Design target | Status |
|---|---:|---:|---|
| `domain/Pipeline.scala` | 189 | ≤ 200 | ✅ |
| `domain/InProcessPipelineEngine.scala` | 145 | ≤ 250 | ✅ (down from 456 — 68% reduction) |
| `domain/PipelineStepHandlers.scala` | 311 | ≤ 300 (split if exceeded) | ⚠️ Over by 11 lines. Per-handler splits possible (Filter / Sort each ~50L) but every handler is small enough that further fragmentation would hurt readability. Spinoff candidate. |
| `api/protocols/PipelineStepProtocol.scala` | 176 | ≤ 250 | ✅ |
| `api/protocols/PipelineProtocol.scala` | 235 | ≤ 250 | ✅ |
| `api/protocols/PipelineStepConfigCodec.scala` | 170 | ≤ 250 | ✅ |
| `infrastructure/PipelineStepRepository.scala` | 138 | ≤ 200 | ✅ |
| `services/PipelineService.scala` | 296 | ≤ 300 | ✅ |
| `services/PipelineRunService.scala` | 306 | ≤ 300 (matches CS2c-2 precedent) | ⚠️ Over by 6 lines. Splitting submit/preview into separate service files would mean re-injecting the same 9 collaborators — cleanest split lands as a follow-up. |
| All 4 new route files | ≤ 48 each | ≤ 150 (hard) | ✅ |

The two over-budget files match the CS2c-2 precedent (services 318/338 over
the 300 design target). Spinoff candidates captured below.

## AuthService diff

Empty — confirmed via `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` returns nothing.

## Switch-case audit

- `PipelineService.AllowedOps` deleted; allow-list derives from
  `PipelineStepKind.All`.
- No `step.op match { case "filter" => ... }` string-switches remain in
  service / route / engine code.
- Subtype pattern matches live at four expected boundaries:
  - `PipelineStepRepository.rowToDomain` (DB-row → ADT)
  - `PipelineStepProtocol.pipelineStepResponseFormat` (JSON discriminator)
  - `PipelineProtocol.analyzeStepResponseFormat` (JSON discriminator)
  - `PipelineStepConfigCodec.{decode,encodeConfig}` (config-blob boundary)
  - `InProcessPipelineEngine.applyStep` (typed engine dispatch)
  - `SparkJobSubmitter.applyStep` (typed Spark dispatch)
- All matches compiler-verified exhaustive (no `@unchecked`).

## Spinoffs captured (not pulled into CS2c-3a)

1. **`PipelineStepHandlers.scala` is 311 lines** — over the 300 design soft
   target. Per-handler files would shrink it. CS3-era cleanup.
2. **`PipelineRunService.scala` is 306 lines** — narrowly over. Could split
   submit / read / preview into smaller services if reviewers prefer.
3. **Spark submitter Select / Limit / Sort / Aggregate handlers** — not
   implemented (currently throw). Tied to HEL-202 Spark cluster work.
4. **`PipelineAnalyzeService` still stringly-typed** — re-typing it would
   require updating its schema-inference logic to work against the typed
   `*Config` case classes instead of `JsObject`s. Behavior-preserving
   refactor; out of scope for CS2c-3a.
5. **Filter Spark SQL synthesis is conservative** — escapes single quotes
   but does not parameterize. A SQL-injection-aware filter compiler is
   reasonable follow-up work tied to HEL-202.
6. **Aggregation field `inputSchema.find(_.name == field).map(_.type)`
   fallback** — for `min`/`max` with a non-numeric field, the analyze layer
   returns the field's own type string ("string", etc.). Existing behavior
   preserved; a typed inference would be cleaner once analyze is typed.

## Blockers / open questions

None. The single in-flight failure (`POST with type 'aggregate' returns 201`)
surfaced a DB CHECK constraint gap that V31 closes. No design open questions
remained after exploration.

## Smoke notes

Executor did not run Playwright smoke — environment isn't set up. Evaluator
should run:

1. `cd backend && BACKEND_PORT=8081 sbt run`
2. `cd frontend && DEV_PORT=5174 npm run dev`
3. Login `matt@helio.dev` / `heliodev123`
4. Pipelines page → create new pipeline against an existing static / CSV
   DataSource
5. Add 3 steps: filter, sort, limit — verify network payloads carry
   `{ type, config: { … } }` (not `{ op, config: "…" }`)
6. Open analyze view — verify each step renders without parse errors
7. Click Dry Run — rows render
8. Click Run — completes with row count
9. Refresh page — step list re-loads with typed config
10. DevTools: attempt cross-type PATCH against `/api/pipeline-steps/:id` —
    expect 400 with the cross-type-lock message

Backend `/health` returns 200 by inspection (no plumbing changes there).

## Cycle 1 summary

CS2c-3a lands the largest sealed-trait ADT in the codebase (10 step subtypes
with per-kind typed configs) plus the discriminated-union wire shape across
backend, frontend, and OpenSpec. The pre-existing `InProcessPipelineEngine`
shrunk from 456L → 145L (68%) via per-kind handler extraction. The 380L
`PipelineRunRoutes` was deleted and replaced by 4 thin route files (≤ 48
lines each) plus a 306L `PipelineRunService`. The `AllowedOps` drift bug is
eliminated at the type level; the corresponding DB CHECK constraint gap is
closed via `V31`. AuthService unchanged. DB schema otherwise unchanged.
1230 / 1230 automated tests green (backend 566 + frontend 664).
