## Standing Constraints

- [C1] Owner Q1: frames are trailing only (current row plus earlier rows); no centred frames (follow-up ticket).
- [C2] Owner Q2: support `rows` and `days`. Days = calendar-day RANGE on the single orderBy key as a UTC date, [d-(N-1), d]; no gap filling; same-date peers share one frame/value.
- [C3] Owner Q3: leading partial frames emit a value over the rows available, never null for being partial.
- [C4] Owner Q4: rolling avg/sum/min/max/count; null/non-numeric skipped (not 0); avg/sum/min/max over no values = null; count = integer.
- [C5] Owner Q5: partitionBy optional; orderBy required (>=1) for rolling; days needs exactly one ascending key; null/unparseable key -> null and in no frame; frameSize 1..1000; invalid rejected at save, drafts stay saveable (HEL-1416).
- [C6] Red first: every test in group 4 is written and observed failing (record the failing run) before the code it covers is written; any guard test is proven by a mutation that turns it red.
- [C7] No compute/ExpressionEvaluator changes (HEL-1314/HEL-1070 lanes); RefinementEditShape.scala gets the one doc-string edit only (HEL-1482 lane).
- [C8] New DB-backed specs use `VerifiedEmbeddedPostgres.start`; every sbt run's output shows `[hel1468-guard]`; no inline FQNs; no Flyway migration (none needed; if one ever is, V124 re-checked against origin/main).
- [C10] Seam/payload tests assert the actual outgoing request body (exact key set), never editor-local state.
- [C11] Design-gate r2 executor notes: raw frameSize check in validateRawConfig only (null = absent), typed range in enumProblems, apply signature unchanged; conditional spreads, no undefined-valued keys; frame-size input clearable and guarded to 1..1000.
- [C9] Resource caps: `nice -n 19` for sbt/jest; check MemAvailable >= 15 GB before `sbt testFull` or a full jest run; shut down every sbt server started; formatters run with the worktree as cwd.

### Backend

## 1. Backend: window step

- [x] 1.1 `WindowConfig`: add `frameSize: Option[Int]`, `frameUnit: Option[String]`; `jsonFormat8`; extend `decode`
- [x] 1.2 `WindowStep`: add the five `rolling_*` names to `SupportedFunctions` and `FieldRequired`; add `RollingFunctions`, `MaxFrameSize = 1000`
- [x] 1.3 `enumProblems`: RAW JSON frameSize not an integer in 1..1000 (7.5, 5000000000 rejected, design 7a), unknown frameUnit, days with non-empty orderBy that is not one ascending key (rolling only)
- [x] 1.4 `apply`: draft errors in order (function, field, frameSize, orderBy) then `enumProblems`; rolling computation per design.md Decision 4
- [x] 1.5 `DateBucketStep.parseToUtcDate` -> `private[steps]`; days mode orders by parsed date and splits out unparseable keys
- [x] 1.6 `StepConfigValidation.validateWindow`: report missing frameSize / empty orderBy for rolling (analyze stops at the write-time rule first, HEL-1422 quirk, so order parity only holds for drafts)
- [x] 1.7 `ReshapeSchemaInference.inferWindow`: `rolling_count` -> integer, other rolling -> float; update scaladoc
- [x] 1.8 `RefinementEditShape.scala` window doc string: list the rolling functions + frameSize/frameUnit (one hunk only)
- [x] 1.9 Update WindowStep scaladoc (supported functions, rolling semantics, partial-frame behaviour)
- [x] 1.10 Living spec `openspec/specs/pipeline-window-op/spec.md` Purpose: mention rolling functions (Purpose is not carried by a delta)

### Frontend

## 2. Frontend: step editor

- [x] 2.1 `pipelineStep.ts`: `WindowFunction` union + `frameSize?`/`frameUnit?`
- [x] 2.2 `WindowConfig.tsx`: rolling functions, `ROLLING_FUNCTIONS`, frame size input (min 1, max 1000) + frame unit select (DESIGN.md tokens); 7/rows default only on function change; absent frameSize shows empty
- [x] 2.3 `stepNarrowing.ts` `windowConfigOf` (frameSize null when absent) + `stepCardFieldHandlers.onWindowChange`: replace the hard-coded `usesField` list with the shared field-required constant (incl. rolling); add frameSize/frameUnit for rolling only
- [x] 2.4 Op label "Window (rank / running total)" -> mention rolling (e.g. "Window (rank / running / rolling)")

## 3. Docs

- [x] 3.1 `helio-mcp/src/tools/write.ts` window description: rolling functions, frame keys, partial frames, null semantics, output types; fix "number for running_sum" -> float

### Tests

## 4. Tests (written red before their code, per C6)

- [x] 4.1 `WindowStepRollingSpec`: 7-row avg hand fixture incl. leading partial frames; sum/min/max/count; partitions interleaved; input order kept
- [x] 4.2 Days mode: gap fixture (1, 6, 6, 4, 9), peers share value, unparseable/null key -> null and excluded, mixed timestamp formats order by date
- [x] 4.3 Null/non-numeric/NaN skipped; empty frame -> null (avg/sum/min/max) and 0 (count)
- [x] 4.4 Validation: write rejects (frameSize 0/1001/-1/7.5/5000000000 via the REST step create, nothing stored, frameUnit weeks, days with 2 keys or desc); drafts saveable; run/analyze error order
- [x] 4.5 Legacy config (no frame keys) decodes, runs and re-encodes unchanged (codec round-trip)
- [x] 4.6 Analyze-vs-apply type parity for all five rolling functions (Int for integer, Double for float)
- [x] 4.7 `AnalyzeSchemaWarnings.referencedFields` includes `field` for rolling functions
- [x] 4.8 Seam: `shared-test-fixtures/window-rolling-seam.json`; jest client half (JoinConfig.seam.test.tsx pattern) drives StepOpEditor + useStepCardState, asserts the PATCH body config == fixture config with an exact key set
- [x] 4.9 Seam server half: route spec (VerifiedEmbeddedPostgres) creates the fixture step, analyzes, runs the pipeline end to end on gappy dated input, asserts fixture outputs
- [x] 4.10 `WindowConfig.test.tsx`: rolling controls render/hide, defaults on switch only, stored-without-frameSize shows empty, rejected-save marking still works
- [x] 4.11 Payload test: a rolling config saved from the editor persists `field` (guard for the old hard-coded list; mutation-proven)
