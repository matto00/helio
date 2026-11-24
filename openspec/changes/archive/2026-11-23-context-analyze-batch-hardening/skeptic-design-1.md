## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 1cdd7df9084fe812729ea4731f1eda502b94fd98 (main tip; change dir untracked). Read-only: no servers, no sbt, no jest.

### What I verified (with evidence)

- **`data_sources.id` is TEXT, compared as raw text by `/analyze`.** `V4__data_sources_and_types.sql:2` is
  `id TEXT NOT NULL PRIMARY KEY`. A grep of every migration for `TYPE uuid` returns nothing touching data_sources, and the
  only `ALTER COLUMN` on the table is `owner_id` (V119:81). Slick maps it as `column[String]("id")`
  (DataSourceRepository.scala:1221). `findByIdOwned` (:206) and `findByIdInternal` (:157) are `r.id === id.value`.
  `/analyze` wires exactly those as resolvers (PipelineAnalyzeReads.scala:80-82). So the premise holds, and the
  "compares as uuid" comment at DataSourceRepository.scala:162 and PipelineContextAnalyzeReads.scala:108 is wrong.
  (The fixture's `$id::uuid` insert only canonicalises the stored value. It does not change the column type.)
- **Prefetch ids = ids the shared fetch requests (D1's open question).** Roots: both read `listRootDataSourceIdsInternalBatch`
  values. Secondaries: the batch's `secondaryIdOf` and `resolveSecondarySourceSchemas` (PipelineStepOwnership.scala:92)
  both call `PipelineAnalyzeService.secondarySourceIdOf` on `PipelineStepConfigCodec.encode(step)`. That helper
  (PipelineAnalyzeService.scala:205-211) filters `nonEmpty` but does not trim, and `SecondaryInput.read` stores the raw
  string. Upsert targets: both the prefetch and `UpsertTargetAnalysis.problems` use `targetIdsOf`
  (UpsertTargetAnalysis.scala:41-47), which filters on `id.trim.nonEmpty` but returns the untrimmed `id`. So with
  `validIds` removed, the prefetched raw strings equal the requested ones exactly. No trimming mismatch.
- **The proposed backend red tests are genuinely red on current code.**
  - Upper-case join/lookup secondary naming `ref` (RefSchema, non-empty): the batch's `validIds` lower-cases it, so
    `findByIdsInternal` returns the row and the resolver's `UUID.fromString(raw).toString` key hits. The schema is
    therefore present in `secondarySchemas`. `/analyze`'s `findByIdInternal(UPPER)` misses, and the schema is filtered
    out. The join/lookup projection differs, so the steps differ. Red.
  - Upper-case upsert target naming the owned `dataset`: the batch gives `classify` → `Writable` (no `validationError`).
    `/analyze` gives `findByIdOwned(UPPER)` = None → `NotFound` → `validationError`. Red.
  - Non-UUID secondary or target: the resolver throws inside `Future.fromTry`. Both of those resolvers are invoked
    inside `fetch`'s `flatMap` chain, so the failure is a failed Future, `recover` runs, and the item is omitted. The
    test asserts the item is present, so it is red.
  - Seeding is feasible below the API. `addStep` → `insertInternal` (PipelineStepRepository.scala:406) runs only the
    upsert cycle check, and the existing rich fixture already seeds missing and foreign targets this way.
- **MCP fallback (D3).** `fetchContextAnalyze` (context.ts:286-302) maps every item. The consumer
  (context.ts:684-689) calls `mapAnalyzedSteps(batched ?? …)`, and `analyzed.steps.map` throws a TypeError for a
  steps-less item, which becomes a `stepsError`. So the proposed golden-loop case is red today. Filtering out non-array
  `steps` at map construction sends those items through the existing absent-count code (context.ts:656-660). That keeps
  the single existing stderr line, and the per-pipeline path yields the same object as the existing `missing-one` mode,
  which already equals the goldens (test lines 138-143). Golden byte-identity and the one-line stderr contract both hold.
- **N+1 mutation (D5).** `listByPipelineInternal(pipelineId)` exists (PipelineStepRepository.scala:337). Replacing the
  batch read with `Future.traverse(ids)(listByPipelineInternal)` makes the app and privileged statement counts grow
  with P. So `large shouldBe small` (QueryCountSpec:81) and `<= 16` (:82) both fail at 200 vs 10. Genuinely red.
- **Spec deltas.** Both MODIFIED requirement headers exist verbatim in `openspec/specs/*/spec.md` (lines 24 and 73),
  and every base scenario is carried forward unchanged. No API, schema or migration change is needed, and none is
  planned.
- **AC coverage.** Item 1 → tasks 1.1-1.4. Item 2 → tasks 2.1-2.3. Item 3 → tasks 3.1-3.2. No scope beyond the ticket.

### Verdict: CONFIRM

### Non-blocking notes

1. **Keep resolver throws asynchronous.** D1 says `Future.fromTry` "goes if unused". If the resolver becomes
   `raw => Future.successful(map.get(raw))`, a throwing lookup on the ROOT path would no longer omit one pipeline. It
   would fail the whole response with a 500. `Future.traverse` calls the resolver eagerly (Scala 2.13 foldLeft),
   `fetch`'s first generator runs synchronously, and `project(...)` is called inside the outer `yield`, outside
   `.recover`. Real maps never throw, and QueryCountSpec's poison sits on a secondary, which is evaluated inside a
   `flatMap` and stays safe, so no current test would notice. To keep the spec's "a source lookup fails → item
   omitted" scenario robust, either keep the `Future.fromTry(Try(...))` wrapper or wrap the per-pipeline
   `project(...)` call in `Future.delegate`.
2. **The expected stderr count in D4.** In "serve" mode the batch already omits `ANALYZE_FAILS_INDEX`. A new steps-less
   item therefore yields "omitted 2 of 55", not "1 of N". Two pipelines get a per-pipeline `/analyze`: the steps-less
   one and the failing one. Model the assertion on the existing `missing-one` test (contextRequestBudget.test.ts:265-273)
   rather than reading D4 literally.
3. **Exercise both secondary kinds.** Upper-case secondaries should cover both join and lookup, both resolving a
   schema'd source. An empty `inferredSchema` is filtered out (PipelineStepOwnership.scala:93), and the parity case
   would then pass vacuously. Make sure the red run really shows a diff for each case.
4. **Retire the PoisonedMap's dependence on canonical keys.** QueryCountSpec's `PoisonedMap.get` keys on the canonical
   `PoisonId`, and after D1 the resolver looks up the raw id. The poisoned join still stores `PoisonId` in canonical
   form, so the omit test stays valid. Re-run it after D1 anyway (task 1.4 covers it).
