## Context

`TriggerSource` (`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`) has four values;
V110 widened the DB CHECK to admit `auto-run`. Three listings lag it:

- `schemas/pipelines/pipeline-run-record.schema.json` `triggerSource.enum` = `manual|scheduled|external`.
- `frontend/src/features/pipelines/types/pipelineStep.ts` `PipelineRunRecord.triggerSource` =
  `"manual" | "scheduled" | "external"`.
- `frontend/src/features/home/ui/TimelineMark.tsx` `TRIGGER_WORD` keys `auto` (not a value the backend writes), so an
  auto-run home mark renders the raw `auto-run` via its `?? source` fallback. The home summary passes the raw
  `pipeline_runs.trigger_source` (`HomeSummaryRepository.scala`).

Already correct: `triggerSourceLabel.ts` maps `auto-run` -> `Auto-run` (tested, used by `RunHistoryModal` and Output
history). helio-mcp types `triggerSource: string` (`helio-mcp/src/types.ts`) and only passes it through.

A second break (skeptic design round 1, CR 1): `pipelineRunRecordFormat` is a plain `jsonFormat11` without
`NullOptions` (`PipelineProtocol.scala:426`), so `completedAt`, `rowCount` and `errorLog` are OMITTED on the wire when
`None` (every non-failed run omits `errorLog`; queued/running omit `completedAt`). The schema lists all three in
`required`. helio-mcp already types them `?:` (`types.ts:550-553`); the web client types them `T | null` and its
`normalizeRunRecord` (`pipelineService.ts:291`) already normalises other omitted fields at the boundary.

Not the same enum (left alone): insight `trigger` (`on_run|daily|manual|pin`), Output `refresh`
(`on_run|daily|manual`). History-point, history-payload and home-summary schemas type `triggerSource` as `string`.

## Decisions

1. **Schema**: add `auto-run` to the run-record enum (order matches `TriggerSource`) and to the schema's top-level
   `description` (which enumerates the values). Drop `completedAt`, `rowCount`, `errorLog` from `required` so the
   schema states the real wire (option (a); no route/wire change). Their property definitions (`["T","null"]`) stay.
   Each property gets a description saying "omitted when not set".
2. **Seam spec (backend)**: a new route spec under `backend/src/test/scala/com/helio/api/routes/pipelines/` seeds one
   persisted run per trigger source (all four, via the real `PipelineRunRepository` insert path with each
   `TriggerSource` constant), and the seeded set MUST include a succeeded run with `errorLog = None`, a non-terminal
   (queued or running) run with `completedAt = None` and `rowCount = None`, and a failed run with an `errorLog` (never
   fill every Option to make validation pass), calls the real `GET /pipelines/:id/run-history` route, and validates each record with
   `com.helio.testsupport.JsonSchemaValidation` against `pipelines/pipeline-run-record.schema.json`. Pattern:
   `PatchSetPreviewResponseSchemaSpec` (validation) + `PipelineRunResponseCapSpec` (embedded Postgres, route,
   normalised shared fixture, `HEL1815_WRITE_FIXTURE=1` regen). The spec asserts the four seeded sources equal the
   schema enum, so a fifth backend value with no schema change fails. Red evidence, in order, each committed as `.txt`:
   (i) the spec against the unmodified schema (fails on the required omitted fields AND the enum);
   (ii) after the `required` relaxation only: the `manual`/`scheduled`/`external` records validate and the `auto-run`
   record fails with an error naming `/triggerSource` (the AC 1 red, attributable to `auto-run`). The spec asserts the
   error location so the red is self-describing. Then the enum fix turns it green.
3. **Shared fixture** `shared-test-fixtures/pipeline-run/run-history-response.json`: the route's normalised body
   (ids/timestamps replaced by stable placeholders, as HEL-1696 does).
4. **Web client**: export a runtime list `TRIGGER_SOURCES = ["manual","scheduled","external","auto-run"] as const`
   and `type TriggerSource = (typeof TRIGGER_SOURCES)[number]` beside `PipelineRunRecord`, which uses it. The three
   nullable fields stay `T | null` (the post-normalisation shape); `normalizeRunRecord` defaults an omitted
   `completedAt`/`rowCount`/`errorLog` to `null` (so no `=== null` check downstream sees `undefined`); `triggerSourceLabel.ts`'s map becomes `Record<TriggerSource, string>` (compile-time
   exhaustive); the unknown-value sentence-case fallback stays for the wider `string` inputs (history points, home
   summary, a future backend value before the client ships) and the PR states why. `TimelineMark` drops its own
   `TRIGGER_WORD` map and calls `triggerSourceLabel`, so an auto-run mark reads `Auto-run` (the existing run-history
   wording; no new product wording). A frontend contract test reads the shared fixture and passes it
   through the real `fetchRunHistory` (mocked `httpClient`), asserts every record's omitted fields come back `null`,
   every `triggerSource` is in `TRIGGER_SOURCES` with a known label (no fallback taken), and that the schema file's
   enum equals `TRIGGER_SOURCES` (read the schema JSON at test time).
5. **helio-mcp: no change.** No MCP tool returns a run's `triggerSource`; the only run-history consumer is
   `context.ts:644` (`lastRunAssertions` from `history[0].assertions`). `triggerSource: string` and the `?:` optionals
   already match the wire with no narrowing and no fallback, which satisfies AC 2. A pass-through test could never
   fail, so none is added; the PR says this. No MCP source change means no redeploy note is needed.

## Risks

- The seam spec seeds rows directly; it must still go through the real route + protocol writer, not a hand-built JSON.
- `normalizeRunRecord`'s `?? "manual"` default is untouched (absent field, not unknown value).

## Planner Notes

- Self-approved: label wording `Auto-run` reuses `triggerSourceLabel.ts`; not a product question.
- Self-approved: keep the sentence-case fallback (inputs typed `string` elsewhere); justified in the PR.
- Self-approved (skeptic CR 1): option (a), relax `required`, over (b) explicit nulls, to avoid a wire change.
- Non-blocking, NOT done: `RunHistoryModal.css` has no `--auto-run` badge modifier (renders like `manual`); colour is
  a design call, mentioned in the PR as a possible follow-up.
- Avoid HEL-1807 (draft regex cost model) and HEL-1820 (dependency bumps) files.
