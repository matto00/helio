## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD d777803c1fbdf45f093584527ed4c052c8ad992f. The change dir is untracked. I read ticket.md, proposal.md, design.md,
tasks.md and both spec deltas, plus `docs/live-draft-preview.md` §4 and §12. I derived every finding below from the code; none
comes from skeptic-design-1.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/source-sample-store-label/HEL-1628`.
- **Round-1 change requests are all addressed in the artifacts:**
  - CR1 (URL-fetch seam): D2 plus task 1.0 extract a shared function, and task 1.2 tests a blocked-host URL CSV.
  - CR2 (`sourceRowCount` null): D4 now requires a custom writer and a required `["integer","null"]`. Task 3.4 adds the null
    case to the fixture.
  - CR3 (`evaluable` marker): D6 drops the marker. A nested map is now a 500.
  - The round-1 notes are folded in: the `ConnectorResolveContext` doc update, sign-out late-fulfilment, `-0.0`, the disabled
    refresh button, the secondary-ids hand-off to HEL-1631, and the RLS dataset seed.
- **Engine path (D4).** `InProcessPipelineEngine.loadRowsWithStats` (`InProcessPipelineEngine.scala:522-685`) behaves as
  follows:
  - Dataset reads go through `readDatasetRows` and return `(false, None)`.
  - CSV goes through `urlFetch("csv")` or `fileSystem.read`, then `csvRowsWithinLimits` → `(false, None)`. It is uncapped.
  - Text and PDF return `(false, None)`.
  - Image with `sourceUrl` calls `fileSystem.write(i.config.path, …)` (`:627`), which justifies D5.
  - REST (`:661`) and SQL (`:673`) use `maxRunRows` = 1000 with `ConnectorResolveContext.Internal` and return
    `SourceReadStats(outcome.truncated, outcome.availableRowCount)`.
  - The run's only caller (`InProcessExecutionBackend.scala:54`) passes the rows unchanged as root frames.
  - So D4's two branches are exhaustive. A CSV over 1000 rows correctly ends up `truncated = rows.size > 1000` with an exact
    count.
- **Limiter (D1).**
  - `DataSourcePreviewRoutes.routes` wraps everything inside `pathPrefix("data-sources")` in `rateLimited`. It is mounted with
    `sourceFetchRateLimitDirective`, which is its own `InMemoryRateLimiter` (`ApiRoutes.scala:315-321`, mount `:932`).
  - The earlier `DataSourceRoutes` (`:107-220`) has only `path(...)` matchers: csv-limits, references, `:id`, `:id/schema`,
    `:id/rows[...]`. `/:id/sample` therefore falls through to the preview routes.
  - A `/sample` path added inside that `concat` is charged to the 30/min bucket.
- **Run-guard isolation (D2).**
  - The guard is reached only through `PipelineRunService` → `PipelineRunExecutor`. A separate service that builds its own
    engine and calls `loadRowsWithStats` never touches it.
  - `urlFetchSeam` is private to `PipelineRunService` (`:125-139`) and dispatches csv → `CsvUrlFetch.fetch`, text/pdf/image →
    `fetchUrlWithLimit`. It null-checks `system` at call time, so a shared function that takes `system` as a parameter and
    checks it inside the closure preserves that behaviour.
  - `ApiRoutes:455-468` passes `system`, `sqlUrlResolveHost` and `sqlUrlIsBlocked` to the run service. D2 reuses the same
    values.
- **Access and credentials (D3).**
  - `findByIdOwned` applies an explicit owner filter under `withUserContext` (`DataSourceRepository.scala:180-185`), the same
    gate `DataSourceService.preview` uses (`:1351`).
  - Engine REST/SQL resolution uses `Internal`, which the ticket's house rule requires.
  - I confirmed the bounded rationale holds:
    - `DataSourceService.update` (`:650-676`) changes the name only, so a REST source's `connectorId` cannot be re-pointed
      after create.
    - Create validates connector ownership (`SourceService.scala:134-137, 214-240`).
    - The owner's own pipeline run already reaches the same connector through `Internal`.
  - The doc comment D3 promises to update is at `ConnectorDriver.scala:11-20`.
- **Wire null.** D4 commits to a custom writer that emits `JsNull`, with `sourceRowCount` required as `["integer","null"]`.
  That matches the repo convention.
- **Value encoding vs HEL-1581 (D6).**
  - The evaluator's `Value` is null, boolean, string, number or `Integral(int|long)` (`evaluator/value.ts:8-17`).
  - `decodeValue`/`decodeRow` live only in `evaluator/testing/corpus.ts:37-70`, which imports `fs`, so promoting them to
    `evaluator/wire.ts` is necessary.
  - What reachable engine values contain:
    - `PipelineRowJson.jsValueToAny` (`:54-63`) maps numbers to Double and compact-prints objects and arrays to String, which
      covers REST, SQL and dataset rows.
    - CSV cells are String or null.
    - Text rows carry `sizeBytes` Long.
    - PDF rows carry Long `sizeBytes` and Int `pageNumber`, `pageCount` and `characterCount` (`:723-760`).
    - The only nested Map is the image `content` field, which D5 refuses.
  - So `$int`/`$long` is load-bearing (text and PDF), and "nested map → 500" is unreachable from real data.
  - D6 mirrors the test-scope Scala encoder `ParityCorpus.encodeValue` (`backend/src/test/.../ParityCorpus.scala:48-60`).
- **Store and selectors (D7).**
  - `RootFrame {rootId, rows}` and `SourceFrames = Record<id, {rows, complete}>` are at `evaluatePipeline.ts:29-34`.
  - `PipelineRoot {id, dataSourceId, dataSourceName}` is at `pipelineStep.ts:686`.
  - `clearAuth` resets are an established pattern (`homeSummarySlice.ts:102`, `scheduledItemsSlice.ts:57`).
  - `formatRelativeTime(iso, now)` exists.
  - DESIGN.md §IconButton (`:502-537`) gives a shared primitive for the refresh control.
- **Labels (D8 and spec) vs §4.** I checked all four cases plus the unknown total against §4 and §12 item 5:
  - non-static exact: sample, N rows, age, no caveat;
  - non-static prefix: first 1,000 of N, age, caveat;
  - static over the cap: "first 1,000 of N rows" plus the caveat;
  - static exact: "Static · N rows".
  - "1,000+" is a disclosed, reversible addition.
  - `live` is computed server-side, which is correct: the frontend `CsvSourceConfig` lacks `sourceUrl`.
- **RLS test feasibility (3.3).** `TwoUserRlsApiFixture` builds the full `ApiRoutes` tree with `appDb` running
  `SET ROLE helio_app_test` (NOSUPERUSER NOBYPASSRLS). It has `privilegedDb` for seeding, so a seeded dataset source yields
  real rows through the restricted role, and the sample service will be built inside `ApiRoutes`.
- **Schema tooling.** `JsonSchemaValidation` (networknt 2020-12) exists for the Scala half. Frontend Ajv2020 contract tests
  exist (`adminUsage.contract.test.ts`).

### Verdict: REFUTE

The design is sound and the round-1 defects are fixed. One gap remains: the task list does not prove the most load-bearing part
of the new wire contract, the cell-value encoding.

### Change Requests

1. **Pin the cell-value encoding in the committed schema, and make the seam test exercise it on both sides.**
   - **The gap.** The whole point of D6 is that HEL-1631's evaluator receives `Integral` for JVM Int/Long, and the
     evaluator's results depend on that class distinction (value.ts header: "`cast integer` 1 and the JSON number 1 stay
     different classes").
   - **Why the current plan does not catch it.** Neither D4/D6 nor tasks 1.4/3.4 say the schema constrains `rows[]` cell
     values. A schema of `rows: array of object` (the natural first draft) would let a server that writes PDF/text Int/Long
     cells as plain JSON numbers, for example through `PipelineRowJson.anyToJsValue` instead of `SampleRowJson.encode`, pass:
     - task 1.1's unit tests, which only test the encoder in isolation;
     - task 3.4's schema validation on both sides;
     - every frontend test, which decodes a hand-written fixture.
   - **The consequence.** The client and server would each pass every gate while disagreeing on the wire. Every Int/Long would
     silently become a double in the evaluator.
   - **Required changes:**
     - (a) In D6/task 1.4, state that the schema defines a closed cell-value type: `null | boolean | string | number |
       {"$int": integer} | {"$long": string (pattern ^-?[0-9]+$)} | {"$double": enum ["NaN","Infinity","-Infinity","-0.0"]}`.
       Each object form has exactly one property and `additionalProperties: false`, and rows use
       `additionalProperties: { $ref: cell }`.
     - (b) In task 3.4, the backend half validates a response actually serialized by the route/protocol for a source whose
       rows contain Int and Long, such as a PDF or text source served through the engine, or an engine-shaped row through the
       real writer. It must not use a hand-built JSON string. A row of plain-number Int cells must fail the schema.
     - (c) In task 3.4, the frontend half runs the shared fixture through `wire.decodeRow` and asserts that the
       `$int`/`$long` cells come back as `Integral` with the right `kind` and that plain numbers come back as `number`. The
       committed fixture must include Int, Long, a plain double and null cells, alongside the `sourceRowCount: null` case.

### Non-blocking notes

- **Encoder drift guard.** `SampleRowJson.encode` (main) will duplicate the test-scope `ParityCorpus.encodeValue`. A test
  asserting `ParityCorpus.decodeValue` round-trips `SampleRowJson.encode` output for every value class would stop the two from
  drifting. Alternatively, have `ParityCorpus` delegate to the new main encoder.
- **`selectRootFrames(state, roots)`.** Name the argument type: `PipelineRoot[]`, mapping `root.id → rootId` and
  `root.dataSourceId →` the sample. `RootFrame.rootId` is a pipeline root id, not a source id, and an implementer could confuse
  the two.
- **Unknown value classes.** The encoder's catch-all for any class it does not recognise (not only nested maps) should also be
  the curated 500. It must not stringify the way `anyToJsValue`'s `JsString(v.toString)` fallback does.
- **Unresolvable sources.** For a root whose `source` is `undefined` on the page (not in the caller's own list, for example an
  editor grantee), the hook could skip the request entirely. That avoids spending source-fetch budget on a guaranteed 404.
  This is optional, since the label already handles the error.
- **Task 3.6.** Producing the four label cases on the running app needs REST/SQL samples with known totals. Say whether the e2e
  stubs `/sample` responses with `page.route`. Component tests carry the rule proof either way, and the screenshots are the
  visual check.
- **Uploaded CSV with a missing file.** The existing preview maps `NoSuchFileException` to 404 ("re-upload"). Decide whether the
  sample maps it to 502 or to the same message. This is a wording choice only.
